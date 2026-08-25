import type { Command, SimSnapshot } from "@pendulum/shared/src/types";
import { wsEventCounts } from "./gatewayWsConn";
import { type Sim, snapshot } from "./simulation";

export function debugSimState(iterCount: number, sim: Sim, commandType: Command["type"]) {
  if (process.env.DEBUG === undefined) return;

  if (commandType !== "tick" || iterCount % 20 === 0) {
    console.log(formatSnapshot(snapshot(sim)));
  }
}

// one-line summary of WS events received so far, keyed by event type.
function formatWsEventCounts(): string {
  const parts = Object.entries(wsEventCounts).map(([type, count]) => `${type} ${count}`);
  return `  ws events · ${parts.join(" · ")}`;
}

// one-line summary of a command tally, keyed by command type (skips unseen types).
function formatCounts(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${type} ${n}`);
  return parts.length ? parts.join(" · ") : "none";
}

// vibe coded...

// A tiny gauge showing where the bob is relative to straight-down (`|`), clamped
// to ±90°. `o` is the bob; leans left/right with the angle.
function angleGauge(angle: number, width = 21): string {
  const half = Math.floor(width / 2);
  const clamped = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angle));
  const pos = half + Math.round((clamped / (Math.PI / 2)) * half);
  const cells: string[] = Array.from({ length: width }, (_, i) => (i === half ? "|" : "-"));
  cells[pos] = "o";
  return cells.join("");
}

// Compact multi-line dump of a snapshot for stdout debugging in the main loop.
export function formatSnapshot(snap: SimSnapshot): string {
  const { nodeId, status, config, posistion: pos, bobRadius, commandStats } = snap;
  const deg = ((config.angle * 180) / Math.PI).toFixed(0);
  return [
    `node ${nodeId} · ${status}`,
    `  angle ${config.angle.toFixed(2)}rad (${deg}°) [${angleGauge(config.angle)}]  anchorX ${config.anchorX.toFixed(2)}m`,
    `  bob (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})m  r ${bobRadius.toFixed(2)}m  len ${config.length}m  mass ${config.mass}kg  wind ${config.wind}N  g ${config.gravity}m/s²`,
    `  ✓ completed · ${formatCounts(commandStats.completed)}`,
    `  ✗ rejected · ${formatCounts(commandStats.rejected)}`,
    formatWsEventCounts(),
  ].join("\n");
}
