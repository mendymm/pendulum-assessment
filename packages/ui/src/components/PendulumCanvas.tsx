import type { PendulumConfig } from "@pendulum/shared";
import { useState } from "react";

const WIDTH = 900;
const BEAM_Y = 70;
const BEAM_PAD = 80;
const FIT_MARGIN = 40;

// The zoom slider runs 0..100 and defaults to the midpoint, where everything
// fits (zoom = 1). Each end reaches ZOOM_RANGE× in or out on a log scale.
const DEFAULT_ZOOM_PCT = 50;
const ZOOM_RANGE = 5;
const pctToZoom = (pct: number) => ZOOM_RANGE ** ((pct - DEFAULT_ZOOM_PCT) / DEFAULT_ZOOM_PCT);

export interface PendulumView {
  id: number;
  config: PendulumConfig;
  // Current swing angle in radians, measured from straight down.
  angle: number;
}

// config.anchor.x is a 0..1 fraction of the beam span.
const anchorX = (fraction: number) => BEAM_PAD + (WIDTH - 2 * BEAM_PAD) * fraction;
// Bob radius grows gently with mass so heavier pendulums read as larger.
const bobRadius = (mass: number) => 8 + Math.sqrt(mass) * 4;

/**
 * viewBox string that, at zoom=1, frames every pendulum's full swing (based on
 * amplitude, so the frame stays stable while animating), the beam, and a margin.
 * Higher zoom shrinks that box around its center.
 */
function fitViewBox(ps: PendulumView[], zoom: number): string {
  const reach = (c: PendulumConfig) =>
    c.length * Math.sin(Math.min(Math.abs(c.initialAngle), Math.PI / 2)) + bobRadius(c.mass);
  const xs = ps.flatMap(({ config }) => {
    const ax = anchorX(config.anchor.x);
    return [ax - reach(config), ax + reach(config)];
  });
  const minX = Math.min(BEAM_PAD, ...xs) - FIT_MARGIN;
  const maxX = Math.max(WIDTH - BEAM_PAD, ...xs) + FIT_MARGIN;
  const minY = BEAM_Y - FIT_MARGIN;
  const maxY = Math.max(...ps.map((p) => BEAM_Y + p.config.length + bobRadius(p.config.mass))) + FIT_MARGIN;

  const w = (maxX - minX) / zoom;
  const h = (maxY - minY) / zoom;
  const x = minX + (maxX - minX - w) / 2;
  const y = minY + (maxY - minY - h) / 2;
  return `${x} ${y} ${w} ${h}`;
}

export function PendulumCanvas({ pendulums }: { pendulums: PendulumView[] }) {
  const [zoomPct, setZoomPct] = useState(DEFAULT_ZOOM_PCT);

  return (
    <>
      <svg
        className="canvas"
        viewBox={fitViewBox(pendulums, pctToZoom(zoomPct))}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Pendulum simulation"
      >
        <line className="beam" x1={BEAM_PAD - 20} y1={BEAM_Y} x2={WIDTH - BEAM_PAD + 20} y2={BEAM_Y} />
        {pendulums.map(({ id, config, angle }) => {
          const ax = anchorX(config.anchor.x);
          const bx = ax + config.length * Math.sin(angle);
          const by = BEAM_Y + config.length * Math.cos(angle);
          return (
            <g key={id}>
              <line className="string" x1={ax} y1={BEAM_Y} x2={bx} y2={by} />
              <circle className="bob" cx={bx} cy={by} r={bobRadius(config.mass)} />
            </g>
          );
        })}
      </svg>

      <input
        className="zoom"
        type="range"
        min={0}
        max={100}
        step={1}
        value={zoomPct}
        onChange={(e) => setZoomPct(Number(e.target.value))}
        aria-label="Zoom level"
      />
    </>
  );
}
