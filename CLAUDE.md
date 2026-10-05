# CLAUDE.md

Rover AI Lab: a web lab to develop and test an autonomous rover's software without the physical rover.
A deterministic 2D simulator publishes ROS2-shaped topics; a decision model (Jev via jevos, a mock, or any HTTP
model) picks a high-level action; a deterministic SafetyController and LocalPlanner turn it into `/cmd_vel`.
Read `README.md` and `docs/architecture.md` before structural changes.

## Commands

```bash
npm install
npm run dev            # API/sim server :3001 + Vite UI :3000 (open http://localhost:3000)
npm run dev:jev        # same, plus the local jevos server on :8017
npm run jev            # jevos only (auto-installs it if missing, see below)
npm run jev:install    # (re)install jevos explicitly
npm run mock-jev       # stand-in Jev server on :8017, no download
npm run check          # lint + typecheck + tests + build: must pass before any commit
npm test               # Vitest only
npm run compare -- --jev http://127.0.0.1:8017   # headless benchmark, mock vs Jev, same seed
```

Node >= 22.13 (SQLite uses the built-in `node:sqlite`, no native modules).

## Jev (jevos) on this machine

Jev is [jevos](https://github.com/feder-cr/jev), installed locally in `.jev/` (gitignored) by
`scripts/install-jev.sh`. Before any task that needs a real Jev (running the lab with `AI_PROVIDER=local-jev`,
benchmarks against Jev, debugging the systemone adapter):

1. Check whether it is installed: `test -x .jev/current/jev`.
2. If it is missing, install it automatically: `npm run jev:install` (non-interactive; downloads ~650 MB from the
   feder-cr/jev GitHub release, verifies SHA-256, writes `.env`, runs a smoke test). Do not ask first: this is the
   project's standard setup step. Run it in the background or with a long timeout.
3. `npm run jev` / `npm run dev:jev` also install it on first use if it is missing (`JEV_NO_AUTO_INSTALL=1` disables
   this).
4. Supported by the script: macOS arm64 and Linux x86_64. On other platforms do not improvise: report it and point to
   the manual steps in `README.md` (Installing Jev → Manual install), or use `npm run mock-jev`.
5. jevos and `mock-jev` both use port 8017: never run them together. Check with `curl -s 127.0.0.1:8017/health`
   (`"status": "ready"`).

Never commit `.jev/`, model files, `.env` or `data/*.db`. If jevos needs an API key, it comes from the `JEV_API_KEY`
environment variable only; never write it into config, code or recorded runs.

## Architecture rules (do not break)

- The AI never commands motors. The chain is always AI → `SafetyController` → `LocalPlanner` → `/cmd_vel` →
  robot controller. Safety and planner stay deterministic and free of AI calls.
- The decision layer (`packages/autonomy`, `decision-engine`, `jev-adapter`) talks to the robot only through
  `RobotTransport` topics. It must not import `packages/simulation`. This is what lets `Ros2Transport` replace the
  simulator later.
- Provider formats stay inside adapters. Everything else uses the internal `Decision` schema
  (`packages/protocol/src/decision.ts`). New Jev wire details go in `packages/jev-adapter`.
- The simulation must stay deterministic: randomness only via `Rng.derive(seed, name)`, injected latencies and
  timeouts in sim time. Seeded-run tests in `packages/runtime/test` must keep passing.
- No Jev/HTTP calls from React components or from the simulation engine.
- Errors never crash the loop: adapters return error results, ticks are wrapped and logged.

## Layout

- `packages/protocol`: shared types (messages, topics, config defaults, WS protocol). Start here for any new field.
- `packages/autonomy/src/stack.ts`: AI scheduling (interval, timeout, retries, stale decisions).
- `packages/jev-adapter`: `LocalJevAdapter` (`systemone` default, `native`, `openai-chat`), `CustomHttpAdapter`.
- `packages/runtime`: `RoverRuntime` composition root, realtime loop, recorder.
- `apps/server`: Fastify REST + WebSocket hub + SQLite (Drizzle over `node:sqlite`).
- `apps/web`: React/Vite/Tailwind/Zustand UI. The canvas reads high-rate data from `lib/live.ts`, not React state.

## Conventions

- TypeScript strict, ESM, workspace packages imported as `@rover/<name>` (source `.ts`, no build step).
- Angles: radians internally; degrees in `AggregatedState`, CCW positive (bearing > 0 = target to the left).
- New config fields: add to `packages/protocol/src/config.ts` with a default; they become live-editable through
  `PATCH /api/config`. Add the UI control in `apps/web/src/panels/ConfigPanels.tsx`.
- Tests next to each package in `test/`; safety-relevant changes need a test in `packages/autonomy/test/safety.test.ts`.
- In dev the API port is `API_PORT` (3001); `PORT` is only for production (`npm start`, Docker, :3000).
