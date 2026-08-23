import type { SendWsMessage } from "./gatewayWsConn";
import type { Mailbox } from "./mailbox";
import type { Effect } from "./simulation";

export function executeEffects(effects: Effect[], sendWsMessage: SendWsMessage, inbox: Mailbox) {
  for (const e of effects) {
    switch (e.type) {
      case "reportCollision":
        sendWsMessage({
          type: "PendulumCollisionUpdate",
          data: e.data,
        });
        break;
      case "reportLocation":
        sendWsMessage({
          type: "PendulumLocationUpdate",
          data: e.data,
        });
        break;
      case "scheduleRestart":
        // arm a fire-and-forget timer keyed to the shared timestamp so every node
        // restarts together. no need to track/clear it: the state machine's status +
        // generation guards make a late or duplicate restart a harmless no-op.
        setTimeout(
          () => inbox.push({ command: { type: "restart", generation: e.generation } }),
          Math.max(0, e.at - Date.now()),
        );
        break;
    }
  }
}
