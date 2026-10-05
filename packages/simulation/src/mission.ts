import { MSG_TYPES, TOPICS, type MissionState, type MissionStatusMsg, type Point2, type RobotTransport, type Scenario } from '@rover/protocol';
import type { EventLogger } from '@rover/logging';

/** Tracks mission progress against ground truth (the "referee" of the simulation). */
export class MissionManager {
  state: MissionState = 'IDLE';
  goals: Point2[] = [];
  goalIndex = 0;
  home: Point2 = { x: 0, y: 0 };
  elapsed = 0;
  reason = '';
  private scenario!: Scenario;
  private lastPublish = -Infinity;
  private seq = 0;

  constructor(
    private readonly transport: RobotTransport,
    private readonly logger: EventLogger,
  ) {
    transport.advertise(TOPICS.mission, MSG_TYPES.MissionStatus, '/mission_manager', 2);
  }

  load(scenario: Scenario): void {
    this.scenario = scenario;
    const goals: Point2[] = [...scenario.waypoints];
    if (scenario.target) goals.push(scenario.target);
    this.goals = scenario.mission.objective === 'FREE_ROAM' ? [] : goals;
    this.goalIndex = 0;
    this.home = { x: scenario.rover.x, y: scenario.rover.y };
    this.elapsed = 0;
    this.reason = '';
    this.state = 'IDLE';
    this.seq = 0;
    this.lastPublish = -Infinity;
  }

  get goal(): Point2 | null {
    return this.goals[this.goalIndex] ?? null;
  }

  start(): void {
    if (this.state === 'IDLE' || this.state === 'PAUSED') this.transition(this.state === 'IDLE' ? 'RUNNING' : 'RUNNING', 'started');
  }

  pause(): void {
    if (this.state === 'RUNNING') this.transition('PAUSED', 'paused by operator');
  }

  abort(): void {
    if (this.state === 'RUNNING' || this.state === 'PAUSED') this.transition('ABORTED', 'aborted by operator');
  }

  update(simTime: number, dt: number, x: number, y: number, ctx: { batteryDead: boolean; newCollision: boolean }): void {
    if (this.state === 'RUNNING') {
      this.elapsed += dt;
      const g = this.goal;
      if (g && Math.hypot(g.x - x, g.y - y) <= this.scenario.mission.tolerance) {
        const last = this.goalIndex === this.goals.length - 1;
        this.logger.info(last ? 'TARGET_REACHED' : 'WAYPOINT_REACHED', 'MissionManager', `${last ? 'Target' : `Waypoint ${this.goalIndex + 1}`} reached at (${g.x.toFixed(1)}, ${g.y.toFixed(1)})`, { goal: g, elapsed: this.elapsed });
        this.goalIndex++;
        if (this.goalIndex >= this.goals.length) this.transition('COMPLETED', 'all goals reached');
      } else if (ctx.batteryDead) {
        this.transition('FAILED', 'battery depleted');
      } else if (this.scenario.mission.maxDuration > 0 && this.elapsed > this.scenario.mission.maxDuration) {
        this.transition('FAILED', 'time limit exceeded');
      } else if (ctx.newCollision && this.scenario.mission.failOnCollision) {
        this.transition('FAILED', 'collision');
      }
    }
    if (simTime - this.lastPublish >= 0.5) this.publish(simTime);
  }

  message(simTime: number): MissionStatusMsg {
    return {
      header: { stamp: simTime, frame_id: 'map', seq: this.seq },
      state: this.state,
      goal: this.goal,
      goalIndex: this.goalIndex,
      goalCount: this.goals.length,
      home: this.home,
      tolerance: this.scenario.mission.tolerance,
      elapsed: this.elapsed,
      reason: this.reason,
    };
  }

  publish(simTime: number): void {
    this.lastPublish = simTime;
    this.seq++;
    this.transport.publish(TOPICS.mission, this.message(simTime));
  }

  private transition(next: MissionState, reason: string): void {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    this.reason = reason;
    this.logger.log({
      type: 'MISSION_STATE',
      source: 'MissionManager',
      message: `Mission ${prev} → ${next} (${reason})`,
      level: next === 'FAILED' ? 'warn' : 'info',
      payload: { prev, next, reason },
    });
    this.lastPublish = -Infinity;
  }
}
