import { assertNever } from "@pendulum/shared";
import { type CommandOf, noop, type Outcome, ok, type Sim } from "../simulation";

// The gateway's barrier completed and told us the absolute instant to relaunch at (`restart`).
// Only meaningful while we're `restarting`; from any other status this is a stale/aborted
// message and a no-op. We don't relaunch here — we arm a timer (via the `scheduleRelaunch`
// effect) so every node lands on the same `at`, keeping restarts visually in lockstep.
export function execRestart(sim: Sim, cmd: CommandOf<"restart">): Outcome {
  switch (sim.status) {
    case "restarting":
      return ok(sim, cmd, [{ type: "scheduleRelaunch", at: cmd.at, episode: cmd.episode }]);
    case "running":
    case "paused":
    case "stopped":
      return noop(sim, cmd);
    default:
      return assertNever(sim.status);
  }
}
