interface RuntimeConfig {
  gatewayPort: number;

  // A sim will listen on a port computed from simStartPort + <my node id>
  simStartPort: number;
  // Number of pendulum sims
  simCount: number;
}

export const RUNTIME_CONFIG: RuntimeConfig = {
  gatewayPort: 8000,
  simStartPort: 9000,
  simCount: 5,
};
