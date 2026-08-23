import { type PendulumConfig, PendulumConfigSchema } from "@pendulum/shared/src/types";
import { useState } from "react";
import { bobColor, mocha } from "../theme";

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
  onChange,
  onClose,
}: {
  nodeId: number;
  config: PendulumConfig;
  position: { left: number; top: number };
  onChange: (config: PendulumConfig) => void;
  onClose: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const [length, setLength] = useState(String(config.length));
  const [mass, setMass] = useState(String(config.mass));
  const [wind, setWind] = useState(String(config.wind));
  const [gravity, setGravity] = useState(String(config.gravity));

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
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
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
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: bobColor(nodeId) }} />
        <strong style={{ flex: 1 }}>Node {nodeId}</strong>
        <button type="button" onClick={onClose} aria-label="Close" style={closeStyle}>
          ×
        </button>
      </div>

      {/* Read-only info */}
      <div style={{ display: "flex", gap: 6 }}>
        <InfoField label="anchorX" value={config.anchorX.toFixed(2)} />
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

/** A label + read-only, greyed-out informational box (not directly editable). */
function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <label style={{ flex: 1, minWidth: 0 }}>
      <span style={labelStyle}>{label}</span>
      <input
        type="text"
        value={value}
        readOnly
        tabIndex={-1}
        aria-disabled
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "4px",
          background: mocha.surface0,
          color: mocha.overlay0,
          border: `1px solid ${mocha.surface1}`,
          borderRadius: 4,
          font: "inherit",
          cursor: "not-allowed",
        }}
      />
    </label>
  );
}
