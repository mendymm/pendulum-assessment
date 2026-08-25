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

  // seconds a collided node waits before restarting its episode (the countdown that
  // runs on every node + the UI once the gateway's restart barrier completes)
  restartSec: number;

  // how long the gateway waits for every node in the membership snapshot to send its
  // `collisionAck` before completing the barrier anyway with whoever answered. Bounds the
  // handshake so one silent node can't wedge the whole simulation.
  ackTimeoutMs: number;
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
  ackTimeoutMs: 2000, // barrier gives up on a silent node after 2s and proceeds with survivors
};
