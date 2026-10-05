# Rover AI Lab

A web lab for developing and testing the software of an autonomous rover **before the physical rover exists**.
A deterministic 2D simulator produces data shaped like real ROS2 topics; an AI decision model (Jev / Jev-like, served
locally over HTTP, or a built-in mock) decides *what* to do; a deterministic safety layer and planner decide *whether* and
*how* it happens.

The simulator, the AI and the robot are decoupled by interfaces. The physical rover can later replace the simulator
**without touching the decision layer, the safety layer or the UI**.

```
SENSORS (sim) → VIRTUAL ROS2 TOPICS → STATE AGGREGATOR → DecisionEngine (Mock | Local Jev | Custom HTTP)
      ↑                                                            ↓ high-level action
 PHYSICS ← MOTORS ← ROBOT CONTROLLER ← /cmd_vel ← LOCAL PLANNER ← SAFETY CONTROLLER
```

---

## Quick start

Requirements: **Node.js ≥ 22.13** (uses the built-in `node:sqlite`, no native modules to compile).

```bash
npm install
npm run dev
```

Open **http://localhost:3000**.

* `npm run dev` starts the API/simulation server (`:3001`) and the Vite UI (`:3000`, proxies `/api` and `/ws`).
* Optional, to try the *Local Jev* path without the real model: `npm run mock-jev` (a stand-in Jev server on `:8000`),
  then pick **SIM + LOCAL AI** in the top bar.

Production / single process (UI + API on `:3000`):

```bash
npm run build
npm start
```

Docker:

```bash
docker compose up --build                     # http://localhost:3000
docker compose --profile mock-jev up --build  # also starts the mock Jev server on :8000
```

### First run in 30 seconds

1. Pick a preset (e.g. `SINGLE_OBSTACLE`) in **Scenario**.
2. Switch to **AUTO**, press **▶ RUN**: the mock engine drives the rover around the obstacle to the target.
3. Watch the LiDAR, the trail, **Telemetry**, **ROS2 Topics**, **Logs**, **AI Inspector**, **State JSON**.
4. **Faults** → toggle *AI timeout*: the safety layer stops the rover (`AI_TIMEOUT`), the simulation keeps running.
5. **Runs / Replay** → **SAVE RUN**, then **REPLAY** it with the timeline.

**MANUAL** mode: `W/A/S/D` or arrow keys, `Space` = stop, or the on-screen throttle/steering pad.

---

## What's inside

| Area | Features |
|---|---|
| Simulator | 2D top-down world with walls, rectangular/circular obstacles, target, waypoints; differential-drive physics with acceleration limits, friction, braking, collisions; configurable rate (10–100 Hz), pause/resume/step/reset, slow motion & fast forward; seeded and deterministic |
| Robot model | mass, max speed/accel/angular velocity, turn rate, wheel base/radius, footprint, friction; two motor models (rpm, current, temperature, voltage, errors); energy-based battery (%, voltage, current, remaining time) |
| Sensors | LiDAR (range, FOV, rays, rate, noise, dropout), IMU (accel, gyro + bias random walk, orientation), wheel odometry (dead reckoning with drift), GPS (WGS84, noise, signal loss), BMS, motor state |
| Virtual ROS2 | `/scan /imu /odom /gps /battery /motor_state /cmd_vel /mission /decision /safety /rover_state`, each with type, publisher, expected and measured rate, count, last message, status |
| Autonomy | `StateAggregator` → `DecisionEngine` (rate-limited, async, timeout/retry/last-known decision) → `SafetyController` (deterministic ALLOW/OVERRIDE/BLOCK) → `LocalPlanner` → `/cmd_vel` |
| AI | `MockDecisionEngine`, `LocalJevAdapter` (native JSON or OpenAI-compatible chat), `CustomHttpAdapter` (URL, method, headers, request template, response mapping, action map); connection test, health monitor, AI OFFLINE handling |
| UI | Map canvas (LiDAR rays, safety envelope, trail, odometry ghost, cmd_vel vector), scenario editor, parameter panels (all live), telemetry charts, rqt-like topic monitor, log console with filters, AI inspector, state JSON, debug overlay |
| Failure injection | LiDAR/GPS/IMU/odometry failure, motor failure/overheat/high current, battery drain, AI timeout, AI invalid response, AI latency, network latency (±30 % jitter), sensor noise multiplier |
| Persistence | SQLite (Drizzle ORM): scenarios, robot configurations, runs, events (+ telemetry frames), AI requests, AI responses |
| Replay | Saved runs replay client-side with a timeline, play/pause/step and ×0.5…×10; *Restore* reloads a run's scenario + parameters for A/B comparisons |

---

## Architecture

```
apps/
  web/              React + Vite + Tailwind + Zustand UI (canvas map, panels)
  server/           Fastify REST + WebSocket hub, SQLite persistence, composition root
packages/
  protocol/         Shared types: ROS-like messages, topics, decision schema, config, scenario, WS protocol
  shared/           Seeded RNG, math, ray/shape geometry, utilities
  transport/        RobotTransport, SimulationTransport (in-process topic graph), Ros2Transport placeholder
  logging/          Structured event logger
  robot-model/      Diff-drive kinematics + controller, motor model, battery model
  sensor-models/    LiDAR, IMU, odometry, GPS models
  simulation/       World, collisions, simulated rover, SimulationSensorProvider, mission manager, scenarios
  decision-engine/  DecisionEngine interface, decision validation, MockDecisionEngine, fault injection
  jev-adapter/      LocalJevAdapter, CustomHttpAdapter
  autonomy/         StateAggregator, SafetyController, LocalPlanner, AutonomyStack (AI scheduling)
  runtime/          RoverRuntime: wires everything, real-time loop, headless runs, run recorder
scripts/            mock-jev-server.ts, compare-engines.ts
docs/               architecture, Jev integration, ROS2 bridge, simulation, testing
```

Dependency rule: the decision layer (`autonomy`, `decision-engine`, `jev-adapter`) only talks to the robot through the
`RobotTransport` topics. It never imports the simulator. See [docs/architecture.md](docs/architecture.md).

---

## Configuration

Environment variables (copy `.env.example` to `.env`; no secrets are committed):

| Variable | Default | Meaning |
|---|---|---|
| `API_PORT` | `3001` | API/simulation port in development (Vite owns `:3000`) |
| `PORT` | `3000` | Port in production (`npm start`, Docker): serves UI + API |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_URL` | `file:./data/rover.db` | SQLite file (relative to repo root) or `file::memory:` |
| `AI_PROVIDER` | `mock` | `mock` \| `local-jev` \| `custom-http` |
| `JEV_ENABLED` | `false` | If `true` and no `AI_PROVIDER` is set, starts with `local-jev` |
| `JEV_BASE_URL` (alias `JEV_URL`) | `http://localhost:8000` | Jev server base URL |
| `JEV_MODEL` | `default` | Model name sent to the server |
| `JEV_TIMEOUT` | `1000` | AI request timeout (ms) |
| `JEV_PROTOCOL` | `native` | `native` (JSON state → JSON decision) or `openai-chat` |
| `JEV_DECIDE_PATH` / `JEV_HEALTH_PATH` | `/decide` / `/health` | Endpoint paths (OpenAI mode defaults to `/v1/chat/completions` / `/v1/models`) |
| `CUSTOM_AI_URL` | — | Initial URL for the custom HTTP provider |
| `SIMULATION_DEFAULT_HZ` | `50` | Physics rate |
| `SIMULATION_SEED` | `12345` | Default random seed |

Everything else (robot, sensors, AI timing, safety, planner, failures) is editable live from the UI or `PATCH /api/config`.

---

## Jev setup

1. Run your Jev / Jev-like model behind an HTTP endpoint (see [docs/jev-integration.md](docs/jev-integration.md) for the
   request/response contract — any OpenAI-compatible server such as llama.cpp, vLLM or Ollama also works with
   `JEV_PROTOCOL=openai-chat`).
2. In the UI: **AI → Local Jev**, set *Base URL*/*Model*, press **TEST**, or start with
   `AI_PROVIDER=local-jev JEV_BASE_URL=http://localhost:8000 npm run dev`.
3. The top bar shows `AI: CONNECTED` / `OFFLINE` / `TIMEOUT`. If Jev is down the simulation keeps running and the safety
   layer applies the *On AI timeout* policy (default: STOP).

Compare engines headless with the same seed:

```bash
npm run compare                                   # mock on every preset
npm run compare -- --jev http://localhost:8000 --scenarios SINGLE_OBSTACLE,MAZE --seed 7
```

---

## Simulation & scenarios

Presets: `EMPTY_FIELD`, `SINGLE_OBSTACLE`, `MAZE`, `NARROW_CORRIDOR`, `MULTIPLE_OBSTACLES`, `TARGET_NAVIGATION`,
`OBSTACLE_AVOIDANCE`, `LOW_BATTERY`, `MOTOR_FAILURE`, `GPS_LOSS`. The editor (map toolbar) adds/moves/deletes obstacles,
sets the target, waypoints, rover pose and heading; scenarios are saved to SQLite. **GENERATE RANDOM SCENARIO** is seeded:
the same parameters and seed give the same scenario. Details: [docs/simulation.md](docs/simulation.md).

---

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server, simulation, AI and DB status |
| GET | `/api/robot` | Current frame + robot/battery config + aggregated state |
| GET / PATCH | `/api/config` | Read / deep-patch the live configuration (unknown keys ignored) |
| POST | `/api/config/reset` | Restore the startup configuration (keeps active failures) |
| POST | `/api/sim/control` | `{action: run\|pause\|step\|reset, steps?}` |
| POST | `/api/sim/mode` | `{mode: MANUAL\|AUTO}` |
| POST | `/api/sim/dev-mode` | `{devMode: SIMULATION\|SIMULATION_LOCAL_AI\|REAL_ROBOT}` |
| POST | `/api/sim/estop` | `{engaged: boolean}` latching emergency stop |
| POST | `/api/sim/manual` | `{throttle, steering}` in [-1, 1] (also via WebSocket) |
| POST | `/api/sim/mission` | `{action: start\|pause\|abort}` |
| GET / PUT | `/api/sim/scenario` | Read / load the active scenario (resets the simulation) |
| GET / POST | `/api/scenarios` | Presets + saved scenarios / save a scenario |
| GET / PUT / DELETE | `/api/scenarios/:id` | Read / update / delete a saved scenario |
| POST | `/api/scenarios/generate` | Seeded random scenario `{numberOfObstacles, minimumDistance, maximumDistance, difficulty, seed, load?}` |
| GET / POST | `/api/runs` | List runs / save the current recording `{name?}` |
| GET / DELETE | `/api/runs/:id` | Full run (frames, events, AI exchanges) / delete |
| POST | `/api/runs/:id/restore` | Load a run's scenario and parameters into the simulator |
| GET | `/api/topics` | Topic table |
| GET | `/api/topics/message?name=/scan` | Last message on a topic |
| GET | `/api/logs?limit=&category=` | Recent events |
| GET | `/api/ai` · `/api/state` | AI inspector data · aggregated state |
| POST | `/api/jev/test` | Health check + one decision with an (optionally patched) AI config |
| GET / POST / DELETE | `/api/robot-configs` | Named robot configurations (`POST /:id/apply`) |

## WebSocket protocol (`/ws`)

Server → client (JSON, `type` discriminated, see `packages/protocol/src/ws.ts`):

| type | rate | payload |
|---|---|---|
| `hello` | on connect | config, scenario, mode, devMode, status, recording |
| `frame` | `simulation.uiFrequency` (20 Hz), 1 Hz heartbeat when paused | `SimFrame`: pose, odom pose, velocities, battery, motors, cmd_vel, decision, safety verdict, mission, latest LiDAR scan, GPS, AI link |
| `logs` | batched every 100 ms | `LogEvent[]` |
| `topics` | 2 Hz | `TopicInfo[]` |
| `topic_messages` | 10 Hz, only for the subscribed topic | last ≤10 `TopicMessage`s |
| `state` / `ai` | 4 Hz | aggregated state / AI inspector |
| `config`, `scenario`, `status` | on change | — |
| `debug` | 1 Hz | tick rates, realtime factor, step time, WS rate, memory |

Client → server: `{type:'manual', throttle, steering}` (10 Hz while held; server dead-man after 600 ms),
`{type:'subscribe_topic', topic}`, `{type:'ping'}`.

Frames are dropped for slow clients (backpressure) — the simulation never waits for the browser.

---

## Development

```bash
npm run dev          # server (tsx watch) + UI (Vite HMR)
npm run lint         # ESLint (typescript-eslint, react-hooks)
npm run typecheck    # tsc strict, server + packages + web
npm test             # Vitest: unit + integration + API
npm run build        # typecheck + production UI bundle
npm run check        # all of the above
```

See [docs/testing.md](docs/testing.md).

## Future ROS2 integration

`REAL_ROBOT` mode is a placeholder today. The plan — implement `Ros2Transport` (rosbridge or rclnodejs) and a
`ROS2SensorProvider`, keeping topic names and message types — is in [docs/ros2-bridge.md](docs/ros2-bridge.md).

## Known limitations

* Obstacles are axis-aligned rectangles and circles; the rover's collision body is a circle.
* No global path planner: the mock policy is reactive and can get stuck in `MAZE` (by design, a benchmark for real models).
* Replay plays recorded frames (10 Hz telemetry, LiDAR at 5 Hz); it is not a re-simulation.
* `REAL_ROBOT` and `Ros2Transport` are interfaces/placeholders only.
