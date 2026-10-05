# Simulation

## World

* Top-down, metres, `x` east/right, `y` north/up, heading CCW from +x (ROS REP-103).
* The world is the rectangle `[0, width] × [0, height]` bounded by walls.
* Obstacles: axis-aligned rectangles (`x, y` centre, `w, h`) and circles (`x, y, r`).

## Rover

Differential drive, two motors.

1. `/cmd_vel` (linear, angular) → diff-drive controller → wheel set-points, clamped to `maxSpeed`/`maxAngularVelocity`
   (ratio-preserving). Without fresh commands for `simulation.cmdVelTimeout` the set-points go to zero (watchdog).
2. Each motor approaches its set-point with `maxAcceleration × (1 − friction)` (braking 2× faster). Unpowered or failed
   motors are dragged to zero by friction. Current ∝ torque (inertia + rolling resistance); temperature follows
   `dT/dt = k·I² − c·(T − 25 °C)`. Faults: `failure`, `overheat`, `high_current`. Above 95 °C the motor derates.
3. Body twist from wheel speeds; midpoint integration of the pose.
4. Collisions: circular body (`0.85 × half-diagonal`) against walls and obstacles. A colliding translation is rejected,
   wheels stall, a `COLLISION` event is logged once per contact. Rotation in place is always possible.
5. Battery: energy in Wh; power = idle + moving·|v|/vmax + turning·|ω|/ωmax (+ extra for motor overcurrent), × consumption
   multiplier × drain failure; open-circuit voltage curve with a knee below 10 % and load sag. `LOW` < 15 %, `CRITICAL`
   < 5 %, `DEAD` at 0 (motors unpowered).

## Sensors

| Sensor | Model |
|---|---|
| LiDAR | ray casting (slab method for boxes, analytic circles, interior walls); `rays` beams over `fieldOfView`; gaussian range noise; dropout → no return; values ≥ `range_max` mean no return |
| IMU | yaw + noise as quaternion; gyro z = ω + random-walk bias + noise; accel x = longitudinal, y = centripetal (v·ω), z = g |
| Odometry | dead reckoning from noisy wheel travel, integrated every physics step → realistic drift |
| GPS | local tangent plane ↔ WGS84 around the configured origin; gaussian horizontal noise; failure → `NO_FIX` |
| Battery / motors | published from the models above |

The aggregator fuses GPS into odometry with a simple complementary filter (outlier rejection), so drift stays bounded
while GPS is available (`robot.localization: "odom+gps"`) and grows during GPS loss (`"odom"`).

## Mission

States: `IDLE → RUNNING ⇄ PAUSED → COMPLETED | FAILED | ABORTED`. Goals are the waypoints followed by the target; a goal
is reached when the **ground-truth** distance is below the tolerance. Failure: battery depleted, time limit, or collision
(if `failOnCollision`).

## Loop & time

* Fixed timestep `dt = 1 / simulation.hz`. Sim time is separate from wall time.
* Real-time scheduler: wakes every ~4 ms, accumulates `wall elapsed × speed`, runs whole steps (≤ 100 ms of sim per wake;
  excess is dropped if the host is too slow — reported as realtime factor < speed in the Debug panel).
* Pause / resume / step / +50 steps / reset, speed ×0.1 … ×10.

## Determinism

* Every stochastic component draws from its own stream `Rng.derive(seed, name)` (mulberry32 + Box–Muller), so changing one
  sensor's rate does not change another sensor's noise.
* In-process engines (mock) are awaited inside the tick; injected AI/network latency is applied in sim time; injected AI
  timeouts fire in sim time.
* Same seed + same scenario + same parameters + same inputs ⇒ bit-identical runs (covered by tests). Remote models are
  deterministic only in `lockstep` mode and only if the model itself is.

## Scenarios

| Preset | Purpose |
|---|---|
| `EMPTY_FIELD` | kinematics, sensors, target tracking |
| `SINGLE_OBSTACLE` | basic avoidance |
| `MAZE` | serpentine walls — defeats reactive policies (benchmark) |
| `NARROW_CORRIDOR` | 1.6 m corridor, side clearance |
| `MULTIPLE_OBSTACLES` | scattered rocks/boxes |
| `TARGET_NAVIGATION` | waypoints then target |
| `OBSTACLE_AVOIDANCE` | dense obstacle field |
| `LOW_BATTERY` | 16 % + 12× drain → LOW_BATTERY, RETURN_HOME, CRITICAL |
| `MOTOR_FAILURE` | left motor overheats → derate → stop |
| `GPS_LOSS` | permanent NO_FIX, odometry only |

Random generator parameters: `numberOfObstacles`, `minimumDistance` (clearance between items), `maximumDistance`
(start → target), `difficulty` (size range and rectangle share), `seed`. Same input ⇒ same scenario.
