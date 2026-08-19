import { useState } from "react";
import type { PendulumConfig } from "@pendulum/shared";

// SVG world dimensions. The viewBox scales to the container.
const WIDTH = 900;
const HEIGHT = 520;
const BEAM_Y = 70;
const BEAM_PAD = 80;

// Zoom bounds. 1 = fit-to-view; higher = zoomed in.
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

export interface PendulumView {
  id: number;
  config: PendulumConfig;
  // Current swing angle in radians, measured from straight down.
  angle: number;
}

/** X coordinate of a pendulum's anchor. config.anchor.x is a 0..1 fraction of the beam span. */
function anchorX(fraction: number): number {
  return BEAM_PAD + (WIDTH - 2 * BEAM_PAD) * fraction;
}

/** Bob radius scales gently with mass so heavier pendulums read as larger. */
function bobRadius(mass: number): number {
  return 8 + Math.sqrt(mass) * 4;
}

interface Box {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

// World-unit padding around the fitted content at min zoom.
const FIT_MARGIN = 40;

/**
 * Bounding box that frames every pendulum's full swing (based on amplitude, so
 * the frame is stable across the animation) plus bob radius, the beam, and a
 * margin. This is the zoom=1 view — everything is guaranteed visible.
 */
function contentBounds(pendulums: PendulumView[]): Box {
  // Start from the beam extents so the frame always includes the beam.
  let minX = BEAM_PAD - 20;
  let maxX = WIDTH - BEAM_PAD + 20;
  let minY = BEAM_Y;
  let maxY = BEAM_Y;

  for (const { config } of pendulums) {
    const ax = anchorX(config.anchor.x);
    const r = bobRadius(config.mass);
    // Horizontal reach = swing amplitude; vertical reach bottoms out at angle 0.
    const amp = Math.min(Math.abs(config.initialAngle), Math.PI / 2);
    const reach = config.length * Math.sin(amp);

    minX = Math.min(minX, ax - reach - r);
    maxX = Math.max(maxX, ax + reach + r);
    minY = Math.min(minY, BEAM_Y - r);
    maxY = Math.max(maxY, BEAM_Y + config.length + r);
  }

  return {
    minX: minX - FIT_MARGIN,
    minY: minY - FIT_MARGIN,
    width: maxX - minX + 2 * FIT_MARGIN,
    height: maxY - minY + 2 * FIT_MARGIN,
  };
}

function Pendulum({ view }: { view: PendulumView }) {
  const { config, angle } = view;
  const ax = anchorX(config.anchor.x);
  const bx = ax + config.length * Math.sin(angle);
  const by = BEAM_Y + config.length * Math.cos(angle);
  const r = bobRadius(config.mass);

  return (
    <g>
      <line x1={ax} y1={BEAM_Y} x2={bx} y2={by} stroke="#94a3b8" strokeWidth={2} />
      <circle cx={bx} cy={by} r={r} fill="#3b82f6" stroke="#1e3a8a" strokeWidth={2} />
      <circle cx={ax} cy={BEAM_Y} r={4} fill="#475569" />
    </g>
  );
}

export function PendulumCanvas({ pendulums }: { pendulums: PendulumView[] }) {
  const [zoom, setZoom] = useState(MIN_ZOOM);

  // At zoom=1 the viewBox frames all content; higher zoom shrinks it around center.
  const base = contentBounds(pendulums);
  const vbW = base.width / zoom;
  const vbH = base.height / zoom;
  const minX = base.minX + (base.width - vbW) / 2;
  const minY = base.minY + (base.height - vbH) / 2;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg
        viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          background: "#1e1e2e",
        }}
        role="img"
        aria-label="Pendulum simulation"
      >
        {/* Beam */}
        <line
          x1={BEAM_PAD - 20}
          y1={BEAM_Y}
          x2={WIDTH - BEAM_PAD + 20}
          y2={BEAM_Y}
          stroke="#e2e8f0"
          strokeWidth={6}
          strokeLinecap="round"
        />
        {pendulums.map((p) => (
          <Pendulum key={p.id} view={p} />
        ))}
      </svg>

      <ZoomBar zoom={zoom} onChange={setZoom} />
    </div>
  );
}

function ZoomBar({ zoom, onChange }: { zoom: number; onChange: (z: number) => void }) {
  const step = (MAX_ZOOM - MIN_ZOOM) / 8;
  const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const btn: React.CSSProperties = {
    width: 28,
    height: 28,
    border: "none",
    borderRadius: 6,
    background: "rgba(226,232,240,0.12)",
    color: "#e2e8f0",
    fontSize: 18,
    lineHeight: 1,
    cursor: "pointer",
  };

  return (
    <div
      style={{
        position: "absolute",
        right: 20,
        bottom: 24,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: 8,
        borderRadius: 10,
        background: "rgba(30,30,46,0.7)",
        border: "1px solid rgba(226,232,240,0.15)",
        backdropFilter: "blur(4px)",
      }}
    >
      <button type="button" style={btn} onClick={() => onChange(clamp(zoom + step))} aria-label="Zoom in">
        +
      </button>
      <input
        type="range"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step={0.01}
        value={zoom}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Zoom level"
        style={{
          // Vertical, volume-style: high value at the top.
          writingMode: "vertical-lr",
          direction: "rtl",
          height: 120,
          accentColor: "#3b82f6",
          cursor: "pointer",
        }}
      />
      <button type="button" style={btn} onClick={() => onChange(clamp(zoom - step))} aria-label="Zoom out">
        −
      </button>
    </div>
  );
}
