import { serve } from "@hono/node-server";
import { RUNTIME_CONFIG } from "@pendulum/shared";
import { Hono } from "hono";
import { addControlPlaneRoutes } from "./controlPlane";
import { executeEffects } from "./execEffects";
import { connectToGateway } from "./gatewayWsConn";
import { type Envelope, mailbox } from "./mailbox";
import { createSim, currentLocation, type Sim, toBobPositions, transition } from "./simulation";

const app = new Hono();

// each physics `step` advances this amount of time (DELTA T)
const DT = 1 / RUNTIME_CONFIG.simHz;

const MAX_CATCHUP_MS = 250; // after a stall, drop the backlog instead of flooding the inbox

async function startServer(nodeId: number) {
  const listingPort = RUNTIME_CONFIG.simStartPort + nodeId;
  console.log(`Listing on 127.0.0.1:${listingPort}`);

  const inbox = mailbox<Envelope>();

  addControlPlaneRoutes(app, inbox);
  serve({ fetch: app.fetch, hostname: "127.0.0.1", port: listingPort });

  const { neighbors, sendWsMessage } = connectToGateway(nodeId, inbox);

  let sim: Sim | undefined; // undefined until configured (via HTTP /start, a later step)

  // the only writer of `sim` during operation
  const consume = async () => {
    let ticks = 0; // TEMP: for the throttled log below
    while (true) {
      const { command, reply } = await inbox.recv();

      console.log(command);
      if (!sim) {
        // no sim yet, ignore all messages, and keep the mailbox empty
        continue;
      }

      // transition the state machine 1 step
      const out = transition(sim, command);

      if (out.result === "ok") {
        // next time we call transition, we will use an updated sim
        sim = out.sim;
        // execute side-effects of the state machine
        executeEffects(out.effects, sendWsMessage);
      }
      reply?.(out);

      // TEMP: prove the loop is advancing physics. Remove when snapshots exist.
      if (command.type === "tick" && ++ticks % 20 === 0) {
        console.log(`[node ${nodeId}] angle=${sim.pendulumState.angle.toFixed(3)}`);
      }

      // send location
      sendWsMessage({
        type: "PendulumLocationUpdate",
        data: {
          nodeId,
          ...currentLocation(sim),
        },
      });
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
      inbox.push({ command: { type: "tick", dt: DT, worldState: toBobPositions(neighbors) } });
      nextTickAt += DT * 1000;
    }
  }, 1000 / RUNTIME_CONFIG.simHz);

  // TEMP: seed + start a sim so the loop has something to advance.
  // Replaced by POST /start (which supplies the config) in the HTTP step.
  const seed =
    nodeId === 1
      ? { angle: 1.0, mass: 1, length: 1, anchor: { x: 0.4 } } // collides with node 0 @ ~3.5s
      : { angle: 0.4, mass: 1, length: 1, anchor: { x: nodeId } }; // regular spawn, spaced by id
  sim = createSim(nodeId, seed);

  inbox.push({ command: { type: "start" } });

  consume();
}

const nodeId = Number(process.argv[2]);
if (Number.isNaN(nodeId)) {
  throw new Error(`expected number as the nodeId, got: ${process.argv[2]}`);
}
startServer(nodeId);
