import { serve } from "@hono/node-server";
import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";
import { type NodeId, NodeIdSchema } from "@pendulum/shared/src/types";
import { Hono } from "hono";
import { addControlPlaneRoutes } from "./controlPlane";
import { debugSimState } from "./debug";
import { executeEffects } from "./execEffects";
import { connectToGateway } from "./gatewayWsConn";
import { mailbox } from "./mailbox";
import { createSim, transition } from "./simulation";

const app = new Hono();

// each physics `step` advances this amount of time (DELTA T)
const DT = 1 / RUNTIME_CONFIG.simHz;

const MAX_CATCHUP_MS = 250; // after a stall, drop the backlog instead of flooding the inbox

async function startServer(nodeId: NodeId) {
  const listingPort = RUNTIME_CONFIG.simStartPort + nodeId;
  console.log(`Listing on 127.0.0.1:${listingPort}`);

  const inbox = mailbox();
  let sim = createSim(nodeId);

  addControlPlaneRoutes(app, inbox, () => sim);
  serve({ fetch: app.fetch, hostname: "127.0.0.1", port: listingPort });

  const { neighbors, sendWsMessage } = connectToGateway(nodeId, inbox);

  // the only writer of `sim` during operation
  const consume = async () => {
    let iterCount = 0;
    while (true) {
      iterCount++;
      const { command, reply } = await inbox.recv();

      // transition the state machine 1 step
      const out = transition(sim, command);
      sim = out.sim;

      debugSimState(iterCount, sim, command.type);

      if (out.result === "ok") {
        // execute side-effects of the state machine
        executeEffects(out.effects, sendWsMessage, inbox);
      }
      reply?.(out);
    }
  };

  // tick producer will send `tick` events into our queue, at a rate configured by `simHz`
  let nextTickAt = performance.now();
  setInterval(() => {
    // Only feed a running sim
    if (sim?.status !== "running") {
      nextTickAt = performance.now(); // keep the deadline fresh while idle
      return;
    }

    const now = performance.now();
    if (now - nextTickAt > MAX_CATCHUP_MS) nextTickAt = now; // stall guard
    while (now >= nextTickAt) {
      inbox.push({ command: { type: "tick", dt: DT, worldState: Array.from(neighbors.values()), now: Date.now() } });
      nextTickAt += DT * 1000;
    }
  }, 1000 / RUNTIME_CONFIG.simHz);

  consume();
}

const nodeId = NodeIdSchema.parse(Number(process.argv[2]));
startServer(nodeId);
