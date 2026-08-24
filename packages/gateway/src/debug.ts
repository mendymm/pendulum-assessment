import { wsRecvCounts, wsSentCounts } from "./wsHandler";

// Mirror of the sim-node debug output: when DEBUG is set, print the gateway's ws
// traffic tallies on an interval. The gateway has no command loop to hook into, so a
// timer is the natural "loop" here.
export function startGatewayDebugLoop(everyMs = 1000) {
  if (process.env.DEBUG === undefined) return;
  setInterval(() => console.log(formatGatewayState()), everyMs);
}

// one-line summary of a ws tally, keyed by message type (skips types not yet seen).
function formatCounts(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${type} ${n}`);
  return parts.length ? parts.join(" · ") : "none";
}

function formatGatewayState(): string {
  return [
    "gateway ws traffic",
    `  ↓ recv · ${formatCounts(wsRecvCounts)}`,
    `  ↑ sent · ${formatCounts(wsSentCounts)}`,
  ].join("\n");
}
