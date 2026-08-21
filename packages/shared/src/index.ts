export { RUNTIME_CONFIG } from "./config";
export type { PendulumLocationUpdate, WsEnvelope } from "./wsMessages";
export { parseWsEnvelope } from "./wsMessages";

export interface PendulumConfig {
  angle: number;
  mass: number;
  length: number;
  anchor: {
    // position along the beam (y is always fixed)
    x: number;
  };
}

export interface Environment {
  wind: number;
  gravity: number;
  damping: number;
}

export type SimStatus = "running" | "paused" | "stopped" | "restarting" | "countdown";

export interface SimSnapshot {
  // each sim has an incrementing ID
  id: number;
  angle: number;
  position: {
    x: number;
    y: number;
  };
  status: SimStatus;
  startupConfig: PendulumConfig;
}
