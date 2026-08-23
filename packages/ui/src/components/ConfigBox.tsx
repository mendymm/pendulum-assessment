import { type PendulumConfig, PendulumConfigSchema, randomPendulumConfig } from "@pendulum/shared/src/types";
import { useEffect, useRef, useState } from "react";
import { configureNode, controlNode, fetchSnapshot } from "../api";
import { bobColor, mocha } from "../theme";

// Wait this long after the last keystroke before pushing a field edit to the
// gateway, so typing "12.5" is one request rather than four.
const CONFIG_DEBOUNCE_MS = 300;

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

  // Sync all four input strings and the committed config from a fresh config
  // (used by refresh + randomize, which replace every field at once).
  const syncInputs = (c: PendulumConfig) => {
    setLength(String(c.length));
    setMass(String(c.mass));
    setWind(String(c.wind));
    setGravity(String(c.gravity));
    onChange(c);
  };

  // Re-pull this node's config from its snapshot and sync both the committed config
  // and the local input strings (which don't otherwise track the config prop).
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    const snap = await fetchSnapshot(nodeId);
    setRefreshing(false);
    if (!snap) return;
    setPaused(snap.status === "paused");
    syncInputs(snap.config);
  };

  // Coalesce rapid field edits into one gateway write. We hold the latest full
  // config in a ref and push it once typing settles (see CONFIG_DEBOUNCE_MS).
  const pushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingConfig = useRef<PendulumConfig | null>(null);
  const queuePush = (c: PendulumConfig) => {
    pendingConfig.current = c;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      if (pendingConfig.current) configureNode(nodeId, pendingConfig.current);
    }, CONFIG_DEBOUNCE_MS);
  };
  // Flush any pending edit on unmount so a fast close doesn't drop the last keystroke.
  useEffect(
    () => () => {
      clearTimeout(pushTimer.current);
      if (pendingConfig.current) configureNode(nodeId, pendingConfig.current);
    },
    [nodeId],
  );

  // Try to commit a single field; ignore values that don't parse against the schema.
  // On a valid parse we update local state immediately and debounce the gateway push.
  const commit = (key: "length" | "mass" | "wind" | "gravity", raw: string) => {
    if (raw.trim() === "") return;
    const value = Number(raw);
    if (Number.isNaN(value)) return;
    const parsed = PendulumConfigSchema.safeParse({ ...config, [key]: value });
    if (parsed.success) {
      onChange(parsed.data);
      queuePush(parsed.data);
    }
  };

  // Lifecycle buttons: send the command, then reconcile from the returned snapshot.
  const [busy, setBusy] = useState(false);
  const act = async (action: "start" | "stop" | "pause" | "resume") => {
    setBusy(true);
    const snap = await controlNode(nodeId, action);
    setBusy(false);
    if (!snap) return;
    setPaused(snap.status === "paused");
    onChange(snap.config);
  };

  // Roll a fresh random config for this node, reflect it locally, and push it.
  const randomize = () => {
    const c = randomPendulumConfig(nodeId);
    syncInputs(c);
    configureNode(nodeId, c);
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
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh from snapshot"
          title="Refresh from snapshot"
          style={{ ...closeStyle, marginLeft: "auto", fontSize: 12 }}
        >
          ⟳
        </button>
        <button type="button" onClick={onClose} aria-label="Close" style={closeStyle}>
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

      {/* Lifecycle controls — proxied per-node through the gateway */}
      <div style={{ display: "flex", gap: 4 }}>
        <button type="button" onClick={() => act(paused ? "resume" : "pause")} disabled={busy} style={btnStyle}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" onClick={() => act("start")} disabled={busy} style={btnStyle}>
          Start
        </button>
        <button type="button" onClick={() => act("stop")} disabled={busy} style={btnStyle}>
          Stop
        </button>
        <button type="button" onClick={randomize} style={btnStyle}>
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
