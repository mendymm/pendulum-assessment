import { upgradeWebSocket } from "@hono/node-server";
import { assertNever } from "@pendulum/shared";
import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";
import { type PendulumLocation, parseWsEnvelope, type WsEnvelope } from "@pendulum/shared/src/types";
import type { WSContext, WSMessageReceive } from "hono/ws";

// connected sim nodes
const sockets = new Map<number, WSContext>();

// location of all pendulums, constantly updated with the latest data fed from the ws
export const pendulumLocations = new Map<number, PendulumLocation>();

// wall-clock (ms) of the last change to the world the UI cares about — a new location.
// Nodes only emit location updates while running, so this freezes whenever the sim is
// paused/stopped. The UI feed uses it to avoid re-sending an unchanged frame.
// (ESM live binding: importers read the current value.)
export let lastWorldChangeAt = 0;

// ws message tallies keyed by message type, global to the gateway process and read by the
// debug loop. recv = messages arriving from sim nodes; sent = messages we push out (each
// location broadcast, plus every UI frame — counted from main.ts via `countSent`).
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
      markWorldChanged();
      // NOTE: we no longer fan this out per-event. Locations are broadcast to nodes on a
      // fixed simHz cadence by `broadcastLocations` — this just records the latest position.
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

// wall-clock (ms) of the last location broadcast, so we can skip a round when nothing in
// the world moved since — same guard the UI feed uses against re-sending a stale frame.
let lastLocationBroadcastAt = 0;

// Push every node the whole world in a single `WorldSnapshot` message on a fixed cadence,
// decoupling the send rate from the (bursty, per-tick) receive rate. One message per node
// per round (nodes filter out their own entry), so this is N sends/round rather than the
// old N·(N-1). Nodes replace their neighbour view from it, so it's idempotent. Skipped
// while the world is frozen (paused/stopped) — `markWorldChanged` unblocks it.
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
