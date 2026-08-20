/**
 * The simulation is a state machine. An immutable `Sim` interface holds the current state of the sim
 * A sim is a result of the function F(Sim, Command) => Outcome{Sim, Effects}
 *
 * This setup allows me to very easily test the sim's logic
 */

import type { Environment, PendulumConfig, SimStatus } from "@pendulum/shared";
import { initilizePendulumState, type PendulumState, step } from "./pendulum";

export interface Sim {
  readonly id: number;
  readonly config: PendulumConfig;
  readonly status: SimStatus;
  readonly pendulumState: PendulumState;
  readonly environment: Environment;
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

  // configure the running pendulum, we allow the changing a pendulums length/mass/angle(location) at runtime
  | { type: "configure"; config: PendulumConfig }

  // wind is not part of the pendulum's config,
  // and we want to allow the set to change the wind without messing with the pendulum state
  | { type: "setWind"; wind: number }

  // tick the simulation by DT, only valid from the running state
  | { type: "tick"; dt: number };

export type Effect = never;

export interface Rejection {
  command: Command;
  from: SimStatus;
  reason: string;
}

export type Outcome = { result: "ok"; sim: Sim; effects: Effect[] } | { result: "rejected"; rejection: Rejection };

// start a fresh new sim
export function createSim(id: number, config: PendulumConfig): Sim {
  return {
    id,
    config,
    pendulumState: initilizePendulumState(config),
    status: "stopped",
    environment: {
      gravity: 9.81,
      damping: 0.1,
      wind: 0,
    },
  };
}

// This is the simulation, expressed as a pure function
//
// Invalid transitions I.E. pausing while the sim is already paused are no-ops
export function transition(sim: Sim, command: Command): Outcome {
  const ok = (sim: Sim, effects: Effect[] = []): Outcome => ({
    result: "ok",
    sim,
    effects,
  });

  const reject = (sim: Sim, reason: string): Outcome => ({
    result: "rejected",
    rejection: { command, from: sim.status, reason },
  });

  switch (command.type) {
    case "start":
      return ok({
        ...sim,
        pendulumState: initilizePendulumState(sim.config),
        status: "running",
      });

    case "pause":
      return sim.status === "running" ? ok({ ...sim, status: "paused" }) : reject(sim, "not running");

    case "resume":
      return sim.status === "paused" ? ok({ ...sim, status: "running" }) : reject(sim, "not paused");

    case "stop":
      return sim.status === "stopped"
        ? ok({ ...sim, status: "stopped", pendulumState: initilizePendulumState(sim.config) })
        : reject(sim, "already stopped");

    case "setWind":
      return ok({ ...sim, environment: { ...sim.environment, wind: command.wind } });

    case "configure":
      return ok({ ...sim, config: command.config });

    case "tick":
      return sim.status === "running"
        ? ok({ ...sim, pendulumState: step(sim.pendulumState, sim.config, sim.environment, command.dt) })
        : reject(sim, "not running");
  }
}
