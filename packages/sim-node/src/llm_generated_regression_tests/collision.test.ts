import type { Angle, BobRadius, NodeId, PendulumLocation, Point } from "@pendulum/shared/src/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectCollision } from "../pendulum";
import { type Command, createSim, type Effect, type Sim, transition } from "../simulation";

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

// fold a command list through `transition`, collecting every effect emitted along the way
const run = (start: Sim, commands: Command[]): { sim: Sim; effects: Effect[] } => {
  let sim = start;
  const effects: Effect[] = [];
  for (const command of commands) {
    const outcome = transition(sim, command);
    sim = outcome.sim;
    if (outcome.result === "ok") effects.push(...outcome.effects);
  }
  return { sim, effects };
};

const isCollision = (e: Effect): e is Extract<Effect, { type: "reportCollision" }> => e.type === "reportCollision";

describe("collision via transition", () => {
  // Launch straight down (angle 0) with wind 0 so the bob hangs at rest: after a tick
  // its position is exactly { x: anchorX, y: -length } — a deterministic anchor for
  // neighbors. We set angle 0 explicitly rather than relying on the default config,
  // whose launch angle is non-zero.
  const sim = createSim(nodeId(0));
  const straightDown: Command = { type: "configure", config: { angle: 0 as Angle } };
  const meAtRest: Point = { x: sim.config.anchorX, y: -sim.config.length };
  // the shell stamps each tick with a wall-clock time; a collision detected on a
  // tick is stamped with it, so we can assert the exact timestamp below.
  const NOW = 1000;
  const tickWith = (worldState: PendulumLocation[]): Command => ({ type: "tick", dt: 0.016, now: NOW, worldState });

  it("emits reportCollision and enters 'collided' when a neighbor's bob overlaps", () => {
    const other = neighborAt(meAtRest, 0, 0, 1 as BobRadius); // sitting right on top of us
    const { sim: after, effects } = run(sim, [straightDown, { type: "start" }, tickWith([other])]);

    // the reported collision is a full Collision record, stamped with this tick's time
    const collision = effects.find(isCollision);
    expect(collision?.data).toEqual({ reportingNode: 0, with: 1, timestamp: NOW });

    expect(effects.some((e) => e.type === "reportLocation")).toBe(true);
    expect(after.status).toBe("collided");
    // and it's recorded on the sim, ready to be merged with neighbours' reports
    expect(after.collision).toEqual({ reportingNode: 0, with: 1, timestamp: NOW });
  });

  it("emits only reportLocation and stays running when the neighbor is out of reach", () => {
    const other = neighborAt(meAtRest, 0, 100, 1 as BobRadius); // 100m away — nowhere near overlapping
    const { sim: after, effects } = run(sim, [straightDown, { type: "start" }, tickWith([other])]);

    expect(effects.some(isCollision)).toBe(false);
    expect(effects.some((e) => e.type === "reportLocation")).toBe(true);
    expect(after.status).toBe("running");
    expect(after.collision).toBeNull();
  });
});
