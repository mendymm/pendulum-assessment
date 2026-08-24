/**
 * Property tests for the *validity* of state transitions: for a given command, which
 * prior statuses accept it and which reject it.
 *
 * `COMMAND_STATES` is the single source of truth: per command, the statuses it is valid
 * from and the statuses it is expected to be rejected from. The type system guarantees
 * those two lists are an exact partition of every possible `SimStatus`. fast-check then
 * samples statuses and checks the sim agrees.
 *
 * To reach a target status we never fabricate a `Sim` — we drive the *real* `createSim`
 * + `transition` from the initial "stopped" state along a declared graph of edges
 * (`EDGES`), found by BFS.
 */

import { type NodeId, type SimStatus, SimStatusSchema } from "@pendulum/shared/src/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Command, createSim, type Sim, transition } from "../simulation";

const NODE_ID = 0 as NodeId;

// every status the sim can be in, straight from the schema so this list can never
// drift from the source of truth in @pendulum/shared.
const ALL_STATUSES = SimStatusSchema.options;

// ---------------------------------------------------------------------------
// The single place: each command's valid + rejected prior statuses.
// ---------------------------------------------------------------------------

type StatusList = readonly SimStatus[];

interface CommandStates {
  readonly valid: StatusList;
  readonly rejected: StatusList;
}

// true iff A and B are exactly the same type (the tsd / type-fest identity trick).
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// `valid` and `rejected` must be an exact partition of `SimStatus`:
//   - their union must cover every status (nothing forgotten), and
//   - their intersection must be empty (no status listed as both).
// If either fails, the spec's type resolves to an { ERROR } shape that won't match the
// object literal, so `defineCommandStates` fails to compile at the offending entry.
type ValidatePartition<S extends CommandStates> =
  Equals<S["valid"][number] | S["rejected"][number], SimStatus> extends true
    ? Equals<S["valid"][number] & S["rejected"][number], never> extends true
      ? S
      : { ERROR: "valid and rejected must not overlap" }
    : { ERROR: "valid and rejected together must cover every SimStatus" };

const defineCommandStates = <const S extends CommandStates>(spec: S & ValidatePartition<S>): S => spec;

const COMMAND_STATES = {
  pause: defineCommandStates({
    valid: ["running"],
    rejected: ["paused", "stopped"],
  }),
  resume: defineCommandStates({
    valid: ["paused"],
    rejected: ["running", "stopped"],
  }),
} satisfies Partial<Record<Command["type"], CommandStates>>;

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
// The property.
// ---------------------------------------------------------------------------

describe("command state-transition validity", () => {
  const entries = Object.entries(COMMAND_STATES) as [string, CommandStates][];
  for (const [type, states] of entries) {
    const command = { type } as Command;
    const { valid } = states;

    it(`${type}: accepted only from [${valid.join(", ")}]`, () => {
      fc.assert(
        fc.property(fc.constantFrom(...ALL_STATUSES), (status) => {
          const outcome = transition(simInState(status), command);
          const expected = valid.includes(status) ? "ok" : "rejected";
          expect(outcome.result).toBe(expected);
        }),
      );
    });
  }
});
