import { type PendulumConfig, PendulumConfigSchema } from "@pendulum/shared/src/types";
import { useEffect, useRef, useState } from "react";
import { bobColor, mocha } from "../theme";

/** Marks a trigger (gear handle / nodeId chip) so an outside-click doesn't fight its own toggle. */
export const CONFIG_TRIGGER_ATTR = "data-config-trigger";

const WIDTH_PX = 180;

/**
 * A popover panel for configuring a single pendulum. Opens beneath the clicked
 * nodeId chip (positioned via `position`). Editable fields commit to the config
 * as soon as they parse against the shared schema; invalid/partial input is kept
 * locally so you can keep typing, but not committed.
 */
export function ConfigBox({
  nodeId,
  config,
  position,
  placement,
  onChange,
  onClose,
}: {
  nodeId: number;
  config: PendulumConfig;
  position: { left: number; top: number };
  placement: "above" | "below";
  onChange: (config: PendulumConfig) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [length, setLength] = useState(String(config.length));
  const [mass, setMass] = useState(String(config.mass));
  const [wind, setWind] = useState(String(config.wind));
  const [gravity, setGravity] = useState(String(config.gravity));

  // Close when clicking anywhere outside the box (but not on a trigger, which
  // manages its own open/close toggle).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (boxRef.current?.contains(target)) return;
      if (target.closest?.(`[${CONFIG_TRIGGER_ATTR}]`)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  // Try to commit a single field; ignore values that don't parse against the schema.
  const commit = (key: "length" | "mass" | "wind" | "gravity", raw: string) => {
    if (raw.trim() === "") return;
    const value = Number(raw);
    if (Number.isNaN(value)) return;
    const parsed = PendulumConfigSchema.safeParse({ ...config, [key]: value });
    if (parsed.success) onChange(parsed.data);
  };

  return (
    <div
      ref={boxRef}
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
        // Grow upward from the anchor when placed above, downward when below.
        transform: placement === "above" ? "translateY(calc(-100% - 8px))" : "translateY(8px)",
        width: WIDTH_PX,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: 6,
        background: mocha.mantle,
        border: `1px solid ${mocha.surface1}`,
        borderRadius: 6,
        font: "11px/1.2 system-ui, sans-serif",
        color: mocha.text,
        boxShadow: `0 8px 24px ${mocha.crust}`,
        zIndex: 10,
      }}
    >
      {/* Header — includes the two canvas-only (read-only) fields */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: bobColor(nodeId) }} />
        <strong>Node {nodeId}</strong>
        <span style={{ fontSize: 10, color: mocha.subtext0, whiteSpace: "nowrap" }}>x {config.anchorX.toFixed(2)}</span>
        <span style={{ fontSize: 10, color: mocha.subtext0, whiteSpace: "nowrap" }}>
          ∠ {Math.round((config.angle * 180) / Math.PI)}°
        </span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ ...closeStyle, marginLeft: "auto" }}>
          ×
        </button>
      </div>

      {/* Editable inputs */}
      <div style={{ display: "flex", gap: 6 }}>
        <NumberField
          label="length"
          value={length}
          onChange={(v) => {
            setLength(v);
            commit("length", v);
          }}
        />
        <NumberField
          label="mass"
          value={mass}
          onChange={(v) => {
            setMass(v);
            commit("mass", v);
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <NumberField
          label="wind"
          value={wind}
          onChange={(v) => {
            setWind(v);
            commit("wind", v);
          }}
        />
        <NumberField
          label="gravity"
          value={gravity}
          onChange={(v) => {
            setGravity(v);
            commit("gravity", v);
          }}
        />
      </div>

      {/* Controls (placeholders, not wired to the gateway yet) */}
      <div style={{ display: "flex", gap: 4 }}>
        <button type="button" onClick={() => setPaused((p) => !p)} style={btnStyle}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" style={btnStyle}>
          Start
        </button>
        <button type="button" style={btnStyle}>
          Stop
        </button>
        <button type="button" style={btnStyle}>
          Rnd
        </button>
      </div>
    </div>
  );
}

const closeStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  lineHeight: 1,
  padding: 0,
  background: "transparent",
  color: mocha.subtext0,
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 16,
};

const btnStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 2px",
  background: mocha.surface0,
  color: mocha.text,
  border: `1px solid ${mocha.surface2}`,
  borderRadius: 4,
  cursor: "pointer",
  font: "10px/1 system-ui, sans-serif",
  whiteSpace: "nowrap",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: mocha.subtext0,
  display: "block",
  marginBottom: 2,
};

/** A label + editable number input. */
function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ flex: 1, minWidth: 0 }}>
      <span style={labelStyle}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "4px",
          background: mocha.base,
          color: mocha.text,
          border: `1px solid ${mocha.surface2}`,
          borderRadius: 4,
          font: "inherit",
        }}
      />
    </label>
  );
}

