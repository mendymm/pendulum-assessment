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
  type PendulumCollisionUpdate,
  type PendulumConfig,
  type PendulumConfigPatch,
  type PendulumLocation,
  type Point,
  type SimSnapshot,
  type SimStatus,
} from "@pendulum/shared/src/types";
import type { NeighborsLocation } from "./gatewayWsConn";
import { detectCollision, type PendulumState, step } from "./pendulum";

export interface Sim {
  readonly nodeId: NodeId;
  readonly config: PendulumConfig;
  readonly status: SimStatus;
  readonly pendulumState: PendulumState;
  readonly commandsCompleted: number;
  readonly commandsRejected: number;
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

  // same as stop, separate event for better readability
  | { type: "collision" }

  // configure the pendulum: you can configure the pendulum at any status
  | { type: "configure"; config: PendulumConfigPatch }

  // tick the simulation by DT, only valid from the running state
  // includes the latest snapshot of our internal map of the world state.
  // passing in world state as a snapshot, ensures our state machine is not reading a global map,
  // and makes testing easier
  | { type: "tick"; dt: number; worldState: PendulumLocation[] };

export type Effect =
  | { type: "reportCollision"; data: PendulumCollisionUpdate }
  | { type: "reportLocation"; data: PendulumLocation };

export interface Rejection {
  command: Command;
  from: SimStatus;
  reason: string;
}

export type Outcome =
  | { result: "ok"; sim: Sim; effects: Effect[] }
  | { result: "rejected"; sim: Sim; rejection: Rejection };

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
    commandsCompleted: 0,
    commandsRejected: 0,
  };
}

const ok = (nextSim: Sim, effects: Effect[] = []): Outcome => ({
  result: "ok",
  sim: { ...nextSim, commandsCompleted: nextSim.commandsCompleted + 1 },
  effects,
});

const reject = (nextSim: Sim, command: Command, reason: string): Outcome => ({
  result: "rejected",
  sim: { ...nextSim, commandsRejected: nextSim.commandsRejected + 1 },
  rejection: { command, from: nextSim.status, reason },
});

// This is the simulation, expressed as a pure function
//
// Invalid transitions I.E. pausing while the sim is already paused are no-ops
export function transition(sim: Sim, command: Command): Outcome {
  switch (command.type) {
    case "start":
      return ok({
        ...sim,
        pendulumState: { angle: sim.config.angle, angularVelocity: 0 },
        status: "running",
      });

    case "pause":
      return sim.status === "running" ? ok({ ...sim, status: "paused" }) : reject(sim, command, "not running");

    case "resume":
      return sim.status === "paused" ? ok({ ...sim, status: "running" }) : reject(sim, command, "not paused");

    case "collision": // same as stop
    case "stop":
      // freeze in place: keep the current angle, just kill the velocity.
      // (start relaunches from config.angle.)
      return sim.status === "stopped"
        ? reject(sim, command, "already stopped")
        : ok({ ...sim, status: "stopped", pendulumState: { ...sim.pendulumState, angularVelocity: 0 } });

    case "configure": {
      const config = { ...sim.config, ...command.config };
      // changing the launch angle drops the bob from rest, so kill any velocity
      const angleChanged = command.config.angle !== undefined && command.config.angle !== sim.config.angle;
      const pendulumState = angleChanged ? { ...sim.pendulumState, angularVelocity: 0 } : sim.pendulumState;
      return ok({ ...sim, config, pendulumState });
    }

    case "tick": {
      if (sim.status !== "running") return reject(sim, command, "not running");
      const stepped = { ...sim, pendulumState: step(sim.pendulumState, sim.config, command.dt) };
      const me = { posistion: posistion(stepped), bobRadius: bobRadius(stepped.config.mass) };
      const reportLocation: Effect = {
        type: "reportLocation",
        data: {
          nodeId: sim.nodeId,
          bobRadius: bobRadius(sim.config.mass),
          anchorX: sim.config.anchorX,
          posistion: posistion(sim),
        },
      };
      const hit = detectCollision(sim.nodeId, me, command.worldState);

      return hit
        ? ok({ ...stepped, status: "restarting" }, [
            reportLocation,
            { type: "reportCollision", data: { reportingNode: sim.nodeId, otherNode: hit.nodeId } },
          ])
        : ok(stepped, [reportLocation]);
    }
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
