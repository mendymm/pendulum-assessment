import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RUNTIME_CONFIG } from "@pendulum/shared";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { pendulumLocations, simWsHandler } from "./wsHandler";

const app = new Hono();

app.get("/api/ws", simWsHandler);

app.get(
  "/api/ui_updates",
  upgradeWebSocket(() => {
    let timer: ReturnType<typeof setInterval>;

    return {
      onOpen: (_evt, ws) => {
        timer = setInterval(() => {
          ws.send(JSON.stringify(Object.fromEntries(pendulumLocations)));
        }, 1000 / RUNTIME_CONFIG.uiUpdateHz);
      },
      onClose: () => clearInterval(timer),
    };
  }),
);

app.get("/api/health", (c) => c.text("OK"));
app.get("/api/runtime_config", (c) => c.json(RUNTIME_CONFIG));
app.get("/api/pendulum_locations", (c) => c.json([...pendulumLocations].map(([nodeId, loc]) => ({ nodeId, ...loc }))));

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui", "dist");
app.use("/*", serveStatic({ root: UI_ROOT }));
app.get("/*", serveStatic({ path: join(UI_ROOT, "index.html") }));

console.log(`Listing on 127.0.0.1:${RUNTIME_CONFIG.gatewayPort}`);

serve({
  fetch: app.fetch,
  port: RUNTIME_CONFIG.gatewayPort,
  websocket: { server: new WebSocketServer({ noServer: true }) },
});
