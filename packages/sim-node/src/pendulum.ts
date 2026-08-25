import type { PendulumConfig, PendulumLocation, Point } from "@pendulum/shared/src/types";
import z from "zod";

export const PendulumStateSchema = z.object({
  // radians from vertical, 0 = hanging straight down
  angle: z.number(),
  // in radians/sec
  angularVelocity: z.number(),
});

export type PendulumState = z.infer<typeof PendulumStateSchema>;

// returns the first neighbor whose bob overlaps ours, returns undefined when nothing is close enough.
export function detectCollision(
  selfNodeId: number,
  me: { posistion: Point; bobRadius: number },
  neighbors: PendulumLocation[],
): PendulumLocation | undefined {
  return neighbors.find(
    (p) =>
      p.nodeId !== selfNodeId &&
      Math.hypot(p.posistion.x - me.posistion.x, p.posistion.y - me.posistion.y) < me.bobRadius + p.bobRadius,
  );
}

export function step(state: PendulumState, config: PendulumConfig, dt: number): PendulumState {
  const { length: L, mass: m, gravity: g, wind } = config;

  // two torques, as angular accelerations, summed
  const gravityAccel = -(g / L) * Math.sin(state.angle);
  const windAccel = (wind * Math.cos(state.angle)) / (m * L);

  const angularAcceleration = gravityAccel + windAccel;

  // semi-implicit (symplectic) Euler: velocity first, then position uses the NEW velocity
  const angularVelocity = state.angularVelocity + angularAcceleration * dt;
  const angle = state.angle + angularVelocity * dt;

  return { angle, angularVelocity };
}
