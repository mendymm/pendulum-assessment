/**
 * `pause` accepted-path behavior. The reject matrix (pause is only valid from
 * "running"), counter bumping, and "rejected leaves core state intact" are all
 * covered generically in ./simulation.transitions.test.ts — this file only pins
 * down what an *accepted* pause actually does:
 *
 *   status → paused, and the bob is left completely untouched — angle AND
 *   velocity are preserved so `resume` can pick up the swing. No effects.
 *
 * The velocity-preservation is the key contrast with `stop`, which zeroes it.
 */

import { describe, expect, it } from "vitest";
import { transition } from "../simulation";
import { movingSim } from "./testSupport";

describe("pause command", () => {
  it("pauses a running sim without touching the bob, and emits no effects", () => {
    const moving = movingSim();
    const out = transition(moving, { type: "pause" });
    expect(out.result).toBe("ok");
    expect(out.sim.status).toBe("paused");
    expect(out.sim.pendulumState).toEqual(moving.pendulumState); // angle AND velocity preserved
    if (out.result === "ok") expect(out.effects).toEqual([]);
  });

  it("keeps velocity rather than zeroing it (contrast with stop)", () => {
    const moving = movingSim();
    expect(moving.pendulumState.angularVelocity).not.toBe(0); // precondition: it's actually swinging

    const { sim } = transition(moving, { type: "pause" });
    expect(sim.pendulumState.angularVelocity).toBe(moving.pendulumState.angularVelocity);
  });
});
