import type { Context, Hono } from "hono";
import {RUNTIME_CONFIG} from "@pendulum/shared/src/config"
import {NodeId, randomPendulumConfig} from "@pendulum/shared/src/types"

const nodeBase = (nodeId: number) => `http://127.0.0.1:${RUNTIME_CONFIG.simStartPort + nodeId}`;

type NodeRequestResult = {
  status: number;
  responseBody: unknown | null;
};

type BroadcastResult = Record<NodeId, NodeRequestResult>;

async function readBody(res: Response): Promise<unknown | null> {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// broadcast a request to every node concurrently and collect the per-node results
async function broadcast(path: string, initFor: (nodeId: number) => RequestInit): Promise<BroadcastResult> {
  const calls = Array.from({ length: RUNTIME_CONFIG.simCount }, (_, nodeId) =>
    fetch(`${nodeBase(nodeId)}${path}`, initFor(nodeId))
      .then(async (res): Promise<NodeRequestResult> => ({ status: res.status, responseBody: await readBody(res) }))
      .catch((): NodeRequestResult => ({ status: 502, responseBody: null })),
  );
  const results = await Promise.all(calls);
  return Object.fromEntries(results.map((r, nodeId) => [nodeId, r])) as BroadcastResult;
}


// proxy the incoming request through to a single node's control plane
async function proxyToNode(c: Context): Promise<Response> {
  const raw = c.req.param("nodeId");
  const nodeId = Number(raw);
  if (!Number.isInteger(nodeId) || nodeId < 0 || nodeId >= RUNTIME_CONFIG.simCount) {
    return c.json({ error: `invalid nodeId: ${raw}` }, 400);
  }

  const route = c.req.param("route"); // everything after /api/nodes/:nodeId/
  const method = c.req.method;
  const init: RequestInit = { method };
  // GET/HEAD carry no body; everything else forwards the raw body + content-type.
  if (method !== "GET" && method !== "HEAD") {
    init.body = await c.req.text();
    init.headers = { "content-type": c.req.header("content-type") ?? "application/json" };
  }

  try {
    const res = await fetch(`${nodeBase(nodeId)}/${route}`, init);
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch (err) {
    return c.json({ error: `node ${nodeId} unreachable`, detail: String(err) }, 502);
  }
}
const BROADCAST_ROUTES = [
  { name: "start", method: "POST" },
  { name: "stop", method: "POST" },
  { name: "pause", method: "POST" },
  { name: "resume", method: "POST" },
  { name: "snapshot", method: "GET" },
] as const;

export function addControlRoutes(app: Hono) {
  // `/api/broadcast/<name>` fans the action out to every node
  for (const { name, method } of BROADCAST_ROUTES) {
    app.on(method, `/api/broadcast/${name}`, async (c) => c.json(await broadcast(`/${name}`, () => ({ method }))));
  }

  // per-node proxy: `/api/nodes/:nodeId/<route> forwards`
  app.on(["GET", "POST", "PATCH"], "/api/nodes/:nodeId/:route{.+}", proxyToNode);

  // todo: maybe get rid of this? and just have this in the UI?
  app.post("/api/randomize", async (c) => {
    const results = await broadcast("/configure", () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(randomPendulumConfig()),
    }));
    return c.json(results);
  });
}
