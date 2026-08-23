interface RuntimeConfig {
  gatewayPort: number;

  // A sim will listen on a port computed from simStartPort + <my node id>
  simStartPort: number;

  // Number of pendulum sims
  simCount: number;

  // Number of simulation steps per second
  simHz: number;

  // how often should the gateway push position updates to the UI
  uiUpdateHz: number;

  // the max radius of a bob in meters
  maxBobR: number;

  // in kg, the weight at which a bob will reach maxR
  maxBobMass: number;

  // seconds a collided node waits before restarting its episode
  restartSec: number;
}

export const RUNTIME_CONFIG: RuntimeConfig = {
  gatewayPort: 8000,
  simStartPort: 9000,
  simCount: 5,
  simHz: 120,
  uiUpdateHz: 60,

  maxBobR: 2,
  maxBobMass: 100,

  restartSec: 5, // the spec's 5-second wait
};
