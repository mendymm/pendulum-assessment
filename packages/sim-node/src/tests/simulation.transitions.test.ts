/**
 * Property tests for the *validity* and *effect* of state transitions.
 *
 * Every (command, prior-status) pair falls into exactly one of three outcome categories:
 *   - accepted ("ok")   — the command applies and the sim's core state changes.
 *   - noop    ("noop")  — the command is a no-op: nothing changes but its counter.
 *   - rejected("rejected") — the command is invalid here: nothing changes but its counter.
 *
 * `COMMAND_STATES` is the single source of truth: per command, which statuses land in
 * each category. The type system guarantees those three lists are an exact partition of
 * every possible `SimStatus` (they cover it, with no overlap). fast-check then samples
 * statuses and checks the sim agrees — both on the result and on these invariants:
 *
 *   1. the counter map matching the outcome (completed / rejected / noop) is bumped by
 *      one for this command type, and the other two counter maps are untouched;
 *   2. noop     — aside from the noop counter, the sim's core state is identical;
 *   3. rejected — aside from the rejected counter, the sim's core state is identical.
 *
 * To reach a target status we never fabricate a `Sim` — we drive the *real* `createSim`
 * + `transition` from the initial "stopped" state along a declared graph of edges
 * (`EDGES`), found by BFS.
 */

import { type NodeId, PendulumConfigPatchSchema, type SimStatus, SimStatusSchema } from "@pendulum/shared/src/types";
import { fuzz } from "@traversable/zod-test";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Command, type CommandCounts, createSim, type Sim, transition } from "../simulation";

fc.configureGlobal({ ...fc.readConfigureGlobal(), ...{ numRuns: 100 } });

const NODE_ID = 0 as NodeId;

// every status the sim can be in, straight from the schema so this list can never
// drift from the source of truth in @pendulum/shared.
const ALL_STATUSES = SimStatusSchema.options;

// ---------------------------------------------------------------------------
// The single place: each command's accepted / noop / rejected prior statuses.
// ---------------------------------------------------------------------------

type StatusList = readonly SimStatus[];

interface CommandStates {
  readonly accepted: StatusList;
  readonly noop: StatusList;
  readonly rejected: StatusList;
}

// true iff A and B are exactly the same type (the tsd / type-fest identity trick).
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// `accepted`, `noop` and `rejected` must be an exact partition of `SimStatus`:
//   - their union must cover every status (nothing forgotten), and
//   - they must be pairwise disjoint (no status listed in two categories).
// If either fails, the spec's type resolves to an { ERROR } shape that won't match the
// object literal, so `defineCommandStates` fails to compile at the offending entry.
type ValidatePartition<S extends CommandStates> =
  Equals<S["accepted"][number] | S["noop"][number] | S["rejected"][number], SimStatus> extends true
    ? [S["accepted"][number] & S["noop"][number]] extends [never]
      ? [S["accepted"][number] & S["rejected"][number]] extends [never]
        ? [S["noop"][number] & S["rejected"][number]] extends [never]
          ? S
          : { ERROR: "noop and rejected must not overlap" }
        : { ERROR: "accepted and rejected must not overlap" }
      : { ERROR: "accepted and noop must not overlap" }
    : { ERROR: "accepted, noop and rejected together must cover every SimStatus" };

const defineCommandStates = <const S extends CommandStates>(spec: S & ValidatePartition<S>): S => spec;

const COMMAND_STATES = {
  configure: defineCommandStates({
    accepted: ["paused", "running", "stopped"],
    noop: [],
    rejected: [],
  }),

  start: defineCommandStates({
    accepted: ["stopped"],
    noop: [],
    rejected: ["paused", "running"],
  }),

  stop: defineCommandStates({
    accepted: ["paused", "running"],
    noop: [],
    rejected: ["stopped"],
  }),

  tick: defineCommandStates({
    accepted: ["running"],
    noop: [],
    rejected: ["paused", "stopped"],
  }),

  pause: defineCommandStates({
    accepted: ["running"],
    noop: [],
    rejected: ["paused", "stopped"],
  }),

  resume: defineCommandStates({
    accepted: ["paused"],
    noop: ["running"],
    rejected: ["stopped"],
  }),
} satisfies Record<Command["type"], CommandStates>;

// fast-check arbitraries for the payload each command type carries. the invariants
// under test must hold for *any* payload, so we generate them rather than hard-code one.
// derived straight from the zod schema so the generator can never drift from the patch's
// real shape or domain (angle ∈ [-π,π], mass/length/gravity bounds, every field optional).
const configPatchArb = fuzz(PendulumConfigPatchSchema);

// an arbitrary command of the given type, with a generated payload where one is needed.
const commandArb = (type: Command["type"]): fc.Arbitrary<Command> => {
  switch (type) {
    case "configure":
      return configPatchArb.map((config) => ({ type, config }));
    case "tick":
      return fc
        .record({ dt: fc.double({ min: 0, max: 1, noNaN: true }), now: fc.nat() })
        .map(({ dt, now }) => ({ type, dt, now, worldState: [] }));
    default:
      return fc.constant({ type } as Command);
  }
};

// ---------------------------------------------------------------------------
// Reaching a status without faking the sim: a declared transition graph + BFS.
// ---------------------------------------------------------------------------

// each edge is a real command that moves the sim from `from` to `to`. keep this the
// minimal set needed to reach every status; BFS stitches them into a path.
interface Edge {
  readonly from: SimStatus;
  readonly command: Command;
  readonly to: SimStatus;
}

const EDGES: readonly Edge[] = [
  { from: "stopped", command: { type: "start" }, to: "running" },
  { from: "running", command: { type: "pause" }, to: "paused" },
];

const INITIAL_STATUS = createSim(NODE_ID).status; // "stopped"

// shortest command sequence from the initial status to `target`, or null if unreachable.
const pathTo = (target: SimStatus): Command[] | null => {
  if (target === INITIAL_STATUS) return [];
  const queue: { status: SimStatus; path: Command[] }[] = [{ status: INITIAL_STATUS, path: [] }];
  const seen = new Set<SimStatus>([INITIAL_STATUS]);
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: is test
    const { status, path } = queue.shift()!;
    for (const edge of EDGES) {
      if (edge.from !== status || seen.has(edge.to)) continue;
      const next = [...path, edge.command];
      if (edge.to === target) return next;
      seen.add(edge.to);
      queue.push({ status: edge.to, path: next });
    }
  }
  return null;
};

// build a sim in `target` by replaying real commands from a fresh sim. throws if the
// status is unreachable, or if the graph is wrong (a declared edge gets rejected).
const simInState = (target: SimStatus): Sim => {
  const path = pathTo(target);
  if (path === null) throw new Error(`no command path from "${INITIAL_STATUS}" to "${target}"`);
  return path.reduce((sim, command) => {
    const outcome = transition(sim, command);
    if (outcome.result !== "ok") {
      throw new Error(`edge command "${command.type}" was rejected from "${sim.status}" — bad EDGES?`);
    }
    return outcome.sim;
  }, createSim(NODE_ID));
};

// ---------------------------------------------------------------------------
// Counter + core-state helpers.
// ---------------------------------------------------------------------------

// the three tally maps on a `Sim`, one per outcome. `commandsNoop` does not exist on
// `Sim` yet — that's the point of writing this test first.
type CounterField = "commandsCompleted" | "commandsRejected" | "commandsNoop";

const COUNTER_FIELD = {
  ok: "commandsCompleted",
  rejected: "commandsRejected",
  noop: "commandsNoop",
} as const satisfies Record<"ok" | "rejected" | "noop", CounterField>;

const ALL_COUNTER_FIELDS: readonly CounterField[] = ["commandsCompleted", "commandsRejected", "commandsNoop"];

const counterMap = (sim: Sim, field: CounterField): CommandCounts | undefined =>
  (sim as unknown as Record<CounterField, CommandCounts | undefined>)[field];

// everything about a sim EXCEPT the three counter maps — the part an outcome may or may
// not change depending on its category.
const coreState = (sim: Sim): Record<string, unknown> => {
  const clone = { ...(sim as unknown as Record<string, unknown>) };
  for (const field of ALL_COUNTER_FIELDS) delete clone[field];
  return clone;
};

// invariant 1: exactly the `bumped` map's tally for `type` goes up by one; every other
// tally in that map, and both other maps entirely, are untouched.
const expectCountersBumped = (before: Sim, after: Sim, type: Command["type"], bumped: CounterField): void => {
  for (const field of ALL_COUNTER_FIELDS) {
    const b = counterMap(before, field);
    const a = counterMap(after, field);
    if (field === bumped) {
      expect(a?.[type]).toBe((b?.[type] ?? 0) + 1);
      for (const other of Object.keys(a ?? {}) as Command["type"][]) {
        if (other !== type) expect(a?.[other]).toBe(b?.[other]);
      }
    } else {
      expect(a).toEqual(b);
    }
  }
};

// ---------------------------------------------------------------------------
// The properties.
// ---------------------------------------------------------------------------

const entries = Object.entries(COMMAND_STATES) as [Command["type"], CommandStates][];

// the outcome category the spec assigns to a (command, status) pair.
const expectedResultOf = (states: CommandStates, status: SimStatus): "ok" | "noop" | "rejected" =>
  states.accepted.includes(status) ? "ok" : states.noop.includes(status) ? "noop" : "rejected";

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
