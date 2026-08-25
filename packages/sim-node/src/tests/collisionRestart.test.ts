/**
 * The collision-restart barrier, node side. The transition *matrix* (which statuses accept
 * halt/restart/relaunch) is covered generically in ./simulation.transitions.test.ts — this file
 * pins the *effects* and state changes that make the handshake work:
 *
 *   - a tick that collides halts the node (→ restarting) and emits `collisionDetected`, while
 *     still reporting its final resting position;
 *   - `haltForRestart` acks the episode it was told to join;
 *   - `restart` arms the relaunch for the shared absolute instant (a `scheduleRelaunch` effect);
 *   - `relaunch` swings again from config.angle (a clean restart, not from where it froze);
 *   - `stop` is an escape hatch out of `restarting`, after which a scheduled `relaunch` no-ops.
 */

import type { BobRadius, NodeId, PendulumLocation } from "@pendulum/shared/src/types";
import { describe, expect, it } from "vitest";
import { createSim, type Outcome, posistion, transition } from "../simulation";
import { movingSim, NODE_ID, simInState } from "./testSupport";

// a neighbor big enough to swallow our bob wherever it is this step, forcing a collision.
const overlapping = (at: { x: number; y: number }): PendulumLocation => ({
  nodeId: 1 as NodeId,
  bobRadius: 100 as BobRadius,
  anchorX: 0,
  posistion: at,
});

// only the "ok" outcome carries effects; narrow to it (and fail loudly otherwise).
const effectsOf = (out: Outcome) => {
  if (out.result !== "ok") throw new Error(`expected ok, got ${out.result}`);
  return out.effects;
};

describe("collision detection during tick", () => {
  it("halts and reports the hit, still emitting its final position", () => {
    const sim = movingSim(); // running, bob already off its launch angle
    const neighbor = overlapping(posistion(sim));

    const out = transition(sim, { type: "tick", dt: 0.001, worldState: [neighbor], now: 4242 });

    expect(out.sim.status).toBe("restarting");
    const effects = effectsOf(out);
    expect(effects).toContainEqual({
      type: "collisionDetected",
      data: { reportingNode: sim.nodeId, with: neighbor.nodeId, timestamp: 4242 },
    });
    expect(effects.some((e) => e.type === "reportLocation")).toBe(true);
  });

  it("does not collide with itself even when its own location is echoed back", () => {
    const sim = movingSim();
    // world snapshots include our own entry; detection must skip it.
    const self: PendulumLocation = { ...overlapping(posistion(sim)), nodeId: sim.nodeId };

    const out = transition(sim, { type: "tick", dt: 0.001, worldState: [self], now: 1 });

    expect(out.sim.status).toBe("running");
    expect(effectsOf(out).every((e) => e.type !== "collisionDetected")).toBe(true);
  });
});

describe("haltForRestart", () => {
  it("halts and acks the episode it was told to join", () => {
    const running = transition(createSim(NODE_ID), { type: "start" }).sim;

    const out = transition(running, { type: "haltForRestart", episode: 7 });

    expect(out.sim.status).toBe("restarting");
    expect(effectsOf(out)).toEqual([{ type: "collisionAck", data: { nodeId: NODE_ID, episode: 7 } }]);
  });
});

describe("restart", () => {
  it("arms the relaunch for the absolute instant without leaving restarting yet", () => {
    const restarting = simInState("restarting");

    const out = transition(restarting, { type: "restart", episode: 3, at: 9_999 });

    expect(out.sim.status).toBe("restarting");
    expect(effectsOf(out)).toEqual([{ type: "scheduleRelaunch", at: 9_999, episode: 3 }]);
  });
});

describe("relaunch", () => {
  it("swings again from config.angle, not from where the bob froze", () => {
    const running = transition(createSim(NODE_ID), { type: "start" }).sim;
    const moved = transition(running, { type: "tick", dt: 0.5, worldState: [], now: 0 }).sim;
    const halted = transition(moved, { type: "haltForRestart", episode: 1 }).sim;
    // sanity: it really did drift off its launch angle before halting
    expect(halted.pendulumState.angle).not.toBe(halted.config.angle);

    const out = transition(halted, { type: "relaunch", episode: 1 });

    expect(out.result).toBe("ok");
    expect(out.sim.status).toBe("running");
    expect(out.sim.pendulumState).toEqual({ angle: halted.config.angle, angularVelocity: 0 });
  });
});

describe("stop aborts a pending restart", () => {
  it("leaves restarting for stopped, and a later scheduled relaunch no-ops", () => {
    const restarting = simInState("restarting");

    const stopped = transition(restarting, { type: "stop" });
    expect(stopped.result).toBe("ok");
    expect(stopped.sim.status).toBe("stopped");

    // the timer armed by `restart` eventually fires — it must not resurrect a stopped node.
    const late = transition(stopped.sim, { type: "relaunch", episode: 1 });
    expect(late.result).toBe("noop");
    expect(late.sim.status).toBe("stopped");
  });
});
