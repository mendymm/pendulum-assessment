/**
 * Restart / generation fencing.
 *
 * A collision starts an "episode": the node freezes (status `collided`), records
 * the earliest collision it hears about, and schedules a restart for
 * `timestamp + 5s`. Two things have to hold no matter how the timers land:
 *
 *   1. Within one episode, convergence to an earlier timestamp reschedules the
 *      restart earlier but stays the SAME episode (same generation).
 *   2. A restart is honoured at most once per episode, and a leftover timer from
 *      a PREVIOUS episode must never restart a newer one.
 *
 * We fence this with a `generation` counter on the sim, bumped once per episode
 * (each `null -> collided` transition). The `restart` command carries the
 * generation it was scheduled for, and is valid only when:
 *
 *      status === "collided"   &&   command.generation === sim.generation
 *
 * status guards against a duplicate restart within the same episode; generation
 * guards against a stale restart bleeding into the next one. Both are needed.
 *
 * All of this lives in the pure `transition`, so these are plain fold tests.
 * They are RED until simulation.ts grows `generation`, the `restart` command,
 * and the `scheduleRestart` effect — that's the point of writing them first.
 */

import type { BobRadius, Collision, NodeId, PendulumLocation } from "@pendulum/shared/src/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Command, createSim, type Effect, type Outcome, type Sim, transition } from "../simulation";

// ---- the contract, cast into existence so this file compiles while red -------

const RESTART_MS = 5000; // the spec's 5-second wait

// `generation` is not on Sim yet; read it through here until it is.
const gen = (s: Sim): number => (s as Sim & { generation: number }).generation;

// `restart` is not in the Command union yet; the `scheduleRestart` effect is not
// in the Effect union yet. Cast through unknown so the (type-stripped) tests run.
const restart = (generation: number): Command => ({ type: "restart", generation }) as unknown as Command;

type ScheduleRestart = { type: "scheduleRestart"; at: number; generation: number };
const scheduleRestarts = (effects: Effect[]): ScheduleRestart[] =>
  (effects as unknown as { type: string }[]).filter(
    (e) => e.type === "scheduleRestart",
  ) as unknown as ScheduleRestart[];

// ---- helpers ----------------------------------------------------------------

const nodeId = (n: number) => n as NodeId;

// a collision report; reportingNode/with default to a fixed pair so timestamp is
// the only thing that varies unless a test says otherwise.
const at = (timestamp: number, reportingNode = 0, withNode = 1): Collision => ({
  reportingNode: nodeId(reportingNode),
  with: nodeId(withNode),
  timestamp,
});

const collide = (c: Collision): Command => ({ type: "collision", collision: c });

// a fresh single-node sim in a chosen status (generation starts at 0, collision null)
const fresh = (status: Sim["status"] = "running"): Sim => ({ ...createSim(nodeId(0)), status });

// fold a command list through `transition`, keeping every outcome + every effect
const run = (start: Sim, commands: Command[]) => {
  let sim = start;
  const effects: Effect[] = [];
  const outcomes: Outcome[] = [];
  for (const command of commands) {
    const out = transition(sim, command);
    outcomes.push(out);
    sim = out.sim;
    if (out.result === "ok") effects.push(...out.effects);
  }
  return { sim, effects, outcomes };
};

// ---- entering an episode ----------------------------------------------------

describe("a collision starts an episode", () => {
  it("records it, enters 'collided', bumps the generation, and schedules a restart 5s out", () => {
    const { sim, effects } = run(fresh("running"), [collide(at(1000))]);

    expect(sim.status).toBe("collided");
    expect(sim.collision).toEqual(at(1000));
    expect(gen(sim)).toBe(1); // 0 -> 1

    const scheds = scheduleRestarts(effects);
    expect(scheds).toHaveLength(1);
    expect(scheds[0]).toMatchObject({ at: 1000 + RESTART_MS, generation: 1 });
  });

  it("is accepted from any status, each starting a fresh episode (generation 1)", () => {
    for (const status of ["running", "paused", "stopped"] as const) {
      const { sim } = run(fresh(status), [collide(at(500))]);
      expect(sim.status).toBe("collided");
      expect(sim.collision).toEqual(at(500));
      expect(gen(sim)).toBe(1);
    }
  });

  it("detecting a collision on a tick starts an episode the same way", () => {
    const base = fresh("running");
    // default config hangs at rest at (anchorX, -length); drop a neighbour right on top of us
    const meAtRest = { x: base.config.anchorX, y: -base.config.length };
    const overlapping: PendulumLocation = {
      nodeId: nodeId(1),
      bobRadius: 1 as BobRadius,
      anchorX: 0,
      posistion: meAtRest,
    };

    const { sim, effects } = run(base, [{ type: "tick", dt: 0.016, now: 4242, worldState: [overlapping] }]);

    expect(sim.status).toBe("collided");
    expect(sim.collision).toEqual({ reportingNode: 0, with: 1, timestamp: 4242 });
    expect(gen(sim)).toBe(1);

    const scheds = scheduleRestarts(effects);
    expect(scheds).toHaveLength(1);
    expect(scheds[0]).toMatchObject({ at: 4242 + RESTART_MS, generation: 1 });
  });
});

// ---- convergence within one episode -----------------------------------------

describe("converging within an episode keeps the same generation", () => {
  it("a LATER report is ignored: no state change, no new restart scheduled", () => {
    const { sim, effects } = run(fresh("running"), [collide(at(1000)), collide(at(2000))]);

    expect(sim.collision).toEqual(at(1000)); // earliest still wins
    expect(gen(sim)).toBe(1); // still episode 1, not a new one

    const scheds = scheduleRestarts(effects);
    expect(scheds).toHaveLength(1); // only the first collision scheduled anything
    expect(scheds[0]).toMatchObject({ at: 1000 + RESTART_MS, generation: 1 });
  });

  it("an EARLIER report reschedules sooner, but under the same generation", () => {
    const { sim, effects } = run(fresh("running"), [collide(at(2000)), collide(at(1000))]);

    expect(sim.collision).toEqual(at(1000));
    expect(gen(sim)).toBe(1);

    const scheds = scheduleRestarts(effects);
    expect(scheds).toHaveLength(2);
    expect(scheds[0]).toMatchObject({ at: 2000 + RESTART_MS, generation: 1 });
    expect(scheds[1]).toMatchObject({ at: 1000 + RESTART_MS, generation: 1 }); // earlier deadline, SAME gen
  });
});

// ---- restart validity -------------------------------------------------------

describe("restart is fenced by status AND generation", () => {
  it("matching generation from 'collided' resets to a fresh running sim", () => {
    const { sim, outcomes } = run(fresh("running"), [collide(at(1000)), restart(1)]);

    expect(outcomes[1].result).toBe("ok");
    expect(sim.status).toBe("running");
    expect(sim.collision).toBeNull();
    expect(sim.pendulumState).toEqual({ angle: sim.config.angle, angularVelocity: 0 });
  });

  it("a STALE generation is rejected and leaves the collided state untouched", () => {
    const collided = run(fresh("running"), [collide(at(1000))]).sim; // collided, gen 1
    const out = transition(collided, restart(0)); // stale

    expect(out.result).toBe("rejected");
    expect(out.sim.status).toBe("collided");
    expect(out.sim.collision).toEqual(at(1000));
    expect(gen(out.sim)).toBe(1);
  });

  it("a second restart in the same episode is rejected (already running)", () => {
    const { outcomes, sim } = run(fresh("running"), [collide(at(1000)), restart(1), restart(1)]);

    expect(outcomes[1].result).toBe("ok"); // first restart takes effect
    expect(outcomes[2].result).toBe("rejected"); // second finds us already running
    expect(sim.status).toBe("running");
  });

  it("restart is rejected whenever we are not collided", () => {
    for (const status of ["running", "paused", "stopped"] as const) {
      // generation 0 matches a fresh sim, so this isolates the status guard
      expect(transition(fresh(status), restart(0)).result).toBe("rejected");
    }
  });
});

// ---- the headline regression ------------------------------------------------

describe("a subsequent collision inside the old window survives", () => {
  it("a leftover restart from the previous episode does NOT restart the new one", () => {
    const { outcomes, sim } = run(fresh("running"), [
      collide(at(1000)), //   episode 1  -> collided, gen 1
      restart(1), //          -> running (episode 1 done)
      collide(at(1200)), //   episode 2 (fresh collision) -> collided, gen 2
      restart(1), //          leftover timer from episode 1 -> MUST be fenced out
      restart(2), //          episode 2's own timer -> restarts
    ]);

    const [ep1, r1, ep2, staleRestart, r2] = outcomes;
    expect(ep1.result).toBe("ok");
    expect(r1.result).toBe("ok");
    expect(ep2.result).toBe("ok");
    expect(staleRestart.result).toBe("rejected"); // fenced by generation (1 !== 2)
    expect(r2.result).toBe("ok");

    // episode 2 was untouched by the stale restart: still collided, still gen 2
    expect(gen(ep2.sim)).toBe(2);
    expect(staleRestart.sim.status).toBe("collided");
    expect(staleRestart.sim.collision).toEqual(at(1200));

    // and episode 2 finally restarts cleanly on its own generation
    expect(sim.status).toBe("running");
    expect(sim.collision).toBeNull();
  });
});

// ---- generation bookkeeping -------------------------------------------------

describe("generation counts episodes, not reports", () => {
  it("increments once per episode and never during convergence", () => {
    const { sim } = run(fresh("running"), [
      collide(at(3000)), // episode 1
      collide(at(2000)), // converge (earlier) — same episode
      collide(at(2500)), // ignored (later)   — same episode
      restart(1),
      collide(at(9000)), // episode 2
    ]);
    expect(gen(sim)).toBe(2);
  });
});

// ---- invariants over arbitrary interleavings --------------------------------

describe("invariants under random command sequences", () => {
  const anyCommand: fc.Arbitrary<Command> = fc.oneof(
    fc.integer({ min: 0, max: 10_000 }).map((t) => collide(at(t))),
    fc.integer({ min: 0, max: 4 }).map((g) => restart(g)),
  );

  it("generation never decreases, and every accepted restart yields a fresh running sim", () => {
    fc.assert(
      fc.property(fc.array(anyCommand, { maxLength: 40 }), (commands) => {
        let sim = fresh("running");
        let prevGen = gen(sim);

        for (const command of commands) {
          const out = transition(sim, command);
          sim = out.sim;

          expect(gen(sim)).toBeGreaterThanOrEqual(prevGen); // monotonic
          prevGen = gen(sim);

          if ((command as { type: string }).type === "restart" && out.result === "ok") {
            expect(sim.status).toBe("running");
            expect(sim.collision).toBeNull();
          }
        }
      }),
    );
  });
});
