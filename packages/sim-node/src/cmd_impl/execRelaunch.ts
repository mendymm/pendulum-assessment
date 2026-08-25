import { assertNever } from "@pendulum/shared";
import { type CommandOf, noop, type Outcome, ok, type Sim } from "../simulation";

// The scheduled relaunch instant arrived: leave `restarting` and swing again from config.angle
// (same launch as a fresh `start`). Status-only guard — if we've since been stopped, or this is
// a stale timer from a closed episode, we're no longer `restarting`, so it's a no-op. That guard
// is why the node needs no episode fence: the gateway serializes episodes, so a leftover timer
// can only ever fire while we're still in the very episode it was scheduled for.
export function execRelaunch(sim: Sim, cmd: CommandOf<"relaunch">): Outcome {
  switch (sim.status) {
    case "restarting":
      return ok({ ...sim, status: "running", pendulumState: { angle: sim.config.angle, angularVelocity: 0 } }, cmd);
    case "running":
    case "paused":
    case "stopped":
      return noop(sim, cmd);
    default:
      return assertNever(sim.status);
  }
}
