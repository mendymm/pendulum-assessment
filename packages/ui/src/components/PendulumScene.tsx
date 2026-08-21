import type { PendulumConfig } from "@pendulum/shared";
import { type Point, PX_PER_M, toView } from "../svgTransform";
import type { Location } from "../useUiUpdates";

// Constant bob radius (in meters). Mass is communicated by color, not size —
// see NOTES.md.
const BOB_R = 0.09 * PX_PER_M;

/**
 * Map mass -> color. Light bobs are blue, heavy bobs shift toward red, over an
 * expected 1..10 kg range. Radius stays fixed so mass reads purely as color.
 */
function massColor(mass: number): string {
  const t = Math.min(Math.max((mass - 1) / 9, 0), 1);
  const hue = 210 - 210 * t; // 210 (blue) -> 0 (red)
  return `hsl(${hue}, 70%, 55%)`;
}

// Rest position of the bob from config alone, in world meters (+y up). Used
// before any live position has arrived for this pendulum.
function restBob(c: PendulumConfig): Point {
  return {
    x: c.anchor.x + c.length * Math.sin(c.angle),
    y: -c.length * Math.cos(c.angle),
  };
}

export function PendulumScene({
  configs,
  locations,
  viewBox,
}: {
  configs: PendulumConfig[];
  locations: Record<number, Location>;
  viewBox: string;
}) {
  // Beam spans the anchors (world y = 0), with a little overhang each side.
  const anchorXs = configs.map((c) => c.anchor.x);
  const beamLeft = toView({ x: Math.min(...anchorXs) - 0.2, y: 0 });
  const beamRight = toView({ x: Math.max(...anchorXs) + 0.2, y: 0 });

  return (
    <svg
      className="scene"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMin meet"
      role="img"
      aria-label="Pendulum simulation"
    >
      <line className="beam" x1={beamLeft.x} y1={beamLeft.y} x2={beamRight.x} y2={beamRight.y} />

      {configs.map((config, id) => {
        const loc = locations[id];
        // Anchor in world space; prefer the live anchorX if we have it.
        const anchor = toView({ x: loc?.anchorX ?? config.anchor.x, y: 0 });
        // Bob: live position if streamed, otherwise the config rest position.
        const bob = toView(loc ? { x: loc.x, y: loc.y } : restBob(config));

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the index IS the node id — stable, never reorders
          <g key={id}>
            <line className="string" x1={anchor.x} y1={anchor.y} x2={bob.x} y2={bob.y} />
            <circle className="pivot" cx={anchor.x} cy={anchor.y} r={3} />
            <circle className="bob" cx={bob.x} cy={bob.y} r={BOB_R} fill={massColor(config.mass)} />
          </g>
        );
      })}
    </svg>
  );
}
