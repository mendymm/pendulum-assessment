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

// ws message tallies keyed by message type, global to the gateway process and read by the
// debug loop. recv = messages arriving from sim nodes; sent = messages we push out (each
// location broadcast + each fanned-out collision, plus every UI frame — counted from
// main.ts via `countSent`).
export const wsRecvCounts: Record<string, number> = {};
export const wsSentCounts: Record<string, number> = {};

const bump = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

// exposed so the UI feed in main.ts can tally the frames it sends
export const countSent = (type: string) => bump(wsSentCounts, type);

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

  bump(wsRecvCounts, wsEnvelope.type);

  switch (wsEnvelope.type) {
    case "PendulumLocationUpdate": {
      const { nodeId } = wsEnvelope.data;
      pendulumLocations.set(nodeId, wsEnvelope.data);
      // a location means this node is ticking again → it's no longer collided.
      if (pendulumRestarts.delete(nodeId)) markWorldChanged();
      markWorldChanged();
      // NOTE: we no longer fan this out per-event. Locations are broadcast to nodes on a
      // fixed simHz cadence by `broadcastLocations` — this just records the latest position.
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
    case "WorldSnapshot":
      // the gateway produces these; a node should never send one to us.
      console.log("unexpected WorldSnapshot from a node, ignoring");
      break;
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

// Send one already-serialized payload to a set of sockets concurrently (rather than
// awaiting each in turn), isolating per-socket failures so one dead socket doesn't abort
// the whole round. I am assuming < ~50 nodes, so fanning out to all at once is fine.
async function sendToAll(targets: Iterable<WSContext>, payload: string, type: string): Promise<void> {
  await Promise.all(
    [...targets].map(async (ws) => {
      try {
        await ws.send(payload);
        bump(wsSentCounts, type);
      } catch {
        // socket went away mid-send; the next round will catch it up
      }
    }),
  );
}

// fan a message out to every sim node except the sender (used for collisions)
function fanoutMessage(msg: WsEnvelope, senderNodeId: number) {
  const forward = JSON.stringify(msg);
  const targets = [...sockets].filter(([id]) => id !== senderNodeId).map(([, ws]) => ws);
  void sendToAll(targets, forward, msg.type);
}

// wall-clock (ms) of the last location broadcast, so we can skip a round when nothing in
// the world moved since — same guard the UI feed uses against re-sending a stale frame.
let lastLocationBroadcastAt = 0;

// Push every node the whole world in a single `WorldSnapshot` message on a fixed cadence,
// decoupling the send rate from the (bursty, per-tick) receive rate. One message per node
// per round (nodes filter out their own entry), so this is N sends/round rather than the
// old N·(N-1). Nodes replace their neighbour view from it, so it's idempotent. Skipped
// while the world is frozen (paused/stopped/all-collided) — `markWorldChanged` unblocks it.
function broadcastLocations() {
  if (lastWorldChangeAt <= lastLocationBroadcastAt) return;
  const payload = JSON.stringify({ type: "WorldSnapshot", data: [...pendulumLocations.values()] } satisfies WsEnvelope);
  void sendToAll(sockets.values(), payload, "WorldSnapshot");
  lastLocationBroadcastAt = Date.now();
}

// start the location broadcast loop; call once at startup
export function startLocationBroadcast(everyMs = 1000 / RUNTIME_CONFIG.simHz) {
  setInterval(broadcastLocations, everyMs);
}
