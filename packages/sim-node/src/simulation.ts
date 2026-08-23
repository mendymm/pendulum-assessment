/**
 * The simulation is a state machine. An immutable `Sim` interface holds the current state of the sim
 * A sim is a result of the function F(Sim, Command) => Outcome{Sim, Effects}
 *
 * This setup allows me to very easily test the sim's logic
 */

import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";
import {
  bobRadius,
  type Collision,
  defaultPendulumConfig,
  type NodeId,
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
  readonly collision: Collision | null;
  readonly generation: number; // bumped once per collision episode
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

  // a collision report (self-detected or gossiped from a neighbour). always carries
  // the full Collision record so nodes can merge toward the earliest one.
  | { type: "collision"; collision: Collision }

  // fire the scheduled restart for a given episode; fenced by status + generation
  | { type: "restart"; generation: number }

  // configure the pendulum: you can configure the pendulum at any status
  | { type: "configure"; config: PendulumConfigPatch }

  // tick the simulation by DT, only valid from the running state
  // includes the latest snapshot of our internal map of the world state.
  // passing in world state as a snapshot, ensures our state machine is not reading a global map,
  // and makes testing easier
  | { type: "tick"; dt: number; worldState: PendulumLocation[]; now: number };

export type Effect =
  | { type: "reportCollision"; data: Collision }
  | { type: "reportLocation"; data: PendulumLocation }
  | { type: "scheduleRestart"; at: number; generation: number };

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
    collision: null,
    generation: 0,
  };
}

const RESTART_MS = RUNTIME_CONFIG.restartSec * 1000;

// Apply a collision from either the `collision` command or a tick-detected hit.
// A brand-new episode (was not collided) bumps the generation — that bump is the
// fence a stale restart from a previous episode fails to match. Within an episode
// we only converge (merge toward the earliest report) and reschedule if it changed.
function applyCollision(sim: Sim, c: Collision, extra: Effect[] = []): Outcome {
  if (sim.collision === null) {
    const generation = sim.generation + 1;
    return ok({ ...sim, status: "collided", collision: c, generation }, [
      ...extra,
      { type: "scheduleRestart", at: c.timestamp + RESTART_MS, generation },
    ]);
  }
  // mergeCollision returns the SAME reference when nothing changed, so
  // reference-equality is a valid "did it change?" check → skip a pointless reschedule.
  const merged = mergeCollision(sim.collision, c);
  if (merged === sim.collision) return ok(sim, extra);
  return ok({ ...sim, collision: merged }, [
    ...extra,
    { type: "scheduleRestart", at: merged.timestamp + RESTART_MS, generation: sim.generation },
  ]);
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
      // a manual start comes back fresh: clear any collision and relaunch from config.angle
      return ok({
        ...sim,
        pendulumState: { angle: sim.config.angle, angularVelocity: 0 },
        status: "running",
        collision: null,
      });

    case "pause":
      return sim.status === "running" ? ok({ ...sim, status: "paused" }) : reject(sim, command, "not running");

    case "resume":
      return sim.status === "paused" ? ok({ ...sim, status: "running" }) : reject(sim, command, "not paused");

    case "collision":
      // valid from ANY status: it's a merge toward the earliest report, never a blind
      // overwrite, so it's idempotent and safe to accept anywhere.
      return applyCollision(sim, command.collision);

    case "restart":
      // fenced twice: status rejects a duplicate restart within this episode (we're
      // already running), generation rejects a leftover timer from a previous episode.
      if (sim.status !== "collided") return reject(sim, command, "not collided");
      if (command.generation !== sim.generation) return reject(sim, command, "stale restart");
      return ok({
        ...sim,
        status: "running",
        collision: null,
        pendulumState: { angle: sim.config.angle, angularVelocity: 0 },
      });

    case "stop":
      // freeze in place: keep the current angle, just kill the velocity.
      // (start relaunches from config.angle.) clear collision so a stopped node
      // never looks half-collided.
      return sim.status === "stopped"
        ? reject(sim, command, "already stopped")
        : ok({
            ...sim,
            status: "stopped",
            collision: null,
            pendulumState: { ...sim.pendulumState, angularVelocity: 0 },
          });

    case "configure": {
      const config = { ...sim.config, ...command.config };
      // changing the launch angle drops the bob from rest, so kill any velocity
      const angleChanged = command.config.angle !== undefined && command.config.angle !== sim.config.angle;
      const pendulumState = angleChanged ? {  angularVelocity: 0, angle: (command.config.angle??sim.pendulumState.angle) } : sim.pendulumState;
      // const pendulumState = angleChanged ? { ...sim.pendulumState, angularVelocity: 0, } : sim.pendulumState;
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
          posistion: posistion(stepped),
        },
      };
      const hit = detectCollision(sim.nodeId, me, command.worldState);
      if (!hit) return ok(stepped, [reportLocation]);

      // a tick-detected hit always starts a new episode (stepped is running, so
      // stepped.collision is null) — applyCollision bumps the generation for us.
      const c: Collision = { reportingNode: sim.nodeId, with: hit.nodeId, timestamp: command.now };
      return applyCollision(stepped, c, [reportLocation, { type: "reportCollision", data: c }]);
    }
  }
}

// keep the earlier collision (ties: lower reporting node, then lower `with`). a total
// order over reports, so two distinct reports are never equally good. the held state
// may be null (nothing seen yet) — then we just adopt the incoming report — but the
// incoming report is always a real collision, so the result is never null.
export function mergeCollision(colFromSimState: Collision | null, colFromCommand: Collision): Collision {
  const a = colFromSimState;
  const b = colFromCommand;
  if (a === null) return b;
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? a : b;
  if (a.reportingNode !== b.reportingNode) return a.reportingNode < b.reportingNode ? a : b;
  return a.with <= b.with ? a : b;
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
