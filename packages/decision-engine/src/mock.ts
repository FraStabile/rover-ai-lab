import type { AggregatedState, AiAction, DecisionResult, HealthStatus, ModelInfo } from '@rover/protocol';
import type { DecideOptions, DecisionEngine } from './engine';

export interface MockEngineOptions {
  /** Clearance (m) below which the mock starts avoiding. */
  avoidDistance: number;
  /** Clearance (m) the front must reach before the avoidance manoeuvre ends. */
  clearDistance: number;
  /** Bearing (deg) above which the mock turns toward the goal. */
  bearingThreshold: number;
  lowBattery: number;
  goalTolerance: number;
}

const DEFAULTS: MockEngineOptions = { avoidDistance: 1.2, clearDistance: 2.0, bearingThreshold: 45, lowBattery: 15, goalTolerance: 0.5 };

/**
 * Deterministic rule-based policy that stands in for Jev.
 * Reactive obstacle avoidance with a sticky turn direction, then goal seeking.
 */
export class MockDecisionEngine implements DecisionEngine {
  readonly id = 'mock';
  readonly deterministic = true;
  private avoidDir: 'LEFT' | 'RIGHT' | null = null;
  private readonly opts: MockEngineOptions;

  constructor(opts: Partial<MockEngineOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  reset(): void {
    this.avoidDir = null;
  }

  decideSync(state: AggregatedState): { action: AiAction; confidence: number; reason: string } {
    const o = state.obstacles;
    const { avoidDistance, clearDistance, bearingThreshold, lowBattery, goalTolerance } = this.opts;

    if (state.mission.state !== 'RUNNING') return { action: 'STOP', confidence: 1, reason: `Mission ${state.mission.state}` };
    if (state.battery.state === 'CRITICAL' || state.battery.state === 'DEAD') return { action: 'STOP', confidence: 1, reason: 'Battery critical' };
    if (!o.valid) return { action: 'STOP', confidence: 0.9, reason: 'No LiDAR data' };

    const returning = state.battery.percentage < lowBattery;
    const goal = returning ? { distance: state.home.distance, bearing: state.home.bearing } : state.target;
    if (!goal) return { action: 'STOP', confidence: 1, reason: 'No target' };
    const tolerance = Math.min(goalTolerance, state.mission.tolerance * 0.6);
    if (goal.distance < tolerance) return { action: 'STOP', confidence: 0.95, reason: returning ? 'Home reached' : 'Target reached' };

    if (o.front < avoidDistance || (this.avoidDir && o.front < clearDistance)) {
      if (!this.avoidDir) {
        const leftSpace = o.frontLeft + o.left * 0.5;
        const rightSpace = o.frontRight + o.right * 0.5;
        // Prefer the side of the goal when both are similar.
        if (Math.abs(leftSpace - rightSpace) < 0.3) this.avoidDir = goal.bearing >= 0 ? 'LEFT' : 'RIGHT';
        else this.avoidDir = leftSpace > rightSpace ? 'LEFT' : 'RIGHT';
      }
      if (o.front < 0.3 && o.frontLeft < 0.3 && o.frontRight < 0.3) {
        return { action: 'REVERSE', confidence: 0.7, reason: `Boxed in (front ${o.front.toFixed(2)} m)` };
      }
      const conf = Math.min(0.99, 0.6 + (avoidDistance - Math.min(o.front, avoidDistance)) / avoidDistance * 0.4);
      return { action: this.avoidDir === 'LEFT' ? 'TURN_LEFT' : 'TURN_RIGHT', confidence: conf, reason: `Obstacle detected in front (${o.front.toFixed(2)} m)` };
    }
    this.avoidDir = null;

    // Obstacle grazing a front corner: steer away from it.
    const corner = Math.min(o.frontLeft, o.frontRight);
    if (corner < 0.5) {
      const awayLeft = o.frontRight < o.frontLeft;
      return { action: awayLeft ? 'TURN_LEFT' : 'TURN_RIGHT', confidence: 0.75, reason: `Obstacle at front-${awayLeft ? 'right' : 'left'} corner (${corner.toFixed(2)} m)` };
    }

    if (Math.abs(goal.bearing) > bearingThreshold) {
      const left = goal.bearing > 0;
      const side = left ? o.frontLeft : o.frontRight;
      if (side < 0.8) return { action: 'FORWARD', confidence: 0.6, reason: `Goal ${left ? 'left' : 'right'} but side blocked (${side.toFixed(2)} m)` };
      return {
        action: left ? 'TURN_LEFT' : 'TURN_RIGHT',
        confidence: 0.85,
        reason: `${returning ? 'Home' : 'Target'} bearing ${goal.bearing.toFixed(0)}°`,
      };
    }
    if (o.front < 2.5) return { action: 'SLOW_DOWN', confidence: 0.8, reason: `Obstacle at ${o.front.toFixed(2)} m` };
    if (returning) return { action: 'RETURN_HOME', confidence: 0.9, reason: `Low battery (${state.battery.percentage.toFixed(0)}%)` };
    return { action: 'REACH_TARGET', confidence: 0.9, reason: `Path clear, target ${goal.distance.toFixed(1)} m` };
  }

  async decide(state: AggregatedState, _opts: DecideOptions): Promise<DecisionResult> {
    const d = this.decideSync(state);
    const decision = { ...d, timestamp: Date.now() };
    return { decision, latencyMs: 0, raw: { request: { engine: 'mock' }, response: decision } };
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, latencyMs: 0, message: 'Mock engine always available' };
  }

  getModelInfo(): ModelInfo {
    return { provider: 'mock', model: 'rule-based-v1', description: 'Deterministic reactive policy (no AI)' };
  }
}
