import { type CommandOf, type Outcome, ok, type Sim } from "../simulation";

export function execConfigure(sim: Sim, cmd: CommandOf<"configure">): Outcome {
  const config = { ...sim.config, ...cmd.config };
  // changing the launch angle drops the bob from rest, so kill any velocity
  const angleChanged = cmd.config.angle !== undefined && cmd.config.angle !== sim.config.angle;
  const pendulumState = angleChanged
    ? { angularVelocity: 0, angle: cmd.config.angle ?? sim.pendulumState.angle }
    : sim.pendulumState;
  return ok({ ...sim, config, pendulumState }, cmd);
}
