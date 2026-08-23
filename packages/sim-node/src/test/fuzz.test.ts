/**
 * Fuzz / stateful property test for the sim's transition function.
 *
 * Instead of testing one command at a time, we generate an arbitrary *sequence* of
 * commands, fold `transition` over it from a fresh sim, and assert the machine's
 * invariants after every single step. Any command order that breaks an invariant
 * gets shrunk down to the minimal failing sequence.
 */

import { type BobRadius, type NodeId, type PendulumLocation, SimStatusSchema } from "@pendulum/shared/src/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Command, createSim, transition } from "../simulation";
import { configPatch } from "./testSupport";

const nodeId = (n: number) => n as NodeId;

// a neighbor in our snapshot of the world, used by `tick`'s collision check
const pendulumLocation: fc.Arbitrary<PendulumLocation> = fc.record({
  nodeId: fc.integer({ min: 0, max: 100 }).map(nodeId),
  bobRadius: fc.double({ min: 0.1, max: 5, noNaN: true }) as fc.Arbitrary<BobRadius>,
  anchorX: fc.double({ min: -50, max: 50, noNaN: true }),
  posistion: fc.record({
    x: fc.double({ min: -100, max: 100, noNaN: true }),
    y: fc.double({ min: -100, max: 100, noNaN: true }),
  }),
});

// realistic per-frame time steps — kept small so the Euler integrator stays finite
const dt = fc.double({ min: 0, max: 0.1, noNaN: true });
const worldState = fc.array(pendulumLocation, { maxLength: 5 });

// an arbitrary command spanning every variant of the union
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.constant<Command>({ type: "start" }),
  fc.constant<Command>({ type: "pause" }),
  fc.constant<Command>({ type: "resume" }),
  fc.constant<Command>({ type: "stop" }),
  fc.constant<Command>({ type: "collision" }),
  configPatch.map((config) => ({ type: "configure", config }) as Command),
  fc.tuple(dt, worldState).map(([dt, worldState]) => ({ type: "tick", dt, worldState }) as Command),
);

const commandSequence = fc.array(command, { maxLength: 200 });

describe("transition fuzzing", () => {
  it("never throws, whatever the command sequence", () => {
    fc.assert(
      fc.property(commandSequence, (commands) => {
        let sim = createSim(nodeId(0));
        for (const cmd of commands) {
          // totality: transition is a pure total function, it always returns an Outcome
          sim = transition(sim, cmd).sim;
        }
      }),
    );
  });

  it("keeps status within the valid set after every command", () => {
    fc.assert(
      fc.property(commandSequence, (commands) => {
        let sim = createSim(nodeId(0));
        for (const cmd of commands) {
          sim = transition(sim, cmd).sim;
          expect(SimStatusSchema.options).toContain(sim.status);
        }
      }),
    );
  });

  it("conserves counters: completed + rejected equals commands seen", () => {
    fc.assert(
      fc.property(commandSequence, (commands) => {
        let sim = createSim(nodeId(0));
        let seen = 0;
        for (const cmd of commands) {
          const outcome = transition(sim, cmd);
          seen++;

          // exactly one of the two counters advanced by exactly one this step
          expect(outcome.sim.commandsCompleted + outcome.sim.commandsRejected).toBe(seen);
          // and the result tag agrees with which counter moved
          if (outcome.result === "ok") {
            expect(outcome.sim.commandsCompleted).toBe(sim.commandsCompleted + 1);
            expect(outcome.sim.commandsRejected).toBe(sim.commandsRejected);
          } else {
            expect(outcome.sim.commandsRejected).toBe(sim.commandsRejected + 1);
            expect(outcome.sim.commandsCompleted).toBe(sim.commandsCompleted);
          }

          sim = outcome.sim;
        }
      }),
    );
  });

  it("never lets NaN leak into the pendulum state", () => {
    fc.assert(
      fc.property(commandSequence, (commands) => {
        let sim = createSim(nodeId(0));
        for (const cmd of commands) {
          sim = transition(sim, cmd).sim;
          expect(Number.isNaN(sim.pendulumState.angle)).toBe(false);
          expect(Number.isNaN(sim.pendulumState.angularVelocity)).toBe(false);
        }
      }),
    );
  });

  it("never mutates the sim it was given", () => {
    fc.assert(
      fc.property(commandSequence, (commands) => {
        let sim = createSim(nodeId(0));
        for (const cmd of commands) {
          const before = structuredClone(sim);
          transition(sim, cmd);
          // the input sim is untouched — transition returns a fresh Sim in its Outcome
          expect(sim).toEqual(before);
          sim = transition(sim, cmd).sim;
        }
      }),
    );
  });
});
