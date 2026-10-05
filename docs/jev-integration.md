# Jev integration

The rover never depends on Jev's wire format. `LocalJevAdapter` (or `CustomHttpAdapter`) converts whatever the model
returns into the internal decision:

```json
{ "action": "TURN_LEFT", "confidence": 0.91, "reason": "Obstacle detected in front", "timestamp": 1790869000000 }
```

Allowed actions: `FORWARD`, `TURN_LEFT`, `TURN_RIGHT`, `REVERSE`, `STOP`, `SLOW_DOWN`, `REACH_TARGET`, `RETURN_HOME`.
Aliases (`left`, `go`, `halt`, …) are normalised; confidence may be 0–1 or 0–100.

## Native protocol (`JEV_PROTOCOL=native`)

`POST {JEV_BASE_URL}{JEV_DECIDE_PATH}` (default `/decide`):

```json
{
  "schema_version": "rover-ai-lab/1",
  "model": "default",
  "state": {
    "timestamp": 1790869000000,
    "simTime": 12.45,
    "robot":     { "x": 12.4, "y": 8.2, "heading": 37, "speed": 0.8, "angularVelocity": 0.02, "localization": "odom+gps" },
    "obstacles": { "front": 1.4, "frontLeft": 3.8, "frontRight": 0.8, "left": 4.5, "right": 1.2, "nearest": 0.8, "valid": true },
    "target":    { "x": 30, "y": 15, "distance": 24.3, "bearing": 15 },
    "home":      { "distance": 8.1, "bearing": -170 },
    "battery":   { "percentage": 72, "voltage": 24.6, "state": "GOOD" },
    "motors":    { "left": "OK", "right": "OK", "maxTemperature": 31.2 },
    "gps":       { "fix": true, "latitude": 45.46427, "longitude": 9.19016 },
    "mission":   { "state": "RUNNING", "goalIndex": 0, "goalCount": 1, "tolerance": 0.6 },
    "sensors":   { "lidar": "OK", "imu": "OK", "odom": "OK", "gps": "OK" }
  },
  "allowed_actions": ["FORWARD", "TURN_LEFT", "..."],
  "response_format": { "action": "string", "confidence": "number 0..1", "reason": "string" }
}
```

Conventions: metres and degrees; **bearing > 0 means the target is to the LEFT** (ROS REP-103, CCW positive);
`obstacles.*` are clearances from the rover body, per LiDAR sector (front ±15°, frontLeft 15–60°, left 60–135°, mirrored
on the right).

Accepted response shapes (first match wins):

* `{ "action": …, "confidence": …, "reason": … }`
* `{ "decision": { … } }`
* `{ "output" | "response" | "text" | "content" | "result": "<JSON text>" }`
* OpenAI style `{ "choices": [{ "message": { "content": "<JSON text>" } }] }` — JSON may be wrapped in prose or ``` fences.

Health: `GET {JEV_BASE_URL}{JEV_HEALTH_PATH}` (default `/health`). Any 2xx is "connected"; if the body contains `model`
/ `version` they appear in the AI Inspector.

## OpenAI-compatible protocol (`JEV_PROTOCOL=openai-chat`)

For model servers exposing `/v1/chat/completions` (llama.cpp server, vLLM, Ollama, LM Studio …). The adapter sends a
system prompt describing the contract and the state as the user message, with `response_format: {type: "json_object"}`
and the configured temperature. Health uses `GET /v1/models`.

## Custom HTTP provider

**AI → Custom HTTP** configures any endpoint without code:

* URL, method, headers (JSON);
* request template with placeholders `{{state}}`, `{{model}}`, `{{actions}}` and dotted paths like `{{state.robot.x}}`
  (a value that is exactly a placeholder keeps its JSON type);
* response mapping as dotted paths (`result.move`, `choices.0.message.content`, …);
* action map, e.g. `{"left": "TURN_LEFT", "go": "FORWARD"}`.

## Timing, timeouts and failures

* Decisions are requested every `ai.decisionIntervalMs` of **sim time**, never on every tick, and never while one is in
  flight.
* `ai.timeoutMs` aborts the HTTP request; `ai.retries` retries timeouts/network errors.
* A decision older than `max(ai.staleAfterMs, 2 × interval)` is treated as `AI_TIMEOUT`.
* `ai.syncMode = realtime` (default): the simulation never waits for the model. `lockstep`: the simulation waits for each
  answer — use it for reproducible benchmarks of deterministic models.
* Whatever happens, the simulation keeps running and the safety controller decides (default policy: STOP).
* Failure injection: AI timeout, invalid response, inference latency, network latency with jitter.

## Testing without the real model

```bash
npm run mock-jev            # :8000, native + OpenAI endpoints, latency 120±60 ms
MOCK_JEV_LATENCY=600 MOCK_JEV_ERROR_RATE=0.1 npm run mock-jev
```

Then **SIM + LOCAL AI** in the top bar (or **AI → Local Jev → TEST**).
