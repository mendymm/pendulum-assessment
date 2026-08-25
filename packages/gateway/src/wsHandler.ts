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

// --- collision-restart barrier (the gateway is the star-topology coordinator) ---
//
//   running ──collisionDetected──▶ collecting-acks ──all acks / timeout──▶ counting-down ──5s──▶ running
//
// While anything other than `running`, the gateway holds a "collision detected" marker and
// ignores further collisionDetected events — this serializes episodes end-to-end, which is what
// lets the nodes fence stale restarts on status alone (see the node's execRelaunch).
type RestartPhase = "running" | "collecting-acks" | "counting-down";
let restartPhase: RestartPhase = "running";

// monotonic episode id; bumped when a handshake opens. Echoed by nodes in their acks so a late
// ack from a closed episode is easy to discard.
let currentEpisode = 0;

// membership snapshot: the nodeIds we're still waiting on for THIS episode. Captured when the
// handshake opens; a node that disconnects mid-handshake is dropped from it so the barrier can
// still complete (survivors-proceed), and the ack timeout is the last-resort backstop.
let pendingAcks = new Set<number>();
let ackTimer: ReturnType<typeof setTimeout> | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

// UI-facing restart marker, included in the live feed frame while a countdown is running so the
// UI can render an explicit countdown to `restartAt` instead of inferring one. null when idle.
// (ESM live binding: the UI feed in main.ts reads the current value.)
export let uiRestart: { episode: number; restartAt: number } | null = null;

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
      // If this node was part of an in-flight barrier, stop waiting on it — a gone node must
      // not be able to stall the handshake. This may be the ack we were waiting for.
      if (restartPhase === "collecting-acks" && pendingAcks.delete(nodeId) && pendingAcks.size === 0) {
        completeBarrier();
      }
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
    case "collisionDetected": {
      // First report of a fresh episode opens the barrier; while an episode is in flight the
      // marker makes every further collision a no-op (we don't stack episodes).
      if (restartPhase === "running") openHandshake();
      break;
    }
    case "collisionAck": {
      onAck(wsEnvelope.data.nodeId, wsEnvelope.data.episode);
      break;
    }
    case "WorldSnapshot":
    case "collisionInducedRestart":
    case "restart":
      // the gateway produces these; a node should never send one to us.
      console.log(`unexpected ${wsEnvelope.type} from a node, ignoring`);
      break;
    default:
      assertNever(wsEnvelope);
  }
}

// Open a restart episode: bump the id, snapshot who must ack, broadcast the STOP+handshake, and
// arm the ack-timeout backstop. If somehow nobody is connected, the barrier is trivially done.
function openHandshake() {
  currentEpisode += 1;
  restartPhase = "collecting-acks";
  pendingAcks = new Set(sockets.keys());
  const payload = JSON.stringify({ type: "collisionInducedRestart", episode: currentEpisode } satisfies WsEnvelope);
  void sendToAll(sockets.values(), payload, "collisionInducedRestart");
  if (pendingAcks.size === 0) {
    completeBarrier();
    return;
  }
  ackTimer = setTimeout(onAckTimeout, RUNTIME_CONFIG.ackTimeoutMs);
}

// A node reported it has halted for this episode. Ignore stale/duplicate acks; complete the
// barrier once the last awaited node checks in.
function onAck(nodeId: number, episode: number) {
  if (restartPhase !== "collecting-acks" || episode !== currentEpisode) return;
  if (pendingAcks.delete(nodeId) && pendingAcks.size === 0) completeBarrier();
}

// The barrier didn't fully close in time: proceed with whoever acked (survivors-proceed policy)
// so one silent node can't freeze the simulation. The dropped nodes just miss this restart.
function onAckTimeout() {
  if (restartPhase !== "collecting-acks") return;
  console.log(`restart barrier: ack timeout, proceeding without node(s) [${[...pendingAcks].join(", ")}]`);
  completeBarrier();
}

// Barrier closed. Start the shared countdown: everyone (nodes + UI) targets the same absolute
// `restartAt`, so the "wait 5s" happens in lockstep and no single clock is authoritative.
function completeBarrier() {
  if (ackTimer !== null) {
    clearTimeout(ackTimer);
    ackTimer = null;
  }
  restartPhase = "counting-down";
  const restartAt = Date.now() + RUNTIME_CONFIG.restartSec * 1000;
  uiRestart = { episode: currentEpisode, restartAt };
  markWorldChanged(); // nudge the UI feed to push a frame carrying the countdown
  const payload = JSON.stringify({ type: "restart", episode: currentEpisode, at: restartAt } satisfies WsEnvelope);
  void sendToAll(sockets.values(), payload, "restart");
  restartTimer = setTimeout(finishEpisode, RUNTIME_CONFIG.restartSec * 1000);
}

// Countdown elapsed (in step with the nodes' own relaunch timers): clear the episode and let
// normal location fan-out resume as nodes tick again.
function finishEpisode() {
  if (restartTimer !== null) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  restartPhase = "running";
  pendingAcks = new Set();
  uiRestart = null;
  markWorldChanged(); // push a frame that clears the countdown on the UI
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
