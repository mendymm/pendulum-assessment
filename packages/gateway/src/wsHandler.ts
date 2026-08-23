import { upgradeWebSocket } from "@hono/node-server";
import { assertNever } from "@pendulum/shared";
import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";
import { type PendulumLocation, parseWsEnvelope, type WsEnvelope } from "@pendulum/shared/src/types";
import type { WSContext, WSMessageReceive } from "hono/ws";

// connected sim nodes
const sockets = new Map<number, WSContext>();

// location of all pendulums, constantly updated with the latest data fed from the ws
export const pendulumLocations = new Map<number, PendulumLocation>();

// per-node scheduled auto-restart time (wall-clock ms), present only while a node is
// collided. The UI counts down to it. Set when a collision arrives (for BOTH nodes in
// the pair), cleared when a node reports a location again — a location update means it's
// ticking, i.e. it has already restarted.
export const pendulumRestarts = new Map<number, number>();

// wall-clock (ms) of the last change to the world the UI cares about — a new location
// or a collision (dis)appearing. Nodes only emit location updates while running, so this
// freezes whenever the sim is paused/stopped or every pendulum has collided. The UI feed
// uses it to avoid re-sending an unchanged frame. Collisions bump it too, so the frame
// carrying a new countdown still goes out. (ESM live binding: importers read the current value.)
export let lastWorldChangeAt = 0;

export const simWsHandler = upgradeWebSocket((c) => {
  const nodeId = Number(c.req.query("nodeId"));

  return {
    onOpen: (_evt, ws) => {
      if (Number.isNaN(nodeId)) return ws.close(1008, "missing or invalid nodeId");
      sockets.set(nodeId, ws);
      console.log(`sim-node ${nodeId} connected (${sockets.size} total)`);
    },
    onMessage: onMessage,
    onClose: () => {
      sockets.delete(nodeId);
      pendulumLocations.delete(nodeId);
      console.log(`sim-node ${nodeId} disconnected (${sockets.size} total)`);
    },
  };
});

function onMessage(evt: MessageEvent<WSMessageReceive>) {
  const wsEnvelope = parseWsEnvelope(evt.data.toString());
  if (wsEnvelope === null) {
    console.log(`Unexpected ws message, ignore message. msg: ${evt.data.toString()}`);
    return;
  }

  switch (wsEnvelope.type) {
    case "PendulumLocationUpdate": {
      const { nodeId } = wsEnvelope.data;
      pendulumLocations.set(nodeId, wsEnvelope.data);
      // a location means this node is ticking again → it's no longer collided.
      if (pendulumRestarts.delete(nodeId)) markWorldChanged();
      markWorldChanged();
      fanoutMessage(wsEnvelope, nodeId);
      break;
    }
    case "PendulumCollisionUpdate": {
      // both nodes in the pair are now collided and will auto-restart together at
      // timestamp + restartMs. Keep the earliest deadline if one is already pending
      // (mirrors the sim's merge-toward-earliest-collision semantics).
      const restartAt = wsEnvelope.data.timestamp + RUNTIME_CONFIG.restartSec * 1000;
      setRestart(wsEnvelope.data.reportingNode, restartAt);
      setRestart(wsEnvelope.data.with, restartAt);
      fanoutMessage(wsEnvelope, wsEnvelope.data.reportingNode);
      break;
    }
    default:
      assertNever(wsEnvelope);
  }
}

function setRestart(nodeId: number, restartAt: number) {
  const existing = pendulumRestarts.get(nodeId);
  if (existing !== undefined && existing <= restartAt) return;
  pendulumRestarts.set(nodeId, restartAt);
  markWorldChanged();
}

function markWorldChanged() {
  lastWorldChangeAt = Date.now();
}

// fan out updates to the all other sim nodes
// I am assuming that we will have < ~50 nodes, so this fan out is not prohibitively expensive
function fanoutMessage(msg: WsEnvelope, senderNodeId: number) {
  const forward = JSON.stringify(msg);
  for (const [id, ws] of sockets) {
    if (id !== senderNodeId) ws.send(forward);
  }
}
