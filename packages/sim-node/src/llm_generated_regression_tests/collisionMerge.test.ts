// written by claude, based on my long convo with it, verified to be correct

/**
 * Collision convergence.
 *
 * When a collision happens, every node has to agree on ONE restart moment.
 * There is no consensus round. Instead each node remembers the *earliest*
 * collision it has heard about, and collisions get gossiped to everyone. All the
 * agreement comes from a single merge rule applied whenever a node learns of a
 * collision (whether it detected it itself, or heard it from a neighbour):
 *
 *     keep the collision with the smaller timestamp   (ties: smaller node id)
 *
 * `null` means "no collision yet" and is the identity of that merge.
 *
 * That rule is a min-register: it is commutative, associative, and idempotent —
 * a semilattice. Those three laws are the whole reason this works: no matter
 * what ORDER the reports arrive in, or how many times they REPEAT, every node
 * that has seen the same set of reports ends up holding the exact same
 * collision. So "all nodes restart together" reduces to "all nodes agree on the
 * earliest timestamp", which these tests prove.
 *
 * We write these first, against the merge we're about to build, so the
 * convergence guarantee is nailed down before it gets wired into the state
 * machine. Until `mergeCollision` exists, this file is red — that's the point.
 */

import type { Collision, NodeId } from "@pendulum/shared/src/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mergeCollision } from "../simulation";

// ---- generators -------------------------------------------------------------

const nodeId = fc.integer({ min: 0, max: 100 }).map((n) => n as NodeId);

// a collision report: who reported it, which neighbour they hit, and the
// wall-clock ms it happened.
const collision: fc.Arbitrary<Collision> = fc.record({
  reportingNode: nodeId,
  with: nodeId,
  timestamp: fc.integer({ min: 0, max: 1_000_000 }),
});

// The winner we EXPECT out of two reports: earliest timestamp wins; exact ties
// fall back to the lower reporting node, then the lower node hit. This is a
// TOTAL order over reports — two distinct reports are never "equally good" — so
// there is always exactly one right answer for the merge to land on. Written
// once here so the properties below can lean on it.
const earliest = (a: Collision, b: Collision): Collision => {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? a : b;
  if (a.reportingNode !== b.reportingNode) return a.reportingNode < b.reportingNode ? a : b;
  return a.with <= b.with ? a : b;
};

// ---- the rule, by example (read these first) --------------------------------

describe("mergeCollision — the rule, spelled out", () => {
  const at = (timestamp: number, reportingNode = 0, withNode = 0): Collision => ({
    reportingNode: reportingNode as NodeId,
    with: withNode as NodeId,
    timestamp,
  });

  it("adopts the incoming report when it was holding none", () => {
    expect(mergeCollision(null, at(100))).toEqual(at(100));
  });

  it("keeps the earlier collision and ignores the later one — either way round", () => {
    expect(mergeCollision(at(100), at(200))).toEqual(at(100));
    expect(mergeCollision(at(200), at(100))).toEqual(at(100));
  });

  it("breaks an exact timestamp tie with the lower reporting node", () => {
    expect(mergeCollision(at(100, 5), at(100, 2))).toEqual(at(100, 2));
  });
});

// ---- the three laws that make convergence possible --------------------------

describe("mergeCollision is a semilattice (so nodes can converge)", () => {
  it("is idempotent: hearing the same report twice changes nothing", () => {
    fc.assert(
      fc.property(collision, (a) => {
        expect(mergeCollision(a, a)).toEqual(a);
      }),
    );
  });

  it("is commutative: the order two reports meet in doesn't matter", () => {
    fc.assert(
      fc.property(collision, collision, (a, b) => {
        expect(mergeCollision(a, b)).toEqual(mergeCollision(b, a));
      }),
    );
  });

  it("is associative: how reports are grouped doesn't matter", () => {
    fc.assert(
      fc.property(collision, collision, collision, (a, b, c) => {
        expect(mergeCollision(mergeCollision(a, b), c)).toEqual(mergeCollision(a, mergeCollision(b, c)));
      }),
    );
  });
});

// ---- the guarantee we actually care about -----------------------------------

describe("collisions converge", () => {
  it("folding any set of reports lands on the globally-earliest one", () => {
    fc.assert(
      fc.property(fc.array(collision, { minLength: 1 }), (reports) => {
        const held = reports.reduce<Collision | null>(mergeCollision, null);
        expect(held).toEqual(reports.reduce(earliest));
      }),
    );
  });

  it("two nodes agree even when reports arrive in different orders and repeat", () => {
    fc.assert(
      fc.property(
        fc.array(collision, { minLength: 1 }),
        // a second delivery schedule over the SAME reports: reordered, with repeats.
        // concat(reports) guarantees node B still sees every report at least once,
        // so both nodes have seen the same underlying set.
        fc.array(fc.nat(), { minLength: 1 }),
        (reports, order) => {
          const nodeA = reports.reduce<Collision | null>(mergeCollision, null);

          const deliveredToB = order.map((i) => reports[i % reports.length]).concat(reports);
          const nodeB = deliveredToB.reduce<Collision | null>(mergeCollision, null);

          expect(nodeA).toEqual(nodeB);
        },
      ),
    );
  });
});
