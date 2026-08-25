/**
 * The simulation is a state machine. An immutable `Sim` interface holds the current state of the sim
 * A sim is a result of the function F(Sim, Command) => Outcome{Sim, Effects}
 *
 * This setup allows me to very easily test the sim's logic
 */

import {
  bobRadius,
  defaultPendulumConfig,
  type NodeId,
  type PendulumConfig,
  type PendulumConfigPatch,
  type PendulumLocation,
  type Point,
  type SimSnapshot,
  type SimStatus,
} from "@pendulum/shared/src/types";
import { execConfigure } from "./cmd_impl/execConfigure";
import { execPause } from "./cmd_impl/execPause";
import { execResume } from "./cmd_impl/execResume";
import { execStart } from "./cmd_impl/execStart";
import { execStop } from "./cmd_impl/execStop";
import { execTick } from "./cmd_impl/execTick";
import type { NeighborsLocation } from "./gatewayWsConn";
import type { PendulumState } from "./pendulum";

export interface Sim {
  readonly nodeId: NodeId;
  readonly config: PendulumConfig;
  readonly status: SimStatus;
  readonly pendulumState: PendulumState;
  readonly commandsCompleted: CommandCounts;
  readonly commandsRejected: CommandCounts;
  readonly commandsNoop: CommandCounts;
}

export type Command =
  // reset's the pendulums position, and starts the sim
  | { type: "start" }

  // pause, but keep pendulum's position
  | { type: "pause" }

  // resume, but only from the paused state
  | { type: "resume" }

  // reset's the pendulums position, and stops the sim
  | { type: "stop" }

  // configure the pendulum: you can configure the pendulum at any status
  | { type: "configure"; config: PendulumConfigPatch }

  // tick the simulation by DT, only valid from the running state
  // includes the latest snapshot of our internal map of the world state.
  // passing in world state as a snapshot, ensures our state machine is not reading a global map,
  // and makes testing easier
  | { type: "tick"; dt: number; worldState: PendulumLocation[]; now: number };

export type Effect = { type: "reportLocation"; data: PendulumLocation };

export interface Rejection {
  command: Command;
  from: SimStatus;
  reason: string;
}

export type Outcome =
  | { result: "ok"; sim: Sim; effects: Effect[] }
  | { result: "rejected"; sim: Sim; rejection: Rejection }
  | { result: "noop"; sim: Sim };

// how many commands of each type we've completed/rejected. same style as the WS
// event tally: a map keyed by the union of command types, every key present at 0.
export type CommandCounts = Record<Command["type"], number>;

const zeroCounts = (): CommandCounts => ({
  start: 0,
  pause: 0,
  resume: 0,
  stop: 0,
  configure: 0,
  tick: 0,
});

// bump one command type's tally by one, returning a new map (keeps `Sim` immutable)
const bumpCount = (counts: CommandCounts, type: Command["type"]): CommandCounts => ({
  ...counts,
  [type]: counts[type] + 1,
});

// new sims always start with these defaults
export function createSim(nodeId: NodeId): Sim {
  return {
    nodeId,
    config: defaultPendulumConfig(nodeId),
    pendulumState: {
      angle: 0,
      angularVelocity: 0,
    },
    status: "stopped",
    commandsCompleted: zeroCounts(),
    commandsRejected: zeroCounts(),
    commandsNoop: zeroCounts(),
  };
}

export const ok = (nextSim: Sim, command: Command, effects: Effect[] = []): Outcome => ({
  result: "ok",
  sim: { ...nextSim, commandsCompleted: bumpCount(nextSim.commandsCompleted, command.type) },
  effects,
});

export const noop = (nextSim: Sim, command: Command): Outcome => ({
  result: "noop",
  sim: { ...nextSim, commandsNoop: bumpCount(nextSim.commandsNoop, command.type) },
});

export const reject = (nextSim: Sim, command: Command, reason: string): Outcome => ({
  result: "rejected",
  sim: { ...nextSim, commandsRejected: bumpCount(nextSim.commandsRejected, command.type) },
  rejection: { command, from: nextSim.status, reason },
});

export type CommandOf<T extends Command["type"]> = Extract<Command, { type: T }>;

// This is the simulation, expressed as a pure function
//
// Invalid transitions I.E. pausing while the sim is already paused are no-ops
export function transition(sim: Sim, command: Command): Outcome {
  switch (command.type) {
    case "start":
      return execStart(sim, command);
    case "pause":
      return execPause(sim, command);
    case "resume":
      return execResume(sim, command);
    case "stop":
      return execStop(sim, command);
    case "configure":
      return execConfigure(sim, command);
    case "tick":
      return execTick(sim, command);
  }
}

// compute the current x,y location of the bob
export function posistion(sim: Sim): Point {
  const { length: L, anchorX } = sim.config;
  const { angle } = sim.pendulumState;
  return {
    x: anchorX + L * Math.sin(angle), // bob hangs from the anchor...
    y: -L * Math.cos(angle), // ...and swings below the beam (y down)
  };
}

export function snapshot(sim: Sim): SimSnapshot {
  return {
    ...sim,
    posistion: posistion(sim),
    bobRadius: bobRadius(sim.config.mass),
  };
}

export const toBobPositions = (neighbors: NeighborsLocation): PendulumLocation[] => Array.from(neighbors.values());
