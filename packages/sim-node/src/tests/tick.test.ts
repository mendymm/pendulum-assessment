/**
 * `tick` accepted-path behavior. The reject matrix (tick is only valid from
 * "running"), counter bumping, and "rejected leaves core state intact" are all
 * covered generically in ./simulation.transitions.test.ts — this file pins down
 * what an *accepted* tick does, and it's the only command that emits an effect:
 *
 *   - advances `pendulumState` by exactly one `step(state, config, dt)`, status
 *     stays running;
 *   - emits exactly one `reportLocation` effect carrying this node's identity and
 *     the bob's position *after* the step;
 *   - it's a pure function of (sim, dt).
 *
 * Assertions are tied back to the pure `step` / `posistion` / `bobRadius` helpers
 * the impl uses, so this locks the contract rather than re-deriving the physics.
 */

import { bobRadius, type Command } from "@pendulum/shared/src/types";
import { describe, expect, it } from "vitest";
import { step } from "../pendulum";
import { posistion, transition } from "../simulation";
import { movingSim } from "./testSupport";

const tickCmd = (dt: number): Command => ({ type: "tick", dt, worldState: [], now: 0 });

describe("tick command", () => {
  it("advances the bob by one physics step and stays running", () => {
    const before = movingSim();
    const dt = 0.25;
    const out = transition(before, tickCmd(dt));

    expect(out.result).toBe("ok");
    expect(out.sim.status).toBe("running");
    expect(out.sim.pendulumState).toEqual(step(before.pendulumState, before.config, dt));
  });

  it("emits exactly one reportLocation effect for the bob's post-step position", () => {
    const before = movingSim();
    const out = transition(before, tickCmd(0.25));
    if (out.result !== "ok") throw new Error("expected ok");

    expect(out.effects).toEqual([
      {
        type: "reportLocation",
        data: {
          nodeId: before.nodeId,
          bobRadius: bobRadius(before.config.mass),
          anchorX: before.config.anchorX,
          posistion: posistion(out.sim), // position of the *stepped* sim, not the pre-tick one
        },
      },
    ]);
  });

  it("does not move the bob when dt is 0, but still reports", () => {
    const before = movingSim();
    const out = transition(before, tickCmd(0));
    if (out.result !== "ok") throw new Error("expected ok");

    expect(out.sim.pendulumState).toEqual(before.pendulumState); // no time elapsed → no movement
    expect(out.effects).toHaveLength(1);
    expect(out.effects[0].data.posistion).toEqual(posistion(before));
  });

  it("is a pure function of (sim, dt)", () => {
    const before = movingSim();
    expect(transition(before, tickCmd(0.25))).toEqual(transition(before, tickCmd(0.25)));
  });
});
