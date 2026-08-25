import { assertNever } from "@pendulum/shared";
import { type CommandOf, noop, type Outcome, ok, reject, type Sim } from "../simulation";

export function execResume(sim: Sim, cmd: CommandOf<"resume">): Outcome {
  switch (sim.status) {
    case "running":
      return noop(sim, cmd);
    case "paused":
      return ok({ ...sim, status: "running" }, cmd);
    case "stopped":
      return reject(sim, cmd, "can't resume stoped sim, hit start instead");
    default:
      assertNever(sim.status);
  }
}
