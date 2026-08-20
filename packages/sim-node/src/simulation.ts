/**
 * The simulation is a state machine. An immutable `Sim` interface holds the current state of the sim
 * A sim is a result of the function F(Sim, Command) => Outcome{Sim, Effects}
 *
 * This setup allows me to very easily test the sim's logic
 */

import type { PendulumConfig, SimStatus } from "@pendulum/shared";
import { initilizePendulumState, type PendulumState } from "./pendulum";

export interface Sim {
  readonly id: number;
  readonly config: PendulumConfig;
  readonly status: SimStatus;
  readonly pendulumState: PendulumState;
}

export type Command =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "configure"; config: PendulumConfig };

// no effects for now
export type Effect = never;

export interface Outcome {
  sim: Sim;
  effects: Effect[];
}

const outcome = (s: Sim, e: Effect[] = []): Outcome => ({
  sim: s,
  effects: e,
});

// start a fresh new sim
export function createSim(id: number, config: PendulumConfig): Sim {
  return {
    id,
    config,
    pendulumState: initilizePendulumState(config),
    status: "stopped",
  };
}

// This is the simulation, expressed as a pure function
//
// Invalid transitions I.E. pausing while the sim is already paused are no-ops
export function transition(sim: Sim, command: Command): Outcome {
  switch (command.type) {
    case "start":
      return outcome({
        ...sim,
        pendulumState: initilizePendulumState(sim.config),
        status: "running",
      });
    case "pause":
      return outcome(
        sim.status === "running" ? { ...sim, status: "paused" } : sim,
      );
    case "resume":
      return outcome(
        sim.status === "paused" ? { ...sim, status: "running" } : sim,
      );
    case "configure":
      return outcome({ ...sim, config: command.config });
  }
}
