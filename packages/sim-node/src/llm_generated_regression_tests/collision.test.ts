import type { BobRadius, NodeId, PendulumLocation } from "@pendulum/shared/src/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectCollision } from "../pendulum";

const nodeId = (n: number) => n as NodeId;

// generators for the collision geometry
const coord = fc.double({ min: -100, max: 100, noNaN: true });
const radius = fc.double({ min: 0.1, max: 5, noNaN: true }) as fc.Arbitrary<BobRadius>;
const direction = fc.double({ min: 0, max: 2 * Math.PI, noNaN: true });

// place a neighbor `distance` away from `me` along `dir`
const neighborAt = (me: { x: number; y: number }, dir: number, distance: number, r: BobRadius): PendulumLocation => ({
  nodeId: nodeId(1),
  bobRadius: r,
  anchorX: 0,
  posistion: { x: me.x + distance * Math.cos(dir), y: me.y + distance * Math.sin(dir) },
});

describe("detectCollision", () => {
  it("collides when the centers are closer than the summed radii", () => {
    fc.assert(
      // frac < 1 puts the neighbor strictly inside the collision band
      fc.property(
        coord,
        coord,
        radius,
        radius,
        direction,
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        (x, y, r1, r2, dir, frac) => {
          const me = { posistion: { x, y }, bobRadius: r1 };
          const other = neighborAt({ x, y }, dir, (r1 + r2) * frac, r2);

          expect(detectCollision(nodeId(0), me, [other])?.nodeId).toBe(1);
        },
      ),
    );
  });

  it("does not collide when the rims are farther apart than the summed radii", () => {
    fc.assert(
      // frac > 1 puts the neighbor strictly outside the collision band
      fc.property(
        coord,
        coord,
        radius,
        radius,
        direction,
        fc.double({ min: 1.01, max: 5, noNaN: true }),
        (x, y, r1, r2, dir, frac) => {
          const me = { posistion: { x, y }, bobRadius: r1 };
          const other = neighborAt({ x, y }, dir, (r1 + r2) * frac, r2);

          expect(detectCollision(nodeId(0), me, [other])).toBeUndefined();
        },
      ),
    );
  });

  it("considers radius: a fixed gap that clears small bobs collides once they grow", () => {
    fc.assert(
      fc.property(coord, coord, direction, (x, y, dir) => {
        const me = { posistion: { x, y } };
        const gap = 4; // fixed center-to-center distance

        // small bobs: 0.5 + 0.5 = 1 < 4, so no overlap
        const small = 0.5 as BobRadius;
        expect(
          detectCollision(nodeId(0), { ...me, bobRadius: small }, [neighborAt({ x, y }, dir, gap, small)]),
        ).toBeUndefined();

        // big bobs: 2.5 + 2.5 = 5 > 4, so the same gap now overlaps
        const big = 2.5 as BobRadius;
        expect(
          detectCollision(nodeId(0), { ...me, bobRadius: big }, [neighborAt({ x, y }, dir, gap, big)])?.nodeId,
        ).toBe(1);
      }),
    );
  });

  it("never reports a collision with itself, even when perfectly overlapping", () => {
    fc.assert(
      fc.property(coord, coord, radius, (x, y, r) => {
        const me = { posistion: { x, y }, bobRadius: r };
        const self: PendulumLocation = { nodeId: nodeId(0), bobRadius: r, anchorX: 0, posistion: { x, y } };

        expect(detectCollision(nodeId(0), me, [self])).toBeUndefined();
      }),
    );
  });
});
