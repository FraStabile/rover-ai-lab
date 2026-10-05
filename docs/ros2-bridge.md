# ROS2 bridge (future work)

`REAL_ROBOT` mode is a placeholder: selecting it disables the simulator and shows the mode clearly in the UI. The code is
structured so that the real rover plugs in at the transport level.

## What stays the same

* `StateAggregator`, `DecisionEngine` (Mock/Jev/Custom), `SafetyController`, `LocalPlanner`, `AutonomyStack`.
* Topic names and message types (`packages/protocol/src/messages.ts`), which mirror ROS2:

| Topic | Type | Direction |
|---|---|---|
| `/scan` | `sensor_msgs/LaserScan` | robot → autonomy |
| `/imu` | `sensor_msgs/Imu` | robot → autonomy |
| `/odom` | `nav_msgs/Odometry` | robot → autonomy |
| `/gps` | `sensor_msgs/NavSatFix` | robot → autonomy |
| `/battery` | `sensor_msgs/BatteryState` | robot → autonomy |
| `/motor_state` | `rover_msgs/MotorState` (custom) | robot → autonomy |
| `/mission` | `rover_msgs/MissionStatus` (custom) | mission node → autonomy |
| `/cmd_vel` | `geometry_msgs/Twist` | autonomy → robot |
| `/decision`, `/safety`, `/rover_state` | custom, diagnostics | autonomy → monitoring |

## What has to be implemented

1. **`Ros2Transport implements RobotTransport`** (`packages/transport/src/ros2-transport.ts`). Two options:
   * **rosbridge_suite** (recommended first): WebSocket JSON to `ws://<rover>:9090`; `subscribe` → `{op:"subscribe"}`,
     `publish` → `{op:"publish"}`. No native dependencies; works from the existing Node server.
   * **rclnodejs**: native ROS2 client in Node; lower latency, requires a ROS2 installation on the host.
   Stamps: convert `builtin_interfaces/Time` to seconds for `TopicMessage.simTime`; keep wall time for the UI.
2. **`ROS2SensorProvider implements SensorProvider`** — trivial with a ROS2 transport: real drivers publish the sensor
   topics; the provider only reports health.
3. **Clock**: in `REAL_ROBOT` mode the runtime clock must follow ROS time instead of the simulation clock.
4. **Mission**: run `MissionManager` against `/odom` (or a localisation topic) instead of ground truth, or as a ROS node.
5. **Runtime wiring**: in `RoverRuntime`, when `devMode === 'REAL_ROBOT'`, build the `AutonomyStack` on a `Ros2Transport`
   and skip `SimulationEngine`. The UI already consumes only frames/topics, so it needs no changes beyond hiding the
   simulator controls.
6. **Safety on the robot**: keep a hardware/firmware watchdog on `/cmd_vel` (the simulator models it with
   `simulation.cmdVelTimeout`) and an independent e-stop.

## Never do

Do not connect ROS2 directly to the Jev API. The architecture must remain:

```
ROS2 / Simulation → sensor abstraction → world state → DecisionEngine → JevAdapter → Decision → Safety → Planner → RobotTransport
```
