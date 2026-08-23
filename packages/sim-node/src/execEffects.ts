import type { SendWsMessage } from "./gatewayWsConn";
import type { Effect } from "./simulation";

export function executeEffects(effects: Effect[], sendWsMessage: SendWsMessage) {
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
    }
  }
}
