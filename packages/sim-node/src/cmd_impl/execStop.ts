import { type CommandOf, type Outcome, ok, reject, type Sim } from "../simulation";

export function execStop(sim: Sim, cmd: CommandOf<"stop">): Outcome {
  // freeze in place: keep the current angle, just kill the velocity.
  // (start relaunches from config.angle.)
  return sim.status === "stopped"
    ? reject(sim, cmd, "already stopped")
    : ok(
        {
          ...sim,
          status: "stopped",
          pendulumState: { ...sim.pendulumState, angularVelocity: 0 },
        },
        cmd,
      );
}
