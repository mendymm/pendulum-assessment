/**
 * Shared scaffolding for the sim transition tests.
 *
 * Holds the reusable pieces that any per-command test file can lean on:
 *   - `COMMAND_STATES` — the single source of truth for each command's accepted /
 *     noop / rejected prior statuses, type-checked to be an exact partition of `SimStatus`.
 *   - `commandArb` — a fast-check arbitrary for any command type, with a fuzzed payload.
 *   - `simInState` — build a real `Sim` in a target status by replaying commands (no faking).
 *   - counter + core-state helpers used to assert the transition invariants.
 */

import {
  type Command,
  type CommandCounts,
  type NodeId,
  PendulumConfigPatchSchema,
  type SimStatus,
  SimStatusSchema,
} from "@pendulum/shared/src/types";
import { fuzz } from "@traversable/zod-test";
import fc from "fast-check";
import { expect } from "vitest";
import { createSim, type Sim, transition } from "../simulation";

export const NODE_ID = 0 as NodeId;

// every status the sim can be in, straight from the schema so this list can never
// drift from the source of truth in @pendulum/shared.
export const ALL_STATUSES = SimStatusSchema.options;

// ---------------------------------------------------------------------------
// The single place: each command's accepted / noop / rejected prior statuses.
// ---------------------------------------------------------------------------

type StatusList = readonly SimStatus[];

export interface CommandStates {
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

export const COMMAND_STATES = {
  configure: defineCommandStates({
    accepted: ["paused", "running", "stopped", "restarting"],
    noop: [],
    rejected: [],
  }),

  start: defineCommandStates({
    accepted: ["stopped"],
    noop: [],
    rejected: ["paused", "running", "restarting"],
  }),

  stop: defineCommandStates({
    accepted: ["paused", "running", "restarting"],
    noop: [],
    rejected: ["stopped"],
  }),

  tick: defineCommandStates({
    accepted: ["running"],
    noop: [],
    rejected: ["paused", "stopped", "restarting"],
  }),

  pause: defineCommandStates({
    accepted: ["running"],
    noop: [],
    rejected: ["paused", "stopped", "restarting"],
  }),

  resume: defineCommandStates({
    accepted: ["paused"],
    noop: ["running"],
    rejected: ["stopped", "restarting"],
  }),

  // gateway opened a restart episode: accepted from every status (even a paused/stopped node
  // joins the barrier so it can complete, then relaunches with everyone else).
  haltForRestart: defineCommandStates({
    accepted: ["running", "paused", "stopped", "restarting"],
    noop: [],
    rejected: [],
  }),

  // barrier done: only meaningful while restarting (arms the relaunch timer); a stale one from
  // any other status is a no-op.
  restart: defineCommandStates({
    accepted: ["restarting"],
    noop: ["running", "paused", "stopped"],
    rejected: [],
  }),

  // scheduled relaunch instant: only meaningful while restarting (→ running); otherwise a no-op.
  relaunch: defineCommandStates({
    accepted: ["restarting"],
    noop: ["running", "paused", "stopped"],
    rejected: [],
  }),
} satisfies Record<Command["type"], CommandStates>;

// fast-check arbitraries for the payload each command type carries. the invariants
// under test must hold for *any* payload, so we generate them rather than hard-code one.
// derived straight from the zod schema so the generator can never drift from the patch's
// real shape or domain (angle ∈ [-π,π], mass/length/gravity bounds, every field optional).
const configPatchArb = fuzz(PendulumConfigPatchSchema);

// an arbitrary command of the given type, with a generated payload where one is needed.
export const commandArb = (type: Command["type"]): fc.Arbitrary<Command> => {
  switch (type) {
    case "configure":
      return configPatchArb.map((config) => ({ type, config }));
    case "tick":
      return fc
        .record({ dt: fc.double({ min: 0, max: 1, noNaN: true }), now: fc.nat() })
        .map(({ dt, now }) => ({ type, dt, now, worldState: [] }));
    // the restart-protocol commands carry an episode (and `restart` an absolute instant). the
    // outcome must be status-only, so we fuzz these payloads to prove it never depends on them.
    case "haltForRestart":
      return fc.nat().map((episode) => ({ type, episode }));
    case "relaunch":
      return fc.nat().map((episode) => ({ type, episode }));
    case "restart":
      return fc.record({ episode: fc.nat(), at: fc.nat() }).map(({ episode, at }) => ({ type, episode, at }));
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
  { from: "running", command: { type: "haltForRestart", episode: 0 }, to: "restarting" },
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
export const simInState = (target: SimStatus): Sim => {
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

// a running sim whose bob has swung off its launch angle and carries non-zero velocity —
// the realistic starting point for asserting how pause/stop/resume/tick treat live motion.
export const movingSim = (): Sim => {
  const running = transition(createSim(NODE_ID), { type: "start" }).sim;
  return transition(running, { type: "tick", dt: 0.5, worldState: [], now: 0 }).sim;
};

// ---------------------------------------------------------------------------
// Counter + core-state helpers.
// ---------------------------------------------------------------------------

// the three tally maps live under `sim.commandStats`, one bucket per outcome.
type CounterField = "completed" | "rejected" | "noop";

export const COUNTER_FIELD = {
  ok: "completed",
  rejected: "rejected",
  noop: "noop",
} as const satisfies Record<"ok" | "rejected" | "noop", CounterField>;

const ALL_COUNTER_FIELDS: readonly CounterField[] = ["completed", "rejected", "noop"];

const counterMap = (sim: Sim, field: CounterField): CommandCounts | undefined => sim.commandStats[field];

// everything about a sim EXCEPT the three counter maps — the part an outcome may or may
// not change depending on its category.
export const coreState = (sim: Sim): Record<string, unknown> => {
  const clone = { ...(sim as unknown as Record<string, unknown>) };
  delete clone.commandStats;
  return clone;
};

// invariant 1: exactly the `bumped` map's tally for `type` goes up by one; every other
// tally in that map, and both other maps entirely, are untouched.
export const expectCountersBumped = (before: Sim, after: Sim, type: Command["type"], bumped: CounterField): void => {
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

// the outcome category the spec assigns to a (command, status) pair.
export const expectedResultOf = (states: CommandStates, status: SimStatus): "ok" | "noop" | "rejected" =>
  states.accepted.includes(status) ? "ok" : states.noop.includes(status) ? "noop" : "rejected";
