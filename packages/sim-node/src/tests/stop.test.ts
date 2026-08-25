/**
 * `stop` accepted-path behavior. The reject matrix (stop is rejected from
 * "stopped"), counter bumping, and "rejected leaves core state intact" are all
 * covered generically in ./simulation.transitions.test.ts — this file only pins
 * down what an *accepted* stop actually does:
 *
 *   status → stopped, and the bob is *frozen in place*: the live angle is kept,
 *   only the velocity is zeroed. Same from running and from paused. No effects.
 *
 * This is the mirror of `start`, which instead resets the angle to config.angle.
 */

import { describe, expect, it } from "vitest";
import { transition } from "../simulation";
import { movingSim } from "./testSupport";

describe("stop command", () => {
  it("freezes a running sim in place: keeps the live angle, zeroes velocity, no effects", () => {
    const moving = movingSim();
    expect(moving.pendulumState.angularVelocity).not.toBe(0); // precondition: it's actually swinging

    const out = transition(moving, { type: "stop" });
    expect(out.result).toBe("ok");
    expect(out.sim.status).toBe("stopped");
    expect(out.sim.pendulumState).toEqual({ angle: moving.pendulumState.angle, angularVelocity: 0 });
    if (out.result === "ok") expect(out.effects).toEqual([]);
  });

  it("freezes a paused sim the same way", () => {
    const paused = transition(movingSim(), { type: "pause" }).sim;

    const { sim } = transition(paused, { type: "stop" });
    expect(sim.status).toBe("stopped");
    expect(sim.pendulumState).toEqual({ angle: paused.pendulumState.angle, angularVelocity: 0 });
  });

  it("keeps the live angle rather than resetting to config.angle (contrast with start)", () => {
    const moving = movingSim();
    expect(moving.pendulumState.angle).not.toBe(moving.config.angle); // drifted off the launch angle

    const { sim } = transition(moving, { type: "stop" });
    expect(sim.pendulumState.angle).toBe(moving.pendulumState.angle);
    expect(sim.pendulumState.angle).not.toBe(sim.config.angle);
  });
});
