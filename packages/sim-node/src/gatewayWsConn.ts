import { assertNever } from "@pendulum/shared";
import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";
import { type PendulumLocation, parseWsEnvelope, type WsEnvelope } from "@pendulum/shared/src/types";
import type { Mailbox } from "./mailbox";

export type NeighborsLocation = Map<number, PendulumLocation>;
export type SendWsMessage = (wsMsg: WsEnvelope) => void;

// running tally of how many WS events we've received, keyed by event type. purely for
// debugging/observability — a simple module global, incremented on each WS message and
// read directly by the debug output.
export const wsEventCounts: Record<WsEnvelope["type"], number> = {
  PendulumLocationUpdate: 0,
  WorldSnapshot: 0,
  collisionDetected: 0,
  collisionInducedRestart: 0,
  collisionAck: 0,
  restart: 0,
};

// The gateway drives the collision-restart barrier by pushing WS messages we turn into
// commands on our inbox, so they flow through the state machine like any other command.
export function connectToGateway(
  nodeId: number,
  inbox: Mailbox,
): { neighbors: NeighborsLocation; sendWsMessage: SendWsMessage } {
  const url = `ws://127.0.0.1:${RUNTIME_CONFIG.gatewayPort}/api/ws?nodeId=${nodeId}`;

  // latest known positions of the other nodes, keyed by nodeId
  const neighbors: NeighborsLocation = new Map();

  let ws: WebSocket;

  // basic reconnect loop, useful at startup if sim starts before gateway
  const connect = () => {
    ws = new WebSocket(url);

    ws.addEventListener("open", () => console.log(`node ${nodeId} connected to gateway`));
    ws.addEventListener("error", (err) => console.error(`node ${nodeId} ws error`, err));
    ws.addEventListener("close", () => {
      console.log(`node ${nodeId} disconnected, retrying in 50ms`);
      setTimeout(connect, 50);
    });

    ws.addEventListener("message", (evt) => {
      const wsEnvelope = parseWsEnvelope(evt.data.toString());

      if (wsEnvelope === null) {
        console.log(`Unexpected ws message, ignore message. msg: ${evt.data.toString()}`);
        return;
      }

      wsEventCounts[wsEnvelope.type]++;

      switch (wsEnvelope.type) {
        case "WorldSnapshot":
          // the gateway sends the whole world in one message; replace our view wholesale.
          // (our own entry is included — detectCollision filters self out.)
          neighbors.clear();
          for (const loc of wsEnvelope.data) neighbors.set(loc.nodeId, loc);
          return;
        case "PendulumLocationUpdate":
          // legacy single-node path; the gateway now sends WorldSnapshot, but a stray
          // single update is still safe to fold into our neighbour view.
          neighbors.set(wsEnvelope.data.nodeId, wsEnvelope.data);
          return;
        case "collisionInducedRestart":
          // STOP + join the barrier for this episode.
          inbox.push({ command: { type: "haltForRestart", episode: wsEnvelope.episode } });
          return;
        case "restart":
          // barrier done — arm our relaunch for the shared absolute instant.
          inbox.push({ command: { type: "restart", episode: wsEnvelope.episode, at: wsEnvelope.at } });
          return;
        case "collisionDetected":
        case "collisionAck":
          // these are node → gateway; a node should never receive them.
          console.log(`unexpected ${wsEnvelope.type} from the gateway, ignoring`);
          return;
        default:
          assertNever(wsEnvelope);
      }
    });
  };

  connect();

  const sendWsMessage = (wsMsg: WsEnvelope) => {
    if (ws.readyState !== WebSocket.OPEN) {
      console.log("WS closed");
      return;
    }
    ws.send(JSON.stringify(wsMsg));
  };

  return { neighbors, sendWsMessage };
}
