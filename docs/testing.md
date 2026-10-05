# Testing

```bash
npm test            # all suites (Vitest)
npm run test:watch
npm run lint
npm run typecheck
npm run check       # lint + typecheck + tests + production build
```

## Suites

| File | Covers |
|---|---|
| `packages/shared/test` | seeded RNG (determinism, gaussian stats), angle wrapping, ray/shape intersection, config merge, rate meter |
| `packages/transport/test` | topic delivery, stats, stale detection, subscriber error isolation |
| `packages/robot-model/test` | kinematics, controller limits, motor acceleration/failure/overheat, battery drain & thresholds |
| `packages/sensor-models/test` | LiDAR ranges & geometry & seeded noise, odometry integration, GPS conversions |
| `packages/simulation/test` | PhysicsEngine (accel/speed limits, turning, watchdog), CollisionDetector (no penetration, single COLLISION event), sensor rates, LiDAR failure, mission completion, ScenarioGenerator determinism & clearance, scenario validation |
| `packages/decision-engine/test` | decision validation/normalisation, JSON extraction, MockDecisionEngine rules, fault injection |
| `packages/jev-adapter/test` | LocalJevAdapter (native + OpenAI against a real local HTTP server, invalid JSON/decision, HTTP errors, timeout, offline, health), CustomHttpAdapter (templates, mapping, action map) |
| `packages/autonomy/test` | **SafetyController** (incl. the fundamental rule), LocalPlanner, StateAggregator |
| `packages/runtime/test` | integration Simulation → Aggregator → Mock → Safety → Planner → Motor, AI timeout, invalid responses, latency injection, offline Jev, determinism (same seed, different seed, reset), recording |
| `apps/server/test` | REST API with an in-memory SQLite DB: health, topics, config patch, control + run save/load/delete, scenario CRUD, generator, Jev test, input validation |

## The fundamental safety test

`packages/autonomy/test/safety.test.ts`:

> if the front obstacle is closer than `safety.emergencyStopDistance` and the AI says `FORWARD`, the
> `SafetyController` must produce `EMERGENCY_STOP` and a zero velocity command.

An end-to-end variant (`runtime/test/integration.test.ts`) drives an engine that *always* answers `FORWARD` toward a wall
and asserts zero collisions and at least one `EMERGENCY_STOP`.

## Benchmarks

`npm run compare` runs every preset headless with the same seed and prints result, time, distance, collisions,
decisions, safety overrides and remaining battery per engine (`--jev <url>` adds the Local Jev adapter in lockstep).
