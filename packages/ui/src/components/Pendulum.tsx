import { bobRadius, type PendulumConfig } from "@pendulum/shared/src/types";
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

/** Renders a single pendulum from its config, in world (meter) coordinates. */
export function Pendulum({ config, color }: { config: PendulumConfig; color: string }) {
  const { anchorX, bobX, bobY, r } = pendulumGeometry(config);

  return (
    <g>
      {/* String */}
      <line
        x1={anchorX}
        y1={0}
        x2={bobX}
        y2={bobY}
        stroke={mocha.subtext0}
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
      {/* Anchor point on the beam */}
      <circle cx={anchorX} cy={0} r={r * 0.15} fill={mocha.overlay2} />
      {/* Bob (radius is physical, in meters, so it scales with zoom) */}
      <circle
        cx={bobX}
        cy={bobY}
        r={r}
        fill={color}
        stroke={mocha.crust}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
