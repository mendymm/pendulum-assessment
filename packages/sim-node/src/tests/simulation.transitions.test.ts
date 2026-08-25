/**
 * Property tests for the *validity* and *effect* of state transitions.
 *
 * Every (command, prior-status) pair falls into exactly one of three outcome categories:
 *   - accepted ("ok")   — the command applies and the sim's core state changes.
 *   - noop    ("noop")  — the command is a no-op: nothing changes but its counter.
 *   - rejected("rejected") — the command is invalid here: nothing changes but its counter.
 *
 * `COMMAND_STATES` (see ./testSupport) is the single source of truth: per command, which
 * statuses land in each category. The type system guarantees those three lists are an exact
 * partition of every possible `SimStatus` (they cover it, with no overlap). fast-check then
 * samples statuses and checks the sim agrees — both on the result and on these invariants:
 *
 *   1. the counter map matching the outcome (completed / rejected / noop) is bumped by
 *      one for this command type, and the other two counter maps are untouched;
 *   2. noop     — aside from the noop counter, the sim's core state is identical;
 *   3. rejected — aside from the rejected counter, the sim's core state is identical.
 *
 * To reach a target status we never fabricate a `Sim` — we drive the *real* `createSim`
 * + `transition` from the initial "stopped" state along a declared graph of edges, found
 * by BFS (`simInState` in ./testSupport).
 */

import type { Command } from "@pendulum/shared/src/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { transition } from "../simulation";
import {
  ALL_STATUSES,
  COMMAND_STATES,
  COUNTER_FIELD,
  type CommandStates,
  commandArb,
  coreState,
  expectCountersBumped,
  expectedResultOf,
  simInState,
} from "./testSupport";

fc.configureGlobal({ ...fc.readConfigureGlobal(), ...{ numRuns: 100 } });

const entries = Object.entries(COMMAND_STATES) as [Command["type"], CommandStates][];

// one `it` per (command, status): applying the command from that status yields the
// outcome the spec declares — regardless of the (fuzzed) payload.
describe("outcome matches the spec", () => {
  for (const [commandType, states] of entries) {
    for (const status of ALL_STATUSES) {
      const expected = expectedResultOf(states, status);
      it(`${commandType} from ${status} → ${expected}`, () => {
        fc.assert(
          fc.property(commandArb(commandType), (command) => {
            expect(transition(simInState(status), command).result).toBe(expected);
          }),
        );
      });
    }
  }
});

// keyed off the *actual* outcome: whatever the result was, the counter map matching it
// is bumped by one for this command type, and the other two counter maps are untouched.
describe("counters", () => {
  for (const [type] of entries) {
    it(`${type}: bumps only its outcome's counter`, () => {
      fc.assert(
        fc.property(fc.constantFrom(...ALL_STATUSES), commandArb(type), (status, command) => {
          const before = simInState(status);
          const outcome = transition(before, command);
          expectCountersBumped(before, outcome.sim, type, COUNTER_FIELD[outcome.result]);
        }),
      );
    });
  }
});

// keyed off the *spec*: from every status the spec calls noop or rejected, the command
// must leave the sim's core state (everything but the counters) exactly as it was.
describe("noop/rejected leave core state intact", () => {
  for (const [type, states] of entries) {
    for (const status of [...states.noop, ...states.rejected]) {
      it(`${type} from ${status}: core state unchanged`, () => {
        fc.assert(
          fc.property(commandArb(type), (command) => {
            const before = simInState(status);
            const after = transition(before, command).sim;
            expect(coreState(after)).toEqual(coreState(before));
          }),
        );
      });
    }
  }
});
