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
  throw Error("todo");
  // return {};
}
