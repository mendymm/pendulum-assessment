import type { PendulumConfig } from "@pendulum/shared";

async function startServer(nodeId: number) {}

const nodeId = Number(process.argv[2]);
if (Number.isNaN(nodeId)) {
  throw new Error(`expected number as the nodeId, got: ${process.argv[2]}`);
}
startServer(nodeId);
