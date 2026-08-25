import { assertNever } from "@pendulum/shared";
import type { SendWsMessage } from "./gatewayWsConn";
import type { Mailbox } from "./mailbox";
import type { Effect } from "./simulation";

// Effects are the sim's requests to the outside world. Most turn into a WS message to the
// gateway; `scheduleRelaunch` instead arms a timer that pushes a `relaunch` command back into
// our own inbox at the shared absolute instant, so we re-enter the state machine cleanly rather
// than mutating `sim` from a callback.
export function executeEffects(effects: Effect[], sendWsMessage: SendWsMessage, inbox: Mailbox) {
  for (const e of effects) {
    switch (e.type) {
      case "reportLocation":
        sendWsMessage({ type: "PendulumLocationUpdate", data: e.data });
        break;
      case "collisionDetected":
        sendWsMessage({ type: "collisionDetected", data: e.data });
        break;
      case "collisionAck":
        sendWsMessage({ type: "collisionAck", data: e.data });
        break;
      case "scheduleRelaunch":
        setTimeout(
          () => inbox.push({ command: { type: "relaunch", episode: e.episode } }),
          Math.max(0, e.at - Date.now()),
        );
        break;
      default:
        assertNever(e);
    }
  }
}
