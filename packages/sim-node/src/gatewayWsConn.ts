import {
  assertNever,
  type PendulumLocationUpdate,
  parseWsEnvelope,
  RUNTIME_CONFIG,
  type WsEnvelope,
} from "@pendulum/shared";
import type { Envelope, Mailbox } from "./mailbox";

export type NeighborsLocation = Map<number, PendulumLocationUpdate>;
export type SendWsMessage = (wsMsg: WsEnvelope) => void;

export function connectToGateway(
  nodeId: number,
  inbox: Mailbox<Envelope>,
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

      switch (wsEnvelope.type) {
        case "PendulumLocationUpdate":
          neighbors.set(wsEnvelope.data.nodeId, wsEnvelope.data);
          return;
        case "PendulumCollisionUpdate": {
          // todo(prod): add a method to the mailbox that allows this message to be "high priority"
          // if the mailbox has any other commands the next time `recv` is called they should be ignored, and this event should take priority.
          console.log(`collision: ${wsEnvelope}`);
          inbox.push({
            command: { type: "collision" },
          });
          return;
        }
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
