/**
 * Property tests for the `stop` / `start` pair of the sim's transition function.
 *
 * The recipe, per the spec of these tests:
 *   1. fast-check hands us a *valid* starting Sim and a *valid* sequence of commands.
 *   2. We fold `transition` over that sequence, one command at a time.
 *   3. We call `stop`.
 *   4. We apply the rest of the commands and assert.
 *
 * The tests deliberately know about nothing but: the Sim state, the Command union,
 * the Outcome, and the single `transition` function (plus `posistion`, which is just
 * a pure read of "where is the bob on the grid" — the very thing under test).
 */

import type { Angle, Length, Mass, NodeId, PendulumConfig, Point } from "@pendulum/shared/src/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Command, type Outcome, posistion, type Sim, transition } from "../simulation";
import { angle, configPatch, status, velocity } from "./testSupport";

const nodeId = (n: number) => n as NodeId;

// ---- arbitraries -----------------------------------------------------------

// a full config with every field populated, so length/anchorX/angle (the three
// inputs to `posistion`) all get real variety rather than sitting at defaults.
const fullConfig: fc.Arbitrary<PendulumConfig> = fc.record({
  angle,
  mass: fc.double({ min: 0.1, max: 100, noNaN: true }) as fc.Arbitrary<Mass>,
  length: fc.double({ min: 0.1, max: 7, noNaN: true }) as fc.Arbitrary<Length>,
  gravity: fc.double({ min: 0, max: 20, noNaN: true }) as fc.Arbitrary<PendulumConfig["gravity"]>,
  anchorX: fc.double({ min: -50, max: 50, noNaN: true }),
  wind: fc.double({ min: -10, max: 10, noNaN: true }),
});

// an arbitrary — but internally consistent — starting Sim. Any status, any config,
// any pendulum state.
const arbSim: fc.Arbitrary<Sim> = fc
  .record({
    config: fullConfig,
    a: angle,
    v: velocity,
    status,
  })
  .map(({ config, a, v, status }) => ({
    nodeId: nodeId(0),
    config,
    status,
    pendulumState: { angle: a, angularVelocity: v },
    commandsCompleted: {
      start: 0,
      pause: 0,
      resume: 0,
      stop: 0,
      configure: 0,
      tick: 0,
    },
    commandsRejected: {
      start: 0,
      pause: 0,
      resume: 0,
      stop: 0,
      configure: 0,
      tick: 0,
    },
  }));

// realistic per-frame values for `tick`
const dt = fc.double({ min: 0, max: 0.1, noNaN: true });
const now = fc.integer({ min: 0, max: 1_000_000 });

// an arbitrary command. We leave out `tick`'s world neighbours (empty world) so this
// suite stays about the start/stop lifecycle rather than collision geometry — ticks
// still advance the pendulum, they just never manufacture a collision here.
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.constant<Command>({ type: "start" }),
  fc.constant<Command>({ type: "pause" }),
  fc.constant<Command>({ type: "resume" }),
  fc.constant<Command>({ type: "stop" }),
  configPatch.map((config) => ({ type: "configure", config }) as Command),
  fc.tuple(dt, now).map(([dt, now]) => ({ type: "tick", dt, worldState: [], now }) as Command),
);

const commandSequence = fc.array(command, { maxLength: 100 });

// ---- helpers ---------------------------------------------------------------

// fold `transition` over a list of commands, one at a time, from a given sim.
const applyAll = (sim: Sim, commands: Command[]): Sim => commands.reduce((s, c) => transition(s, c).sim, sim);

// the bob's "starting location": where `posistion` puts it when the pendulum sits at
// its launch angle (config.angle) with no velocity — i.e. exactly the state `start`
// installs. Derived purely from the sim's own state.
const startingLocation = (sim: Sim): Point =>
  posistion({ ...sim, pendulumState: { angle: sim.config.angle, angularVelocity: 0 } });

// ---- tests -----------------------------------------------------------------

describe("stop / start lifecycle", () => {
  it("after stop, a start resets the bob to its starting location on the grid", () => {
    fc.assert(
      fc.property(arbSim, commandSequence, (initial, commands) => {
        // 1. drive the sim through an arbitrary history...
        const evolved = applyAll(initial, commands);

        // 2. ...call stop...
        const stopped = transition(evolved, { type: "stop" }).sim;

        // 3. ...then start.
        const started = transition(stopped, { type: "start" }).sim;

        // the location on the grid is now exactly the launch location for the
        // current config, no matter where the pendulum had swung to beforehand.
        expect(posistion(started)).toEqual(startingLocation(started));
      }),
    );
  });
});
