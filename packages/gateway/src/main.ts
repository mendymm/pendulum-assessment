import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { addControlRoutes } from "./api";
import { lastWorldChangeAt, pendulumLocations, pendulumRestarts, simWsHandler } from "./wsHandler";

const app = new Hono();

app.get("/api/ws", simWsHandler);

// control-plane fan-out: POST /api/start|pause|resume|stop -> all nodes concurrently
addControlRoutes(app);

app.get(
  "/api/ui_updates",
  upgradeWebSocket(() => {
    let timer: ReturnType<typeof setInterval>;
    // wall-clock (ms) of the last frame we pushed to this UI client.
    let lastFrameSentAt = 0;

    // Serialize the current world into a feed frame — the same shape the interval pushes.
    const currentFrame = () =>
      JSON.stringify({
        locations: Object.fromEntries(pendulumLocations),
        restarts: Object.fromEntries(pendulumRestarts),
      });

    return {
      onOpen: (_evt, ws) => {
        // Push the current state immediately so a client connecting to a paused/idle
        // sim (where lastWorldChangeAt never advances) sees the world instead of a
        // blank canvas that looks like a dead connection.
        ws.send(currentFrame());
        lastFrameSentAt = Date.now();

        timer = setInterval(() => {
          // Only push when the world actually changed (a new location, or a collision
          // countdown appearing/clearing) since our last send. While the sim is paused
          // or every pendulum has collided, nothing changes, so we go quiet instead of
          // spamming the UI with the same frame at uiUpdateHz. The UI animates a pending
          // countdown itself from the restart deadline, so it stays live without us.
          if (lastWorldChangeAt <= lastFrameSentAt) return;
          ws.send(currentFrame());
          lastFrameSentAt = Date.now();
        }, 1000 / RUNTIME_CONFIG.uiUpdateHz);
      },
      onClose: () => clearInterval(timer),
    };
  }),
);

app.get("/api/health", (c) => c.text("OK"));
app.get("/api/runtime_config", (c) => c.json(RUNTIME_CONFIG));
app.get("/api/pendulum_locations", (c) => c.json([...pendulumLocations].values()));

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui", "dist");
app.use("/*", serveStatic({ root: UI_ROOT }));
app.get("/*", serveStatic({ path: join(UI_ROOT, "index.html") }));

console.log(`Listing on 127.0.0.1:${RUNTIME_CONFIG.gatewayPort}`);

serve({
  fetch: app.fetch,
  port: RUNTIME_CONFIG.gatewayPort,
  websocket: { server: new WebSocketServer({ noServer: true }) },
});
