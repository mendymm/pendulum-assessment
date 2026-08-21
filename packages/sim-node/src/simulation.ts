/**
 * The simulation is a state machine. An immutable `Sim` interface holds the current state of the sim
 * A sim is a result of the function F(Sim, Command) => Outcome{Sim, Effects}
 *
 * This setup allows me to very easily test the sim's logic
 */

import type { Environment, PendulumConfig, SimSnapshot, SimStatus } from "@pendulum/shared";
import type { NeighborsLocation } from "./gatewayWsConn";
import { initilizePendulumState, type PendulumState, step } from "./pendulum";

const COLLISION_THRESHOLD = 0.1;

export interface Sim {
  readonly id: number;
  readonly config: PendulumConfig;
  readonly status: SimStatus;
  readonly pendulumState: PendulumState;
  readonly environment: Environment;
}

export interface BobPosition {
  nodeId: number;
  x: number;
  y: number;
}

export type Command =
  // do nothing and return the sim
  | { type: "snapshot" }

  // reset's the pendulums position, and starts the sim
  | { type: "start" }

  // pause, but keep pendulum's position
  | { type: "pause" }

  // resume, but only from the paused state
  | { type: "resume" }

  // reset's the pendulums position, and stops the sim
  | { type: "stop" }

  // same as stop, separate event for better readability
  | { type: "collision" }

  // configure the running pendulum, we allow the changing a pendulums length/mass/angle(location) at runtime
  | { type: "configure"; config: PendulumConfig }

  // wind is not part of the pendulum's config,
  // and we want to allow the set to change the wind without messing with the pendulum state
  | { type: "setWind"; wind: number }

  // tick the simulation by DT, only valid from the running state
  // includes the latest snapshot of our internal map of the world state.
  // passing in world state as a snapshot, ensures our state machine is not reading a global map,
  // and makes testing easier
  | { type: "tick"; dt: number; worldState: BobPosition[] };

export type Effect = {
  type: "reportCollision";
  // the node who detected the collision, and sent the broadcast
  reportingNode: number;
  // the node who was involved in the collision
  otherNode: number;
};

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
    case "snapshot":
      return ok(sim);
    case "start":
      console.log("starting");
      return ok({
        ...sim,
        pendulumState: initilizePendulumState(sim.config),
        status: "running",
      });

    case "pause":
      return sim.status === "running" ? ok({ ...sim, status: "paused" }) : reject(sim, "not running");

    case "resume":
      return sim.status === "paused" ? ok({ ...sim, status: "running" }) : reject(sim, "not paused");

    case "collision": // same as stop
    case "stop":
      return sim.status === "stopped"
        ? ok({ ...sim, status: "stopped", pendulumState: initilizePendulumState(sim.config) })
        : reject(sim, "already stopped");

    case "setWind":
      return ok({ ...sim, environment: { ...sim.environment, wind: command.wind } });

    case "configure":
      return ok({ ...sim, config: command.config });

    case "tick": {
      if (sim.status !== "running") return reject(sim, "not running");
      const stepped = { ...sim, pendulumState: step(sim.pendulumState, sim.config, sim.environment, command.dt) };
      const me = currentLocation(stepped);
      const hit = command.worldState.find(
        (p) => Math.abs(p.nodeId - sim.id) === 1 && Math.hypot(p.x - me.x, p.y - me.y) < COLLISION_THRESHOLD,
      );

      return hit
        ? ok({ ...stepped, status: "restarting" }, [
            { type: "reportCollision", reportingNode: sim.id, otherNode: hit.nodeId },
          ])
        : ok(stepped);
    }
  }
}

// compute the current x,y location of the bob
export function currentLocation(sim: Sim) {
  const { length: L, anchor } = sim.config;
  const { angle } = sim.pendulumState;
  return {
    anchorX: anchor.x,
    x: anchor.x + L * Math.sin(angle), // bob hangs from the anchor...
    y: -L * Math.cos(angle), // ...and swings below the beam (y down)
  };
}

export function snapshot(sim: Sim): SimSnapshot {
  return {
    id: sim.id,
    angle: sim.pendulumState.angle,
    status: sim.status,
    position: { ...currentLocation(sim) },
  };
}

export const toBobPositions = (neighbors: NeighborsLocation): BobPosition[] =>
  Array.from(neighbors.values(), ({ nodeId, x, y }) => ({ nodeId, x, y }));
