import type { RobotConfig } from '@rover/protocol';

/** Differential-drive forward kinematics: wheel linear speeds → body twist. */
export function diffDriveForward(vLeft: number, vRight: number, wheelBase: number): { linear: number; angular: number } {
  return { linear: (vLeft + vRight) / 2, angular: (vRight - vLeft) / wheelBase };
}

/** Differential-drive inverse kinematics: body twist → wheel linear speeds. */
export function diffDriveInverse(linear: number, angular: number, wheelBase: number): { left: number; right: number } {
  return { left: linear - (angular * wheelBase) / 2, right: linear + (angular * wheelBase) / 2 };
}

/** Distance from the body centre to the edge of the rectangular footprint along a direction (body frame). */
export function bodyExtent(angle: number, length: number, width: number): number {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const ex = c > 1e-9 ? length / 2 / c : Infinity;
  const ey = s > 1e-9 ? width / 2 / s : Infinity;
  return Math.min(ex, ey);
}

/** Radius of the circle used for collision checks. */
export function collisionRadius(cfg: Pick<RobotConfig, 'length' | 'width'>): number {
  // Slightly smaller than the circumscribed circle: a compromise between
  // missing corner contacts and blocking narrow passages.
  return Math.hypot(cfg.length, cfg.width) / 2 * 0.85;
}

/**
 * Diff-drive controller: converts a /cmd_vel request into wheel speed set-points,
 * respecting the physical limits of the robot. Deterministic, no AI involved.
 */
export function cmdVelToWheelTargets(
  linear: number,
  angular: number,
  cfg: RobotConfig,
): { left: number; right: number; linear: number; angular: number } {
  const v = Math.max(-cfg.maxSpeed, Math.min(cfg.maxSpeed, linear));
  const w = Math.max(-cfg.maxAngularVelocity, Math.min(cfg.maxAngularVelocity, angular));
  let { left, right } = diffDriveInverse(v, w, cfg.wheelBase);
  const peak = Math.max(Math.abs(left), Math.abs(right));
  if (peak > cfg.maxSpeed) {
    const k = cfg.maxSpeed / peak;
    left *= k;
    right *= k;
  }
  return { left, right, linear: v, angular: w };
}
