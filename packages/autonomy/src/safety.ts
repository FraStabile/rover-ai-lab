import type { AggregatedState, ControlMode, DecisionErrorCode, SafetyAction, SafetyConfig, SafetyRule, SafetyVerdict, RobotConfig } from '@rover/protocol';

export interface SafetyInput {
  mode: ControlMode;
  /** AI action (AUTO) or 'MANUAL'. null when no decision is available yet. */
  requested: SafetyAction | 'MANUAL' | null;
  /** Manual command (MANUAL mode). */
  manual?: { linear: number; angular: number };
  state: AggregatedState;
  estop: boolean;
  aiError: DecisionErrorCode | null;
  aiStale: boolean;
}

export interface VelocityCommand {
  linear: number;
  angular: number;
}

const FORWARD_ACTIONS: ReadonlySet<string> = new Set(['FORWARD', 'REACH_TARGET', 'RETURN_HOME', 'SLOW_DOWN']);

function verdict(
  kind: SafetyVerdict['verdict'],
  action: SafetyAction,
  requested: SafetyInput['requested'],
  rule: SafetyRule,
  reason: string,
  speedScale = 1,
  maxForward = Infinity,
): SafetyVerdict & { maxForward: number } {
  return { verdict: kind, action, requested, rule, reason, speedScale, maxForward };
}

export type SafetyDecision = ReturnType<typeof verdict>;

/**
 * Deterministic rule-based safety layer between the decision engine and the planner.
 * The AI can only *request*; this layer decides what is allowed. Rules are evaluated
 * in priority order and the first blocking rule wins.
 */
export class SafetyController {
  constructor(
    private readonly safety: () => SafetyConfig,
    private readonly robot: () => RobotConfig,
  ) {}

  evaluate(input: SafetyInput): SafetyDecision {
    const cfg = this.safety();
    const { state, requested, mode } = input;
    const manual = mode === 'MANUAL';
    const req = requested;

    if (input.estop) return verdict('BLOCK', 'EMERGENCY_STOP', req, 'EMERGENCY_STOP_LATCHED', 'Emergency stop engaged', 0, 0);
    if (manual && !cfg.applyInManual) return verdict('ALLOW', 'STOP', req, 'NONE', 'Safety disabled in manual mode');

    if (!manual) {
      if (state.mission.state !== 'RUNNING') {
        const k = req === 'STOP' || req === null ? 'ALLOW' : 'OVERRIDE';
        return verdict(k, 'STOP', req, 'MISSION_INACTIVE', `Mission ${state.mission.state}: motion not allowed`, 0, 0);
      }
      if (input.aiError === 'INVALID_DECISION' || input.aiError === 'INVALID_JSON') {
        return verdict('BLOCK', 'STOP', req, 'INVALID_AI_RESPONSE', `Invalid AI response (${input.aiError})`, 0, 0);
      }
      if (input.aiStale || input.aiError === 'TIMEOUT') {
        if (cfg.onAiTimeout === 'STOP' || req === null) return verdict('BLOCK', 'STOP', req, 'AI_TIMEOUT', 'AI timeout: stopping', 0, 0);
        if (cfg.onAiTimeout === 'SLOW_DOWN') return verdict('OVERRIDE', 'SLOW_DOWN', req, 'AI_TIMEOUT', 'AI timeout: degraded slow mode', 0.5);
        // CONTINUE_LAST falls through with a speed penalty.
      }
      if (req === null) return verdict('BLOCK', 'STOP', req, 'NO_DECISION', 'Waiting for first AI decision', 0, 0);
    }

    if (state.motors.left === 'MOTOR_FAILURE' || state.motors.right === 'MOTOR_FAILURE') {
      return verdict('BLOCK', 'STOP', req, 'MOTOR_FAILURE', `Motor failure (L:${state.motors.left} R:${state.motors.right})`, 0, 0);
    }
    if (state.battery.state === 'CRITICAL' || state.battery.state === 'DEAD') {
      return verdict('BLOCK', 'STOP', req, 'BATTERY_CRITICAL', `Battery critical (${state.battery.percentage}%)`, 0, 0);
    }

    const requestedAction: SafetyAction = req === 'MANUAL' || req === null ? 'STOP' : req;
    const manualForward = manual && (input.manual?.linear ?? 0) > 0.01;
    const movesForward = manual ? manualForward : FORWARD_ACTIONS.has(requestedAction);
    let speedScale = !manual && (input.aiStale || input.aiError === 'TIMEOUT') ? 0.5 : 1;
    let kind: SafetyVerdict['verdict'] = 'ALLOW';
    let action = requestedAction;
    let rule: SafetyRule = 'NONE';
    let reason = 'All checks passed';
    let maxForward = Infinity;

    if (!state.obstacles.valid) {
      if (!manual) return verdict('BLOCK', 'STOP', req, 'SENSOR_FAILURE', `LiDAR ${state.sensors.lidar}: obstacle data unavailable`, 0, 0);
      maxForward = 0.3;
      rule = 'SENSOR_FAILURE';
      reason = 'LiDAR unavailable: manual speed limited';
    }

    const motorHot =
      state.motors.maxTemperature > cfg.motorTemperatureLimit || state.motors.left === 'OVERHEAT' || state.motors.right === 'OVERHEAT' || state.motors.left === 'OVERCURRENT' || state.motors.right === 'OVERCURRENT';
    if (motorHot) {
      speedScale = Math.min(speedScale, 0.3);
      rule = 'MOTOR_OVERHEAT';
      reason = `Motor protection (max ${state.motors.maxTemperature}°C)`;
      if (!manual && (action === 'FORWARD' || action === 'REACH_TARGET' || action === 'RETURN_HOME')) {
        kind = 'OVERRIDE';
        action = 'SLOW_DOWN';
      }
    }

    const front = state.obstacles.front;
    const v = Math.max(0, state.robot.speed);
    const decel = Math.max(0.1, this.robot().maxAcceleration);
    const stopping = (v * v) / (2 * decel);

    if (front < cfg.emergencyStopDistance) {
      if (movesForward) {
        if (manual) return verdict('OVERRIDE', 'STOP', req, 'OBSTACLE_TOO_CLOSE', `Obstacle ${front.toFixed(2)} m ahead: forward motion blocked`, speedScale, 0);
        return verdict('OVERRIDE', 'EMERGENCY_STOP', req, 'OBSTACLE_TOO_CLOSE', `Obstacle ${front.toFixed(2)} m < ${cfg.emergencyStopDistance} m: EMERGENCY_STOP`, 0, 0);
      }
      // Turning/reversing away is allowed, but without forward motion.
      maxForward = 0;
      rule = 'OBSTACLE_TOO_CLOSE';
      reason = `Obstacle ${front.toFixed(2)} m ahead: forward speed zeroed`;
    } else if (movesForward && front - stopping < cfg.emergencyStopDistance) {
      return verdict('OVERRIDE', manual ? 'STOP' : 'EMERGENCY_STOP', req, 'COLLISION_IMMINENT', `Collision imminent: stopping distance ${stopping.toFixed(2)} m, clearance ${front.toFixed(2)} m`, 0, 0);
    } else if (movesForward && v > 0.05 && front / v < cfg.timeToCollision) {
      maxForward = Math.min(maxForward, front / cfg.timeToCollision);
      rule = 'COLLISION_IMMINENT';
      reason = `Time to collision ${(front / v).toFixed(2)} s: speed limited`;
      if (!manual && action === 'FORWARD') {
        kind = 'OVERRIDE';
        action = 'SLOW_DOWN';
      }
    } else if (movesForward && Math.min(state.obstacles.frontLeft, state.obstacles.frontRight) < cfg.emergencyStopDistance * 0.5) {
      // Obstacle grazing a front corner: creep only.
      const corner = Math.min(state.obstacles.frontLeft, state.obstacles.frontRight);
      maxForward = Math.min(maxForward, 0.15);
      rule = 'OBSTACLE_TOO_CLOSE';
      reason = `Front corner clearance ${corner.toFixed(2)} m: creeping`;
    } else if (front < cfg.slowDownDistance) {
      maxForward = Math.min(maxForward, cfg.maxSpeed * cfg.slowDownFactor);
      if (rule === 'NONE') {
        rule = 'SPEED_LIMIT';
        reason = `Slow zone: obstacle ${front.toFixed(2)} m ahead`;
      }
    }

    return verdict(kind, action, req, rule, reason, speedScale, maxForward);
  }

  /** Final clamp applied to every command before it reaches /cmd_vel. */
  limit(cmd: VelocityCommand, v: SafetyDecision): VelocityCommand & { limited: boolean } {
    const cfg = this.safety();
    if (v.action === 'EMERGENCY_STOP' || (v.action === 'STOP' && v.requested !== 'MANUAL') || v.speedScale === 0) {
      return { linear: 0, angular: 0, limited: cmd.linear !== 0 || cmd.angular !== 0 };
    }
    if (v.requested === 'MANUAL' && v.action === 'STOP' && v.rule === 'OBSTACLE_TOO_CLOSE') {
      // Manual: keep steering/reversing possible, block forward.
      const linear = Math.min(0, cmd.linear);
      return { linear, angular: clampAbs(cmd.angular, cfg.maxAngularVelocity), limited: linear !== cmd.linear };
    }
    let linear = cmd.linear * v.speedScale;
    const forwardCap = Math.min(cfg.maxSpeed, v.maxForward);
    linear = Math.max(-cfg.maxSpeed, Math.min(forwardCap, linear));
    const angular = clampAbs(cmd.angular, cfg.maxAngularVelocity);
    return { linear, angular, limited: Math.abs(linear - cmd.linear) > 1e-6 || Math.abs(angular - cmd.angular) > 1e-6 };
  }
}

function clampAbs(v: number, max: number): number {
  return Math.max(-max, Math.min(max, v));
}
