import { type CommandOf, type Outcome, ok, type Sim } from "../simulation";

// The gateway opened a restart episode (`collisionInducedRestart`): halt and join the barrier.
// Accepted from every status on purpose — a paused/stopped-but-connected node still acks so the
// barrier can complete, and then relaunches with everyone else (the spec's "each pendulum
// restarts"). We keep our current, now-frozen angle; the eventual `relaunch` resets to
// config.angle. We echo `cmd.episode` in the ack so the gateway can match it to the live barrier.
export function execHaltForRestart(sim: Sim, cmd: CommandOf<"haltForRestart">): Outcome {
  return ok({ ...sim, status: "restarting" }, cmd, [
    { type: "collisionAck", data: { nodeId: sim.nodeId, episode: cmd.episode } },
  ]);
}
