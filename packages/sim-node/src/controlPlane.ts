import type { PendulumConfig } from "@pendulum/shared";
import type { Context, Hono } from "hono";
import type { Envelope, Mailbox } from "./mailbox";
import { type Command, type Outcome, snapshot } from "./simulation";

export function addControlPlaneRoutes(app: Hono, inbox: Mailbox<Envelope>) {
  const submit = (command: Command): Promise<Outcome> => new Promise((reply) => inbox.push({ command, reply }));

  // submit a command and answer with a snapshot, or 409 if the state machine rejected it
  const run = async (c: Context, command: Command) => {
    const out = await submit(command);
    return out.result === "rejected" ? c.json({ error: out.rejection }, 409) : c.json(snapshot(out.sim));
  };

  app.post("/start", (c) => run(c, { type: "start" }));
  app.post("/pause", (c) => run(c, { type: "pause" }));
  app.post("/resume", (c) => run(c, { type: "resume" }));
  app.post("/stop", (c) => run(c, { type: "stop" }));

  // both carry a body: /configure takes a PendulumConfig, /wind takes { wind }
  app.post("/configure", async (c) => run(c, { type: "configure", config: await c.req.json<PendulumConfig>() }));
  app.post("/wind", async (c) => run(c, { type: "setWind", wind: (await c.req.json<{ wind: number }>()).wind }));

  // small hack, but easy way to get the snapshot here without declaring routes in the main.ts file
  app.get("/snapshot", (c) => run(c, { type: "snapshot" }));
}
