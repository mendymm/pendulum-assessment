import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RUNTIME_CONFIG } from "@pendulum/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

const app = new Hono();

app.get("/api/health", (c) => c.text("OK"));

let id = 0;

app.get("/api/sse", async (c) => {
  return streamSSE(c, async (stream) => {
    while (!stream.aborted) {
      const message = `It is ${new Date().toISOString()}`;
      await stream.writeSSE({
        data: message,
        event: "time-update",
        id: String(id++),
      });
      await stream.sleep(1000);
    }
  });
});

app.get("/api/runtime_config", (c) => c.json(RUNTIME_CONFIG));

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui", "dist");
app.use("/*", serveStatic({ root: UI_ROOT }));
app.get("/*", serveStatic({ path: join(UI_ROOT, "index.html") }));


console.log(`Listing on 127.0.0.1:${RUNTIME_CONFIG.gatewayPort}`);


serve({
  fetch: app.fetch,
  port: RUNTIME_CONFIG.gatewayPort,
});
