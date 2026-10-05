# Architecture

## Principles

1. **The AI never commands the motors.** The chain is always `AI → Safety → Planner → Controller → Motor`.
   Safety, planner and controller are deterministic code.
2. **Everything goes through topics.** The simulated robot and the autonomy stack only exchange ROS2-shaped messages over a
   `RobotTransport`. Replacing the simulator with a real rover means replacing the transport/sensor provider, nothing else.
3. **Provider independence.** The rest of the system only knows the internal `Decision` schema. Adapters translate
   provider-specific formats.
4. **Simulation ≠ rendering.** The physics loop runs in the server at its own rate; the UI receives throttled snapshots.
5. **Determinism.** All randomness comes from seeded per-component streams; AI latency injection is applied in sim time.

## Data flow

```
                         ┌──────────────── RoverRuntime (packages/runtime) ─────────────────┐
                         │                                                                   │
  SimulationEngine       │   SimulationTransport (virtual ROS2 graph)          AutonomyStack │
  (packages/simulation)  │                                                                   │
  ┌──────────────────┐   │  /scan /imu /odom /gps        ┌───────────────┐                   │
  │ SimulationSensor │───┼─▶ /battery /motor_state ──────▶│StateAggregator│── AggregatedState │
  │ Provider         │   │  /mission                      └──────┬────────┘        │         │
  ├──────────────────┤   │                                       │ every control tick       │
  │ MissionManager   │───┼─▶ /mission                            ▼                 ▼         │
  ├──────────────────┤   │                               DecisionEngine.decide() (async,    │
  │ SimulatedRover   │   │                               rate-limited, timeout, retries)    │
  │  diff-drive ctrl │◀──┼── /cmd_vel ◀── LocalPlanner ◀── SafetyController ◀── Decision    │
  │  motors, battery │   │                                   │                               │
  │  kinematics      │   │   /decision /safety /rover_state ◀┘                               │
  └──────────────────┘   │                                                                   │
                         └───────────────────────────────────────────────────────────────────┘
                                   │ frames (20 Hz) · logs · topics · AI inspector
                                   ▼
                         Fastify + WebSocket hub (apps/server) ──▶ React UI (apps/web)
```

### One simulation tick (`RoverRuntime.step`)

1. `SimulationEngine.step(dt)` — the rover applies the latest `/cmd_vel` (with a watchdog), motors and battery evolve,
   kinematics integrate, collisions are resolved; then `SimulationSensorProvider` publishes every sensor whose period has
   elapsed; the `MissionManager` evaluates goals against ground truth.
2. `AutonomyStack.tick(t)` — at `planner.controlFrequency` (20 Hz): build the aggregated state, start an AI request if the
   decision interval elapsed and none is in flight, apply a completed decision whose simulated latency has elapsed, run
   the safety rules on the *latest* state (every control tick, independently of the AI), plan, clamp and publish
   `/cmd_vel`.
3. The `RunRecorder` samples a telemetry frame at `simulation.recordFrequency`.

### Rates are independent

| Loop | Default | Configured by |
|---|---|---|
| Physics | 50 Hz | `simulation.hz` (10/20/30/50/100) |
| LiDAR / IMU / odom / GPS / battery / motors | 20 / 50 / 50 / 5 / 1 / 10 Hz | `sensors.*.updateFrequency` |
| Safety + planner + `/cmd_vel` | 20 Hz | `planner.controlFrequency` |
| AI decisions | 2 Hz (500 ms) | `ai.decisionIntervalMs` (100 ms … 2 s) |
| UI frames | 20 Hz | `simulation.uiFrequency` |

## Key interfaces

```ts
// packages/protocol/src/transport.ts
interface RobotTransport {
  advertise(topic, type, publisher, expectedHz?): void;
  publish<T>(topic, data: T, publisher?): void;
  subscribe<T>(topic, cb): () => void;
  getTopicInfo(): TopicInfo[];
  getLastMessage<T>(topic): TopicMessage<T> | undefined;
}
interface SensorProvider { update(simTime: number): void; reset(): void }

// packages/decision-engine/src/engine.ts
interface DecisionEngine {
  decide(state: AggregatedState, opts: { signal: AbortSignal }): Promise<DecisionResult>;
  healthCheck(signal?): Promise<HealthStatus>;
  getModelInfo(): ModelInfo;
  readonly deterministic?: boolean; // in-process engines are awaited inside the tick
}
```

Implementations:

| Interface | Today | Future |
|---|---|---|
| `RobotTransport` | `SimulationTransport` | `Ros2Transport` (placeholder in `packages/transport`) |
| `SensorProvider` | `SimulationSensorProvider` | `ROS2SensorProvider` (bridge) |
| `DecisionEngine` | `MockDecisionEngine`, `LocalJevAdapter`, `CustomHttpAdapter` | any model |

`FaultInjectingDecisionEngine` decorates any engine to inject malformed answers; AI timeouts and latency are injected by
the `AutonomyStack` in sim time.

## Safety controller

Rules evaluated in priority order (first blocking rule wins). All are deterministic.

| # | Rule | Effect |
|---|---|---|
| 1 | Emergency stop latched | BLOCK → `EMERGENCY_STOP` |
| 2 | Mission not RUNNING (AUTO) | `STOP` |
| 3 | Invalid AI response | BLOCK → `STOP` |
| 4 | AI timeout / stale decision | policy `STOP` (default), `SLOW_DOWN`, or `CONTINUE_LAST` at half speed |
| 5 | No decision yet | BLOCK → `STOP` |
| 6 | Motor failure | BLOCK → `STOP` |
| 7 | Battery critical / dead | BLOCK → `STOP` |
| 8 | LiDAR unavailable | BLOCK (AUTO); speed-limited in MANUAL |
| 9 | Motor overheat / overcurrent | OVERRIDE → `SLOW_DOWN`, 30 % speed |
| 10 | Front clearance < `emergencyStopDistance` and moving forward | OVERRIDE → `EMERGENCY_STOP` (turning/reversing still allowed) |
| 11 | Stopping distance would breach the emergency distance | OVERRIDE → `EMERGENCY_STOP` (`COLLISION_IMMINENT`) |
| 12 | Time-to-collision < threshold | forward speed capped, `FORWARD` → `SLOW_DOWN` |
| 13 | Front-corner clearance < ½ emergency distance | creep (0.15 m/s) |
| 14 | Front clearance < `slowDownDistance` | speed capped at `maxSpeed × slowDownFactor` |
| — | Always | clamp to `safety.maxSpeed` / `safety.maxAngularVelocity` |

## Server

* `RoverRuntime` is the composition root (one per server process).
* `WsHub` streams throttled data and drops frames for slow clients (`bufferedAmount` backpressure).
* `Repository` persists to SQLite via Drizzle ORM over Node's built-in `node:sqlite` (Drizzle `sqlite-proxy` driver), so
  there is no native addon to build. Tables: `scenarios`, `robot_configurations`, `simulation_runs`,
  `simulation_events` (events + `TELEMETRY_FRAME` rows), `ai_requests`, `ai_responses`. Rendering frames are never stored.

## Error handling

| Failure | Behaviour |
|---|---|
| Jev offline / HTTP error | Adapter returns an error result, link status `OFFLINE`/`ERROR`, safety applies the timeout policy |
| HTTP timeout | `AbortController` + race timeout; `AI_TIMEOUT` event |
| Invalid JSON / invalid decision | Rejected by `validateDecision`; `INVALID_AI_RESPONSE` → STOP |
| Sensor failure | Topic goes STALE; aggregator marks data invalid; safety blocks |
| Exception in a tick or subscriber | Caught and logged as `SYSTEM_ERROR`; the loop continues |
| WebSocket disconnect | Client reconnects with backoff; simulation keeps running |
| Database errors | Returned as HTTP errors, logged; simulation unaffected |
