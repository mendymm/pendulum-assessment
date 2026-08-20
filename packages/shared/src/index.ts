export { RUNTIME_CONFIG } from "./config";

export interface PendulumConfig {
  angle: number;
  mass: number;
  length: number;
  anchor: {
    // position along the beam (y is always fixed)
    x: number;
  };
}

export type SimStatus =
  | "running"
  | "paused"
  | "stopped"
  | "restarting"
  | "countdown";

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
