import { PendulumConfigPatchSchema } from "@pendulum/shared/src/types";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Mailbox } from "./mailbox";
import { type Command, type Outcome, type Sim, snapshot } from "./simulation";

export function addControlPlaneRoutes(app: Hono, inbox: Mailbox, getSim: () => Sim) {
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

  app.post("/configure", async (c) => {
    const parsed = PendulumConfigPatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 400);
    return run(c, { type: "configure", config: parsed.data });
  });

  // small hack, but easy way to get the snapshot here without declaring routes in the main.ts file
  app.get("/snapshot", (c) => c.json(snapshot(getSim())));
}
