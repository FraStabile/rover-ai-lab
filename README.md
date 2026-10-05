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
* To drive the rover with **Jev** (jevos, a local Jev-compatible model): `npm run jev:install` once, then
  `npm run dev:jev` and pick **SIM + LOCAL AI** in the top bar. See [Installing Jev](#installing-jev-jevos).
  Without downloading the model, `npm run mock-jev` starts a stand-in on the same port.

Production / single process (UI + API on `:3000`):

```bash
npm run build
npm start
```

Docker:

```bash
docker compose up --build                     # http://localhost:3000
docker compose --profile mock-jev up --build  # also starts the mock Jev server on :8017
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
scripts/            install-jev.sh, run-jev.sh, mock-jev-server.ts, compare-engines.ts
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
| `JEV_BASE_URL` (alias `JEV_URL`) | `http://127.0.0.1:8017` | Jev server base URL (jevos default port) |
| `JEV_MODEL` | `jev-latest` | Model name sent to the server |
| `JEV_TIMEOUT` | `1000` | AI request timeout (ms) |
| `JEV_PROTOCOL` | `systemone` | `systemone` (jevos / Jev wire format), `native` (JSON state → JSON decision) or `openai-chat` |
| `JEV_DECIDE_PATH` / `JEV_HEALTH_PATH` | empty | Override the protocol's paths (`/v1/systemone` + `/health`, `/decide` + `/health`, `/v1/chat/completions` + `/v1/models`) |
| `JEV_INSTRUCTIONS` | built-in policy | systemone: the driving policy written into the jevos question |
| `JEV_API_KEY` | — | Bearer key, only if jevos runs with `JEV_API_KEY`; read at request time, never stored in the config |
| `CUSTOM_AI_URL` | — | Initial URL for the custom HTTP provider |
| `SIMULATION_DEFAULT_HZ` | `50` | Physics rate |
| `SIMULATION_SEED` | `12345` | Default random seed |

Everything else (robot, sensors, AI timing, safety, planner, failures) is editable live from the UI or `PATCH /api/config`.

---

## Installing Jev (jevos)

**Jev** here is [**jevos**](https://github.com/feder-cr/jev) (MIT): an open-source, Jev-compatible model that answers
yes/no and multiple-choice questions on a laptop CPU in roughly 25–170 ms. It ships as a single binary (C++, OpenVINO,
no Python, no GPU) plus an ~630 MB int8 model, and serves the Jev wire format on `http://127.0.0.1:8017`.

### Automatic install (macOS Apple Silicon, Linux x86_64)

```bash
npm run jev:install      # = bash scripts/install-jev.sh
```

The script:

1. detects the platform and resolves the latest release of `feder-cr/jev` (currently `jevos-v4`);
2. downloads the server (`jev-macos-arm64.tar.gz` or `jev-linux-x64.tar.gz`) and the model
   (`jevos-v4-openvino-int8.zip`) into `.jev/downloads/` (resumable, ~650 MB the first time);
3. verifies both files against the release's `SHA256SUMS.txt`;
4. unpacks them into `.jev/<tag>/jev/` with the model in `jev/model/`, and links `.jev/current`;
5. creates or updates `.env` with `AI_PROVIDER=local-jev`, `JEV_PROTOCOL=systemone`, `JEV_BASE_URL=http://127.0.0.1:8017`,
   `JEV_MODEL=jev-latest`;
6. starts jevos once, waits for `/health` to report `ready` and asks it one test question.

Options: `--tag jevos-v3` (a specific release), `--dir <path>`, `--port <port>`, `--no-env`, `--skip-test`, `--dry-run`
(only checks that the release files exist). `.jev/` is gitignored.

Then:

```bash
npm run dev:jev          # jevos + simulation server + UI together
# or in two terminals:
npm run jev              # = .jev/current/jev serve   (extra args: npm run jev -- --threads 8)
npm run dev
```

Open http://localhost:3000. The top bar shows **AI: CONNECTED**. Switch to **AUTO** and press **▶ RUN**.

### Manual install (any platform, including Windows)

1. From the [release page](https://github.com/feder-cr/jev/releases/latest) download the server for your system
   (`jev-windows-x64.zip`, `jev-linux-x64.tar.gz` or `jev-macos-arm64.tar.gz`) and `jevos-v4-openvino-int8.zip`.
2. Unpack the server, then unpack the model inside the `jev` folder so it sits in `jev/model`:

   ```bash
   tar -xzf jev-macos-arm64.tar.gz          # Windows: unzip jev-windows-x64.zip
   cd jev
   unzip ../jevos-v4-openvino-int8.zip      # creates model/
   ./jev serve                              # Windows: jev.exe serve   → http://127.0.0.1:8017
   ```

3. Start the lab pointing at it:

   ```bash
   AI_PROVIDER=local-jev JEV_PROTOCOL=systemone JEV_BASE_URL=http://127.0.0.1:8017 npm run dev
   ```

   or from the UI: **AI → Local Jev**, Base URL `http://127.0.0.1:8017`, Protocol **jevos / systemone**, **TEST**.

Useful `jev serve` options: `--threads` (fewer if other heavy apps run), `--port`, `--state-cache 0` (no text cache).
If you start jevos with `JEV_API_KEY=...`, export the same variable before `npm run dev`: the lab sends it as a bearer
token.

### How the lab asks jevos

jevos answers questions about a state; it does not generate free text. The adapter (`JEV_PROTOCOL=systemone`) sends
the rover's aggregated state and **one `choice` question** whose options are the eight actions:

```json
POST http://127.0.0.1:8017/v1/systemone
{
  "model": "jev-latest",
  "state": { "robot": { … }, "obstacles": { "front": 1.4, … }, "target": { "bearing": 15, … }, … },
  "questions": {
    "action": {
      "type": "choice",
      "instructions": "You are the driving policy of a small ground rover. … Rules, in order: … Which action should the rover take now?",
      "criteria": { "FORWARD": "drive straight ahead at cruise speed", "TURN_LEFT": "turn left …", "STOP": "stand still", "…": "…" }
    }
  }
}
```

```json
{ "model": "jevos-v4",
  "answers": { "action": { "type": "choice", "choice": "TURN_LEFT",
               "probabilities": { "TURN_LEFT": 0.62, "FORWARD": 0.2, "…": 0.0 }, "confidence": 0.41 } } }
```

The answer becomes the internal decision `{action: "TURN_LEFT", confidence: 0.62, reason: "jevos choice (confidence 0.41): …"}`
and goes through the deterministic safety layer as usual. jevos reads the rule from the question, so **the driving policy
is the `instructions` text**: edit it in **AI → Local Jev → Policy** (or `JEV_INSTRUCTIONS`) and compare runs with the same
seed. Eight options cost about 150 ms per decision on a laptop CPU, comfortably inside the default 500 ms interval.

### Without the model: the stand-in server

```bash
npm run mock-jev         # http://127.0.0.1:8017, same endpoints as jevos (+ /decide and OpenAI ones)
```

It answers with the built-in rule policy and 120±60 ms of latency. Options: `MOCK_JEV_PORT`, `MOCK_JEV_LATENCY`,
`MOCK_JEV_JITTER`, `MOCK_JEV_ERROR_RATE` (0–1). Do not run it together with `npm run jev`: both use port 8017.

### Other models

* **OpenAI-compatible servers** (Ollama, llama.cpp `llama-server`, vLLM, LM Studio): `JEV_PROTOCOL=openai-chat`,
  e.g. `JEV_BASE_URL=http://localhost:11434 JEV_MODEL=qwen2.5:3b JEV_TIMEOUT=3000` for Ollama.
* **Your own server**: `JEV_PROTOCOL=native` and implement `GET /health` + `POST /decide` returning
  `{action, confidence, reason}`; or map any format from **AI → Custom HTTP**. Contract in
  [docs/jev-integration.md](docs/jev-integration.md).

## Jev setup

1. Run jevos (see above) or another Jev-like model behind an HTTP endpoint (contract in
   [docs/jev-integration.md](docs/jev-integration.md)).
2. In the UI: **AI → Local Jev**, set *Base URL*/*Model*, press **TEST**, or start with
   `AI_PROVIDER=local-jev JEV_BASE_URL=http://127.0.0.1:8017 npm run dev`.
3. The top bar shows `AI: CONNECTED` / `OFFLINE` / `TIMEOUT`. If Jev is down the simulation keeps running and the safety
   layer applies the *On AI timeout* policy (default: STOP).

Compare engines headless with the same seed:

```bash
npm run compare                                   # mock on every preset
npm run compare -- --jev http://127.0.0.1:8017 --scenarios SINGLE_OBSTACLE,MAZE --seed 7
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
