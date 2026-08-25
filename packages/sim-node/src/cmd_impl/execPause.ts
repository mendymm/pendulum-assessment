import { type CommandOf, type Outcome, ok, reject, type Sim } from "../simulation";

export function execPause(sim: Sim, cmd: CommandOf<"pause">): Outcome {
  return sim.status === "running" ? ok({ ...sim, status: "paused" }, cmd) : reject(sim, cmd, "not running");
}
