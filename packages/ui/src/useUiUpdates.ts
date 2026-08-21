import { RUNTIME_CONFIG } from "@pendulum/shared";
import { useEffect, useState } from "react";

type Location = { x: number; y: number; anchorX: number };
type Locations = Record<number, Location>;

export function useUiUpdates(): Locations {
  const [locations, setLocations] = useState<Locations>({});

  useEffect(() => {
    // gateway serves the ws
    const url = `ws://127.0.0.1:${RUNTIME_CONFIG.gatewayPort}/api/ui_updates`;
    const ws = new WebSocket(url);
    ws.addEventListener("message", (evt) => setLocations(JSON.parse(evt.data)));
    return () => ws.close();
  }, []);

  return locations;
}