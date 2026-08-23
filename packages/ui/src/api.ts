import {
  type PendulumConfigPatch,
  type PendulumLocation,
  PendulumLocationSchema,
  type SimSnapshot,
  SimSnapshotSchema,
} from "@pendulum/shared/src/types";

// How long to wait before reconnecting the UI-updates socket after it drops.
const RECONNECT_MS = 1000;

/**
 * Fetch a single node's snapshot through the gateway's per-node proxy
 * (`/api/nodes/:id/snapshot` -> sim-node's `/snapshot` shim). Returns null if the
 * node is unreachable or the payload doesn't parse, so the caller can fall back to
 * its default config for that node instead of blowing up the whole page load.
 */
export async function fetchSnapshot(nodeId: number): Promise<SimSnapshot | null> {
  try {
    const res = await fetch(`/api/nodes/${nodeId}/snapshot`);
    if (!res.ok) return null;
    const parsed = SimSnapshotSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Shape of the gateway's fan-out response: one entry per node, keyed by nodeId.
type BroadcastResult = Record<string, { status: number; responseBody: unknown }>;

/**
 * Fetch every node's snapshot in a single request via the gateway's broadcast
 * fan-out (`/api/broadcast/snapshot`), instead of one call per node. Returns a
 * map keyed by nodeId; nodes that were unreachable or returned an unparseable
 * body are simply omitted, so the caller keeps its defaults for those.
 */
export async function fetchAllSnapshots(): Promise<Map<number, SimSnapshot>> {
  const byNode = new Map<number, SimSnapshot>();
  try {
    const res = await fetch("/api/broadcast/snapshot");
    if (!res.ok) return byNode;
    const results = (await res.json()) as BroadcastResult;
    for (const [id, result] of Object.entries(results)) {
      const parsed = SimSnapshotSchema.safeParse(result?.responseBody);
      if (parsed.success) byNode.set(Number(id), parsed.data);
    }
  } catch {
    // network/parse failure — return whatever we managed to collect (possibly empty)
  }
  return byNode;
}

/**
 * Push a config patch to a single node through the gateway proxy
 * (`/api/nodes/:id/configure` -> sim-node's `/configure`). The sim accepts a
 * partial patch, so callers can send only the fields that changed. Returns the
 * resulting snapshot, or null if the node was unreachable, rejected the command
 * (409), refused the patch (400), or answered with an unparseable body.
 */
export async function configureNode(nodeId: number, patch: PendulumConfigPatch): Promise<SimSnapshot | null> {
  try {
    const res = await fetch(`/api/nodes/${nodeId}/configure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const parsed = SimSnapshotSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * A single frame from the gateway's live feed: where every bob is, plus the pending
 * auto-restart deadline (epoch ms) for any bob currently collided.
 */
export interface FeedFrame {
  locations: Map<number, PendulumLocation>;
  // nodeId -> wall-clock ms at which the collided node auto-restarts; the UI counts down to it.
  restarts: Map<number, number>;
}

/**
 * Subscribe to the gateway's live feed (`/api/ui_updates`). The gateway pushes a
 * `{ locations, restarts }` frame whenever the world changes; each frame we parse it
 * into `Map`s (dropping any entries that don't validate) and hand it to `onUpdate`.
 * The socket auto-reconnects if the gateway bounces. Returns an unsubscribe function
 * that stops reconnecting and closes the socket.
 */
export function subscribeLocations(onUpdate: (frame: FeedFrame) => void): () => void {
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnect: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${proto}//${window.location.host}/api/ui_updates`);

    socket.onmessage = (evt) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(evt.data));
      } catch {
        return;
      }
      if (typeof raw !== "object" || raw === null || !("locations" in raw)) return;
      const { locations: rawLocations, restarts: rawRestarts } = raw as {
        locations: unknown;
        restarts?: unknown;
      };

      const locations = new Map<number, PendulumLocation>();
      if (typeof rawLocations === "object" && rawLocations !== null) {
        for (const [id, loc] of Object.entries(rawLocations)) {
          const parsed = PendulumLocationSchema.safeParse(loc);
          if (parsed.success) locations.set(Number(id), parsed.data);
        }
      }

      const restarts = new Map<number, number>();
      if (typeof rawRestarts === "object" && rawRestarts !== null) {
        for (const [id, at] of Object.entries(rawRestarts)) {
          if (typeof at === "number") restarts.set(Number(id), at);
        }
      }

      onUpdate({ locations, restarts });
    };

    // The gateway (or a node) may bounce; keep retrying until we're unsubscribed.
    socket.onclose = () => {
      if (!closed) reconnect = setTimeout(connect, RECONNECT_MS);
    };
  };

  connect();

  return () => {
    closed = true;
    clearTimeout(reconnect);
    socket?.close();
  };
}

// Lifecycle actions the sim-node control plane exposes as bare POST routes.
type NodeAction = "start" | "stop" | "pause" | "resume";

/**
 * Send a lifecycle command to a single node through the gateway proxy
 * (`/api/nodes/:id/<action>` -> sim-node's `/<action>`). Returns the resulting
 * snapshot, or null if the node was unreachable, rejected the command (409), or
 * answered with an unparseable body.
 */
export async function controlNode(nodeId: number, action: NodeAction): Promise<SimSnapshot | null> {
  try {
    const res = await fetch(`/api/nodes/${nodeId}/${action}`, { method: "POST" });
    if (!res.ok) return null;
    const parsed = SimSnapshotSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Broadcast a lifecycle command to every node in one request
 * (`/api/broadcast/<action>`). Best-effort: we don't inspect the per-node results,
 * a dropped request just means the user can click again.
 */
export async function controlAll(action: NodeAction): Promise<void> {
  try {
    await fetch(`/api/broadcast/${action}`, { method: "POST" });
  } catch {
    // best-effort
  }
}

/**
 * Ask the gateway to randomize every node's config (`/api/randomize`), which fans
 * a random `configure` out to all nodes. Best-effort; callers should re-fetch
 * snapshots afterwards to pick up the new configs.
 */
export async function randomizeAll(): Promise<void> {
  try {
    await fetch("/api/randomize", { method: "POST" });
  } catch {
    // best-effort
  }
}
