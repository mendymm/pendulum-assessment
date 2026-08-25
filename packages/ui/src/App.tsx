import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";
import {
  defaultPendulumConfig,
  type PendulumConfig,
  PendulumConfigPatchSchema,
  PendulumConfigSchema,
  type PendulumLocation,
  type SimSnapshot,
} from "@pendulum/shared/src/types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  configureNode,
  controlAll,
  type FeedHandle,
  type FeedStatus,
  fetchAllSnapshots,
  type RestartInfo,
  randomizeAll,
  subscribeLocations,
} from "./api";
import type { BobPose } from "./components/BobHandle";
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
  placement: "above" | "below";
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

  // Live bob positions streamed from the gateway (keyed by nodeId); drives the
  // canvas so running pendulums actually swing.
  const [locations, setLocations] = useState<Map<number, PendulumLocation>>(() => new Map());
  // Active collision-restart countdown pushed by the gateway (null when idle). Drives the
  // canvas overlay — no more inferring "who collided" from the locations map.
  const [restart, setRestart] = useState<RestartInfo | null>(null);
  // Live-feed socket state for the debug indicator, plus a handle so the Reconnect
  // button can force an immediate reconnect.
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("connecting");
  const feedRef = useRef<FeedHandle | null>(null);
  useEffect(() => {
    const handle = subscribeLocations((frame) => {
      setLocations(frame.locations);
      setRestart(frame.restart);
    }, setFeedStatus);
    feedRef.current = handle;
    return () => {
      handle.unsubscribe();
      feedRef.current = null;
    };
  }, []);

  const selectedConfig = selected ? pendulums.find((p) => p.nodeId === selected.nodeId)?.config : undefined;

  // Merge a batch of snapshots into local config; nodes not present keep theirs.
  const applySnapshots = useCallback((snapshots: Map<number, SimSnapshot>) => {
    setPendulums((prev) =>
      prev.map((p) => {
        const snap = snapshots.get(p.nodeId);
        return snap ? { ...p, config: snap.config } : p;
      }),
    );
  }, []);

  // On load, pull every node's real config in one broadcast request so the UI
  // reflects the live sims rather than our local defaults. Nodes that don't answer
  // keep their default config.
  useEffect(() => {
    let cancelled = false;
    fetchAllSnapshots().then((snapshots) => {
      if (!cancelled) applySnapshots(snapshots);
    });
    return () => {
      cancelled = true;
    };
  }, [applySnapshots]);

  const selectNode = (nodeId: number, e: React.MouseEvent<HTMLButtonElement>, placement: "above" | "below") => {
    const rect = e.currentTarget.getBoundingClientRect();
    const top = placement === "above" ? rect.top : rect.bottom;
    setSelected((s) => (s?.nodeId === nodeId ? null : { nodeId, left: rect.left, top, placement }));
  };

  // Anchor gear opens the box above the pendulum; the top-bar chip opens it below.
  const openFromAnchor = (nodeId: number, e: React.MouseEvent<HTMLButtonElement>) => selectNode(nodeId, e, "above");
  const openFromChip = (nodeId: number, e: React.MouseEvent<HTMLButtonElement>) => selectNode(nodeId, e, "below");

  const updateConfig = (nodeId: number, config: PendulumConfig) =>
    setPendulums((prev) => prev.map((p) => (p.nodeId === nodeId ? { ...p, config } : p)));

  // Canvas edits (anchor drag, bob drag) follow the same two-phase shape: update
  // locally on every pointermove so the handle/ghost tracks the pointer, then
  // commit to the gateway once, on release — sending only the fields that changed.
  type ConfigEdit = { anchorX?: number; angle?: number; length?: number };

  // Live drag: local only, no gateway write.
  const editLocal = (nodeId: number, patch: ConfigEdit) =>
    setPendulums((prev) =>
      prev.map((p) =>
        p.nodeId === nodeId ? { ...p, config: PendulumConfigSchema.parse({ ...p.config, ...patch }) } : p,
      ),
    );

  // Release: commit locally and push just the fields that changed.
  const commitEdit = (nodeId: number, patch: ConfigEdit) => {
    editLocal(nodeId, patch);
    configureNode(nodeId, PendulumConfigPatchSchema.parse(patch));
  };

  const moveAnchor = (nodeId: number, anchorX: number) => editLocal(nodeId, { anchorX });
  const dropAnchor = (nodeId: number, anchorX: number) => commitEdit(nodeId, { anchorX });

  // Dragging a bob sets its drop pose — launch angle + string length. The live bob
  // keeps swinging, a faint ghost shows the chosen pose, and it takes effect on the
  // next Start (angle) / immediately (length, since the sim's physics use it).
  const dragBob = (nodeId: number, pose: BobPose) => editLocal(nodeId, pose);
  const dropBob = (nodeId: number, pose: BobPose) => commitEdit(nodeId, pose);

  // Global sim controls, fanned out to every node via the gateway broadcast routes.
  // `paused` is a UI-level toggle: the button/space bar flip between pause & resume.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const startAll = () => {
    controlAll("start");
    setPaused(false);
  };
  const stopAll = () => {
    controlAll("stop");
    setPaused(false);
  };
  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    setPaused(next);
    controlAll(next ? "pause" : "resume");
  }, []);
  const randomize = async () => {
    await randomizeAll();
    applySnapshots(await fetchAllSnapshots()); // re-sync configs the gateway just changed
  };

  // Space toggles global pause/resume, except while typing in a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      togglePause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePause]);

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
          <NodeGrid pendulums={pendulums} selectedNodeId={selected?.nodeId ?? null} onSelect={openFromChip} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: "0 0 auto" }}>
          {/* Zoom controls, stacked vertically */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <ZoomButton label="+" onClick={() => canvasRef.current?.zoomBy(ZOOM_STEP)} />
            <ZoomButton label="−" onClick={() => canvasRef.current?.zoomBy(1 / ZOOM_STEP)} />
          </div>

          {/* Global sim controls (2×2 grid) */}
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "0.35rem" }}>
            <ControlButton label={paused ? "Resume" : "Pause"} onClick={togglePause} />
            <ControlButton label="Randomize" onClick={randomize} />
            <ControlButton label="Start" onClick={startAll} />
            <ControlButton label="Stop" onClick={stopAll} />
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
            <FeedStatusPair status={feedStatus} onReconnect={() => feedRef.current?.reconnect()} />
          </div>
        </div>
      </header>

      {/* Bottom: the simulation canvas */}
      <main style={{ height: "85%", minHeight: 0 }}>
        <Canvas
          ref={canvasRef}
          pendulums={pendulums}
          locations={locations}
          restart={restart}
          onViewChange={setView}
          onCursorChange={setCursor}
          onOpenConfig={openFromAnchor}
          onAnchorMove={moveAnchor}
          onAnchorDrop={dropAnchor}
          onBobDrag={dragBob}
          onBobDrop={dropBob}
        />
      </main>

      {/* Config popover for the selected node */}
      {selected && selectedConfig && (
        <ConfigBox
          nodeId={selected.nodeId}
          config={selectedConfig}
          position={{ left: selected.left, top: selected.top }}
          placement={selected.placement}
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

/** Live-feed connection indicator: a colored dot + label, with a Reconnect button. */
function FeedStatusPair({ status, onReconnect }: { status: FeedStatus; onReconnect: () => void }) {
  const color = status === "open" ? mocha.green : status === "connecting" ? mocha.yellow : mocha.red;
  return (
    <div>
      <div style={{ color: mocha.overlay1, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        feed
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.15rem" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flex: "0 0 auto" }} />
        <span style={{ display: "inline-block", width: "10ch", whiteSpace: "nowrap", color: mocha.subtext1 }}>
          {status}
        </span>
      </div>
      <button
        type="button"
        onClick={onReconnect}
        style={{
          marginTop: "0.35rem",
          padding: "0.15rem 0.5rem",
          fontSize: "0.7rem",
          color: mocha.text,
          background: mocha.surface0,
          border: `1px solid ${mocha.surface1}`,
          borderRadius: 5,
          cursor: "pointer",
        }}
      >
        Reconnect
      </button>
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

/** A global sim-control button (start/stop/pause/randomize) sized for the top-bar grid. */
function ControlButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minWidth: 84,
        height: 32,
        padding: "0 0.6rem",
        fontSize: "0.8rem",
        fontWeight: 500,
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
