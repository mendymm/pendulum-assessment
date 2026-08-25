import { assertNever } from "@pendulum/shared";
import { type CommandOf, type Outcome, ok, reject, type Sim } from "../simulation";

export function execStop(sim: Sim, cmd: CommandOf<"stop">): Outcome {
  // freeze in place: keep the current angle, just kill the velocity.
  // (start relaunches from config.angle.)
  const frozen = (): Outcome =>
    ok(
      {
        ...sim,
        status: "stopped",
        pendulumState: { ...sim.pendulumState, angularVelocity: 0 },
      },
      cmd,
    );

  switch (sim.status) {
    case "running":
      return frozen();
    case "paused":
      return frozen();
    case "stopped":
      return reject(sim, cmd, "already stopped");
    default:
      assertNever(sim.status);
  }
}
