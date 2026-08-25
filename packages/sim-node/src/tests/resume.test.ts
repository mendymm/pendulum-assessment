/**
 * `resume` accepted-path behavior. The outcome matrix (resume is a no-op from
 * "running", rejected from "stopped"), counter bumping, and "noop/rejected leave
 * core state intact" are all covered generically in ./simulation.transitions.test.ts
 * — this file only pins down what an *accepted* resume (from "paused") does:
 *
 *   status → running, bob untouched, no effects — and, end to end, momentum
 *   survives a run → pause → resume round trip (the whole point vs stop/start).
 */

import { describe, expect, it } from "vitest";
import { transition } from "../simulation";
import { movingSim } from "./testSupport";

describe("resume command", () => {
  it("resumes a paused sim back to running without touching the bob, no effects", () => {
    const paused = transition(movingSim(), { type: "pause" }).sim;
    const out = transition(paused, { type: "resume" });
    expect(out.result).toBe("ok");
    expect(out.sim.status).toBe("running");
    expect(out.sim.pendulumState).toEqual(paused.pendulumState);
    if (out.result === "ok") expect(out.effects).toEqual([]);
  });

  it("preserves momentum across a run → pause → resume round trip", () => {
    const running = movingSim();
    const paused = transition(running, { type: "pause" }).sim;
    const resumed = transition(paused, { type: "resume" }).sim;
    // pause/resume vs stop/start: the bob picks up exactly where it left off.
    expect(resumed.status).toBe("running");
    expect(resumed.pendulumState).toEqual(running.pendulumState);
  });
});
