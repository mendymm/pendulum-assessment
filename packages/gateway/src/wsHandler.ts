import { upgradeWebSocket } from "@hono/node-server";
import { assertNever } from "@pendulum/shared";
import { type PendulumLocation, parseWsEnvelope, type WsEnvelope } from "@pendulum/shared/src/types";
import type { WSContext, WSMessageReceive } from "hono/ws";

// connected sim nodes
const sockets = new Map<number, WSContext>();

// location of all pendulums, constantly updated with the latest data fed from the ws
export const pendulumLocations = new Map<number, PendulumLocation>();

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
      pendulumLocations.set(wsEnvelope.data.nodeId, wsEnvelope.data);
      fanoutMessage(wsEnvelope, wsEnvelope.data.nodeId);
      break;
    }
    case "PendulumCollisionUpdate":
      fanoutMessage(wsEnvelope, wsEnvelope.data.reportingNode);
      break;
    default:
      assertNever(wsEnvelope);
  }
}

// fan out updates to the all other sim nodes
// I am assuming that we will have < ~50 nodes, so this fan out is not prohibitively expensive
function fanoutMessage(msg: WsEnvelope, senderNodeId: number) {
  const forward = JSON.stringify(msg);
  for (const [id, ws] of sockets) {
    if (id !== senderNodeId) ws.send(forward);
  }
}
