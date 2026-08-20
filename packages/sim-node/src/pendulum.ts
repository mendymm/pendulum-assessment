import type { Environment, PendulumConfig } from "@pendulum/shared";

export type PendulumState = {
  // radians from vertical, 0 = hanging straight down
  angle: number;
  // in radians/sec
  angularVelocity: number;
};

export function initilizePendulumState(config: PendulumConfig): PendulumState {
  return {
    angle: config.angle,
    angularVelocity: 0,
  };
}

export function step(
  state: PendulumState,
  config: PendulumConfig,
  environment: Environment,
  dt: number,
): PendulumState {
  const { length: L, mass: m } = config;
  const { gravity: g, wind, damping } = environment;

  // three torques, as angular accelerations, summed
  const gravityAccel = -(g / L) * Math.sin(state.angle);
  const windAccel = (wind * Math.cos(state.angle)) / (m * L);
  const dampingAccel = -damping * state.angularVelocity;

  const angularAcceleration = gravityAccel + windAccel + dampingAccel;

  // semi-implicit (symplectic) Euler: velocity first, then position uses the NEW velocity
  const angularVelocity = state.angularVelocity + angularAcceleration * dt;
  const angle = state.angle + angularVelocity * dt;

  return { angle, angularVelocity };
}
