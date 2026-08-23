import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev the UI is served by Vite, not the gateway, so proxy /api (HTTP + WS)
    // through to the gateway. In prod the gateway serves the built UI and these
    // relative paths hit it directly.
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${RUNTIME_CONFIG.gatewayPort}`,
        ws: true,
      },
    },
  },
});
