import { assertNever } from "@pendulum/shared";
import { Effect } from "./simulation";
import { SendWsMessage } from "./gatewayWsConn";

export function executeEffects(effects: Effect[], sendWsMessage: SendWsMessage) {
  for (const e of effects) {
    switch (e.type) {
      case "reportCollision":
        sendWsMessage({
          type: "PendulumCollisionUpdate",
          data: { ...e },
        });
        return;
    }
  }
}
