import { assertNever } from "@pendulum/shared";
import { type CommandOf, type Outcome, ok, reject, type Sim } from "../simulation";

export function execStart(sim: Sim, cmd: CommandOf<"start">): Outcome {
  switch (sim.status) {
    case "running":
      return reject(sim, cmd, "sim is already started");
    case "paused":
      return reject(sim, cmd, "can't start a paused sim, hit resume instead");
    case "stopped":
      return ok(
        {
          ...sim,
          pendulumState: { angle: sim.config.angle, angularVelocity: 0 },
          status: "running",
        },
        cmd,
      );
    default:
      assertNever(sim.status);
  }
}
