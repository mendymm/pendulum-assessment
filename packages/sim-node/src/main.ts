import { RUNTIME_CONFIG } from "@pendulum/shared";
import { createSim } from "./simulation";

// each physics `step` advances this amount of time (DELTA T)
const DT = 1 / RUNTIME_CONFIG.simHz;

// clamp the max amount of ticks we will catch up to in a single wake up
const MAX_CATCHUP_TICKS = 100;

const MAX_FRAME = MAX_CATCHUP_TICKS * DT;

async function startServer(nodeId: number) {
  let listingPort = RUNTIME_CONFIG.simStartPort+nodeId;
  console.log(`Listing on 127.0.0.1:${listingPort}`);
  // let sim = createSim(nodeId,{
  //   anchor
  // })
}

const nodeId = Number(process.argv[2]);
if (Number.isNaN(nodeId)) {
  throw new Error(`expected number as the nodeId, got: ${process.argv[2]}`);
}
startServer(nodeId);
