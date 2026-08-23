import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";
import { bobRadius, type PendulumConfig, type PendulumLocation } from "@pendulum/shared/src/types";
import { mocha } from "../theme";

export interface PendulumGeometry {
  anchorX: number;
  bobX: number;
  bobY: number;
  r: number;
}

/** A pendulum with its stable node id and current config. */
export interface PendulumInstance {
  nodeId: number;
  config: PendulumConfig;
}

/**
 * Resolve a config into world-space geometry (meters). Shared by rendering and
 * by the camera's fit-to-content logic so they always agree.
 * Angle is measured from vertical (0 = hanging straight down); SVG's +y points
 * down, matching a hanging bob, and the anchor sits on the beam at (anchorX, 0).
 */
export function pendulumGeometry(config: PendulumConfig): PendulumGeometry {
  const { anchorX, length, angle, mass } = config;
  return {
    anchorX,
    bobX: anchorX + length * Math.sin(angle),
    bobY: length * Math.cos(angle),
    r: bobRadius(mass),
  };
}

/**
 * Resolve a live location update from the sim into the same world-space geometry.
 * When a node is running, the sim reports the bob's actual swinging position, so
 * we render from this instead of re-deriving from the (drop-time) config angle.
 */
export function locationGeometry(loc: PendulumLocation): PendulumGeometry {
  // The sim reports the bob in a y-up frame (below the beam = negative y); the
  // canvas is SVG y-down (below the beam = positive y), so flip y to match.
  return { anchorX: loc.anchorX, bobX: loc.posistion.x, bobY: -loc.posistion.y, r: loc.bobRadius };
}

/**
 * Renders a single pendulum from precomputed geometry, in world (meter) coordinates.
 * When `ghost` is set it renders as a faint hollow outline — used to show the
 * drop (launch) angle while the solid bob swings live.
 */
export function Pendulum({
  geometry,
  color,
  ghost = false,
  countdownMs,
}: {
  geometry: PendulumGeometry;
  color: string;
  ghost?: boolean;
  // ms until this bob auto-restarts after a collision; when > 0, draw a countdown on it.
  countdownMs?: number;
}) {
  const { anchorX, bobX, bobY, r } = geometry;

  return (
    <g opacity={ghost ? 0.4 : 1}>
      {/* String — dashed for the ghost so it reads as a target, not a real string */}
      <line
        x1={anchorX}
        y1={0}
        x2={bobX}
        y2={bobY}
        stroke={mocha.subtext0}
        strokeWidth={ghost ? 2 : 3}
        strokeDasharray={ghost ? "6 4" : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {/* Anchor point on the beam */}
      <circle cx={anchorX} cy={0} r={r * 0.15} fill={mocha.overlay2} />
      {/* Bob (radius is physical, in meters, so it scales with zoom).
          Ghost is a hollow ring; the live bob is solid. */}
      <circle
        cx={bobX}
        cy={bobY}
        r={r}
        fill={ghost ? "none" : color}
        stroke={ghost ? color : mocha.crust}
        strokeWidth={ghost ? 2 : 1}
        vectorEffect="non-scaling-stroke"
      />
      {/* Restart countdown: a red depleting ring + seconds left, shown only while a
          restart is actually counting down. */}
      {!ghost && countdownMs !== undefined && countdownMs > 0 && (
        <CollisionCountdown cx={bobX} cy={bobY} r={r} ms={countdownMs} />
      )}
      {/* Ghost label: mark this as the drop-off (launch) angle. Sized in world
          units relative to the bob so it scales with the ring. */}
      {ghost && (
        <text
          x={bobX}
          y={bobY}
          textAnchor="middle"
          fontSize={r * 0.42}
          fill={color}
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          <tspan x={bobX} dy="-0.15em">
            drop-off
          </tspan>
          <tspan x={bobX} dy="1.05em">
            angle
          </tspan>
        </text>
      )}
    </g>
  );
}

const RESTART_MS = RUNTIME_CONFIG.restartSec * 1000;

/**
 * A depleting ring drawn around a bob plus the seconds remaining until restart, shown
 * while a restart is counting down. Sized in world (meter) units so it scales with the
 * bob and zoom.
 */
function CollisionCountdown({ cx, cy, r, ms }: { cx: number; cy: number; r: number; ms: number }) {
  const ringR = r * 1.3;
  const circ = 2 * Math.PI * ringR;
  const frac = Math.max(0, Math.min(1, ms / RESTART_MS)); // 1 at impact → 0 at restart
  const stroke = r * 0.14;

  return (
    <g style={{ pointerEvents: "none", userSelect: "none" }}>
      {/* Faint full ring as the track */}
      <circle cx={cx} cy={cy} r={ringR} fill="none" stroke={mocha.surface1} strokeWidth={stroke} />
      {/* Remaining arc, starting from the top (rotate -90°) and shrinking clockwise */}
      <circle
        cx={cx}
        cy={cy}
        r={ringR}
        fill="none"
        stroke={mocha.red}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circ * frac} ${circ}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {/* Seconds remaining, centered on the bob */}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={r * 0.9}
        fontWeight={700}
        fill={mocha.text}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {(ms / 1000).toFixed(1)}
      </text>
    </g>
  );
}
