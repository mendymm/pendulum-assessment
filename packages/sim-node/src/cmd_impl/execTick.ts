import { assertNever } from "@pendulum/shared";
import { bobRadius, type Collision } from "@pendulum/shared/src/types";
import { detectCollision, step } from "../pendulum";
import { type CommandOf, type Effect, type Outcome, ok, posistion, reject, type Sim } from "../simulation";

export function execTick(sim: Sim, cmd: CommandOf<"tick">): Outcome {
  switch (sim.status) {
    case "running": {
      const stepped = { ...sim, pendulumState: step(sim.pendulumState, sim.config, cmd.dt) };
      const reportLocation: Effect = {
        type: "reportLocation",
        data: {
          nodeId: sim.nodeId,
          bobRadius: bobRadius(sim.config.mass),
          anchorX: sim.config.anchorX,
          posistion: posistion(stepped),
        },
      };

      // Did this step put our bob into another node's? If so, halt locally *now* (ahead of
      // the gateway's broadcast) and report the hit — the gateway opens the restart episode
      // and drives the all-to-all barrier from there. We still emit our final position so the
      // world/UI see where we stopped.
      const me = { posistion: posistion(stepped), bobRadius: bobRadius(sim.config.mass) };
      const hit = detectCollision(sim.nodeId, me, cmd.worldState);
      if (hit === undefined) return ok(stepped, cmd, [reportLocation]);

      const collision: Collision = { reportingNode: sim.nodeId, with: hit.nodeId, timestamp: cmd.now };
      return ok({ ...stepped, status: "restarting" }, cmd, [
        reportLocation,
        { type: "collisionDetected", data: collision },
      ]);
    }
    case "paused":
      return reject(sim, cmd, "not running");
    case "stopped":
      return reject(sim, cmd, "not running");
    case "restarting":
      // halted mid-restart: not ticking until the gateway's `restart` relaunches us.
      return reject(sim, cmd, "not running");
    default:
      assertNever(sim.status);
  }
}
