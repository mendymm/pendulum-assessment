import { bobRadius } from "@pendulum/shared/src/types";
import { step } from "../pendulum";
import { type CommandOf, type Effect, type Outcome, ok, posistion, reject, type Sim } from "../simulation";

export function execTick(sim: Sim, cmd: CommandOf<"tick">): Outcome {
  if (sim.status !== "running") return reject(sim, cmd, "not running");
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
  return ok(stepped, cmd, [reportLocation]);
}
