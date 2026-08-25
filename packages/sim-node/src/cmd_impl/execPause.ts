import { assertNever } from "@pendulum/shared";
import { type CommandOf, type Outcome, ok, reject, type Sim } from "../simulation";

export function execPause(sim: Sim, cmd: CommandOf<"pause">): Outcome {
  switch (sim.status) {
    case "running":
      return ok({ ...sim, status: "paused" }, cmd);
    case "paused":
      return reject(sim, cmd, "not running");
    case "stopped":
      return reject(sim, cmd, "not running");
    default:
      assertNever(sim.status);
  }
}
