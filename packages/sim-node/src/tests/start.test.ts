/**
 * `start` accepted-path behavior. The reject matrix (start is only valid from
 * "stopped"), counter bumping, and "rejected leaves core state intact" are all
 * covered generically in ./simulation.transitions.test.ts — this file only pins
 * down what an *accepted* start actually does:
 *
 *   status → running, and the bob is (re)launched from `config.angle` at rest,
 *   regardless of where it was left. No effects are emitted.
 */

import { describe, expect, it } from "vitest";
import { createSim, transition } from "../simulation";
import { NODE_ID, simInState } from "./testSupport";

describe("start command", () => {
  it("launches a stopped sim into running, with no effects", () => {
    const out = transition(simInState("stopped"), { type: "start" });
    expect(out.result).toBe("ok");
    expect(out.sim.status).toBe("running");
    if (out.result === "ok") expect(out.effects).toEqual([]);
  });

  it("launches the bob from config.angle at rest", () => {
    const before = simInState("stopped");
    const { sim } = transition(before, { type: "start" });
    expect(sim.pendulumState).toEqual({ angle: before.config.angle, angularVelocity: 0 });
  });

  it("re-launches from config.angle, ignoring where the bob was left", () => {
    // drive the sim so the live angle drifts away from config.angle, then stop it.
    const running = transition(createSim(NODE_ID), { type: "start" }).sim;
    const ticked = transition(running, { type: "tick", dt: 0.5, worldState: [], now: 0 }).sim;
    const stopped = transition(ticked, { type: "stop" }).sim;
    // precondition: the bob really did drift off config.angle before we stopped.
    expect(stopped.pendulumState.angle).not.toBe(stopped.config.angle);

    const { sim } = transition(stopped, { type: "start" });
    expect(sim.pendulumState).toEqual({ angle: stopped.config.angle, angularVelocity: 0 });
  });
});
