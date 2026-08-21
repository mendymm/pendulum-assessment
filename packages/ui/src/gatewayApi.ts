import { RUNTIME_CONFIG } from "@pendulum/shared";

// Control commands the gateway fans out to every sim node.
export type ControlCommand = "start" | "pause" | "resume" | "stop";

// Absolute gateway origin so this works both in dev (vite on another port) and
// when the gateway serves the built UI. Matches useUiUpdates' WS URL.
const base = `http://127.0.0.1:${RUNTIME_CONFIG.gatewayPort}`;

export async function sendControl(command: ControlCommand): Promise<void> {
  try {
    await fetch(`${base}/api/${command}`, { method: "POST" });
  } catch (err) {
    console.error(`control "${command}" failed`, err);
  }
}
