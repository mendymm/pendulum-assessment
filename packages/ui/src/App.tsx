import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";
import { defaultPendulumConfig, type PendulumConfig, PendulumConfigSchema } from "@pendulum/shared/src/types";
import { useRef, useState } from "react";
import { type CameraView, Canvas, type CanvasHandle, type WorldPoint } from "./components/Canvas";
import { ConfigBox } from "./components/ConfigBox";
import { NodeGrid } from "./components/NodeGrid";
import type { PendulumInstance } from "./components/Pendulum";
import { mocha } from "./theme";

const ZOOM_STEP = 1.4; // multiplier per button press

interface Selection {
  nodeId: number;
  left: number;
  top: number;
}

export function App() {
  const [view, setView] = useState<CameraView | null>(null);
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);

  // The pendulums live here so both the canvas and the config box edit one source.
  const [pendulums, setPendulums] = useState<PendulumInstance[]>(() =>
    Array.from({ length: RUNTIME_CONFIG.simCount }, (_, i) => ({ nodeId: i, config: defaultPendulumConfig(i) })),
  );
  const [selected, setSelected] = useState<Selection | null>(null);

  const selectedConfig = selected ? pendulums.find((p) => p.nodeId === selected.nodeId)?.config : undefined;

  const selectNode = (nodeId: number, e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setSelected((s) => (s?.nodeId === nodeId ? null : { nodeId, left: rect.left, top: rect.bottom + 6 }));
  };

  const updateConfig = (nodeId: number, config: PendulumConfig) =>
    setPendulums((prev) => prev.map((p) => (p.nodeId === nodeId ? { ...p, config } : p)));

  const moveAnchor = (nodeId: number, anchorX: number) =>
    setPendulums((prev) =>
      prev.map((p) => (p.nodeId === nodeId ? { ...p, config: PendulumConfigSchema.parse({ ...p.config, anchorX }) } : p)),
    );

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: mocha.mantle,
        color: mocha.text,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Top bar: global controls */}
      <header
        style={{
          height: "15%",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0 1.5rem",
          borderBottom: `1px solid ${mocha.surface0}`,
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: mocha.subtext1, flex: "0 0 auto" }}>
          Distributed Pendulum
        </h1>

        {/* Center: scrollable grid of nodeIds, pinned to the top of the bar */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", alignSelf: "flex-start" }}>
          <NodeGrid pendulums={pendulums} selectedNodeId={selected?.nodeId ?? null} onSelect={selectNode} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: "0 0 auto" }}>
          {/* Zoom controls */}
          <div style={{ display: "flex", gap: "0.35rem" }}>
            <ZoomButton label="−" onClick={() => canvasRef.current?.zoomBy(1 / ZOOM_STEP)} />
            <ZoomButton label="+" onClick={() => canvasRef.current?.zoomBy(ZOOM_STEP)} />
          </div>

          {/* Debug: where the viewport is centered on the infinite plane */}
          <div
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.8rem",
              fontVariantNumeric: "tabular-nums",
              color: mocha.subtext0,
              background: mocha.crust,
              border: `1px solid ${mocha.surface0}`,
              borderRadius: 6,
              padding: "0.4rem 0.6rem",
              lineHeight: 1.4,
              display: "flex",
              gap: "1.25rem",
            }}
          >
            <DebugPair title="center" x={view?.centerX ?? null} y={view?.centerY ?? null} />
            <DebugPair title="cursor" x={cursor?.x ?? null} y={cursor?.y ?? null} />
          </div>
        </div>
      </header>

      {/* Bottom: the simulation canvas */}
      <main style={{ height: "85%", minHeight: 0 }}>
        <Canvas
          ref={canvasRef}
          pendulums={pendulums}
          onViewChange={setView}
          onCursorChange={setCursor}
          onOpenConfig={selectNode}
          onAnchorMove={moveAnchor}
        />
      </main>

      {/* Config popover for the selected node */}
      {selected && selectedConfig && (
        <ConfigBox
          nodeId={selected.nodeId}
          config={selectedConfig}
          position={{ left: selected.left, top: selected.top }}
          onChange={(config) => updateConfig(selected.nodeId, config)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** A labeled x/y coordinate pair with fixed-width value cells so the box never reflows. */
function DebugPair({ title, x, y }: { title: string; x: number | null; y: number | null }) {
  return (
    <div>
      <div style={{ color: mocha.overlay1, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {title}
      </div>
      <CoordRow axis="x" value={x} />
      <CoordRow axis="y" value={y} />
    </div>
  );
}

function CoordRow({ axis, value }: { axis: string; value: number | null }) {
  return (
    <div>
      {axis}:{" "}
      <span style={{ display: "inline-block", width: "5.5ch", textAlign: "right" }}>
        {value === null ? "—" : value.toFixed(1)}
      </span>{" "}
      m
    </div>
  );
}

function ZoomButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        fontSize: "1.2rem",
        lineHeight: 1,
        color: mocha.text,
        background: mocha.surface0,
        border: `1px solid ${mocha.surface1}`,
        borderRadius: 6,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
