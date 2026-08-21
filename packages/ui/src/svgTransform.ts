import type { PendulumConfig } from "@pendulum/shared";

// px-per-meter. Cosmetic scale so hand-authored sizes (stroke-width, bob
// radius) read as small integers instead of fractions of a meter. It's folded
// into `toView`, so it's the *only* place the scale lives.
export const PX_PER_M = 100;

// Padding around the fitted world, in meters.
const PAD_M = 0.3;

// Headroom above the beam, in meters. Small: pendulums hang *below* the beam,
// so we only need enough room for the beam stroke and slight above-beam swing.
// Keeping this small is what pushes the beam toward the top of the frame.
const TOP_HEADROOM_M = 0.15;

export interface Point {
  x: number;
  y: number;
}

/**
 * The one and only conversion: world (meters, +y up) -> view (SVG units, +y
 * down). The physics puts the bob at negative y as it hangs; negating that
 * gives SVG's y-down convention. Everything drawn goes through this function.
 */
export function toView(p: Point): Point {
  return { x: p.x * PX_PER_M, y: -p.y * PX_PER_M };
}

/**
 * A viewBox string ("minX minY w h") that frames every pendulum's full reach
 * plus a margin.
 *
 * Derived from *static config* (anchors + lengths), never from live bob
 * positions — otherwise the frame would jiggle as the pendulums swing. Recompute
 * only when the topology/config changes.
 */
export function computeViewBox(configs: PendulumConfig[]): string {
  if (configs.length === 0) return "0 0 100 100";

  const maxL = Math.max(...configs.map((c) => c.length));
  const xs = configs.map((c) => c.anchor.x);

  // World bounds (meters, +y up).
  const xMin = Math.min(...xs) - maxL - PAD_M;
  const xMax = Math.max(...xs) + maxL + PAD_M;
  const yTop = TOP_HEADROOM_M; // beam sits near the top; little room needed above it
  const yBottom = -maxL - PAD_M; // lowest rest point (bob at y = -L)

  // Run the corners through the same transform we draw with.
  const topLeft = toView({ x: xMin, y: yTop });
  const bottomRight = toView({ x: xMax, y: yBottom });
  return `${topLeft.x} ${topLeft.y} ${bottomRight.x - topLeft.x} ${bottomRight.y - topLeft.y}`;
}
