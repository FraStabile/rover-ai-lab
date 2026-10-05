import type { AggregatedState, PlannerConfig, RobotConfig, SafetyAction, SafetyConfig } from '@rover/protocol';
import { clamp, deg2rad } from '@rover/shared';
import type { VelocityCommand } from './safety';

/**
 * Translates a high-level action ("what") into a velocity command ("how").
 * Deterministic and model-agnostic.
 */
export class LocalPlanner {
  constructor(
    private readonly planner: () => PlannerConfig,
    private readonly robot: () => RobotConfig,
    private readonly safety: () => SafetyConfig,
  ) {}

  plan(action: SafetyAction, state: AggregatedState): VelocityCommand {
    const p = this.planner();
    const r = this.robot();
    const s = this.safety();
    const turnW = r.maxAngularVelocity * clamp(r.turnRate, 0.05, 1);
    switch (action) {
      case 'STOP':
      case 'EMERGENCY_STOP':
        return { linear: 0, angular: 0 };
      case 'FORWARD':
        return { linear: Math.min(p.cruiseSpeed, r.maxSpeed), angular: 0 };
      case 'SLOW_DOWN': {
        // Keep a gentle heading correction toward the goal while slowing.
        const b = state.target ? deg2rad(state.target.bearing) : 0;
        return { linear: Math.min(p.slowSpeed, r.maxSpeed), angular: clamp(p.headingGain * b * 0.5, -turnW * 0.5, turnW * 0.5) };
      }
      case 'REVERSE':
        return { linear: -Math.abs(p.reverseSpeed), angular: 0 };
      case 'TURN_LEFT':
      case 'TURN_RIGHT': {
        const span = Math.max(0.05, s.slowDownDistance - s.emergencyStopDistance);
        const freedom = clamp((state.obstacles.front - s.emergencyStopDistance) / span, 0, 1);
        const sign = action === 'TURN_LEFT' ? 1 : -1;
        return { linear: p.turnLinearSpeed * freedom, angular: sign * turnW };
      }
      case 'REACH_TARGET':
        return state.target ? this.pursue(state.target.bearing, state.target.distance) : { linear: 0, angular: 0 };
      case 'RETURN_HOME':
        return this.pursue(state.home.bearing, state.home.distance);
      default:
        return { linear: 0, angular: 0 };
    }
  }

  private pursue(bearingDeg: number, distance: number): VelocityCommand {
    const p = this.planner();
    const r = this.robot();
    const err = deg2rad(bearingDeg);
    const angular = clamp(p.headingGain * err, -r.maxAngularVelocity, r.maxAngularVelocity);
    // Rotate in place for large errors, decelerate near the goal.
    const align = Math.abs(err) > Math.PI / 3 ? 0 : Math.cos(err);
    const approachScale = clamp(distance / 2, 0.25, 1);
    return { linear: Math.min(p.cruiseSpeed, r.maxSpeed) * align * approachScale, angular };
  }
}
