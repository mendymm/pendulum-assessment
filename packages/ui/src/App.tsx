import { useRef, useState } from "react";
import { type CameraView, Canvas, type CanvasHandle, type WorldPoint } from "./components/Canvas";
import { mocha } from "./theme";

const ZOOM_STEP = 1.4; // multiplier per button press

export function App() {
  const [view, setView] = useState<CameraView | null>(null);
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);

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
      {/* Top 20%: reserved for global controls */}
      <header
        style={{
          height: "20%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1.5rem",
          borderBottom: `1px solid ${mocha.surface0}`,
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: mocha.subtext1 }}>Distributed Pendulum</h1>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
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
              color: mocha.subtext0,
              background: mocha.crust,
              border: `1px solid ${mocha.surface0}`,
              borderRadius: 6,
              padding: "0.4rem 0.6rem",
              lineHeight: 1.4,
            }}
          >
            <div style={{ display: "flex", gap: "1.25rem" }}>
              <div>
                <div
                  style={{
                    color: mocha.overlay1,
                    fontSize: "0.65rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  center
                </div>
                x: {view ? view.centerX.toFixed(1) : "—"} m
                <br />
                y: {view ? view.centerY.toFixed(1) : "—"} m
              </div>
              <div>
                <div
                  style={{
                    color: mocha.overlay1,
                    fontSize: "0.65rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  cursor
                </div>
                x: {cursor ? cursor.x.toFixed(1) : "—"} m
                <br />
                y: {cursor ? cursor.y.toFixed(1) : "—"} m
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Bottom 80%: the simulation canvas */}
      <main style={{ height: "80%", minHeight: 0 }}>
        <Canvas ref={canvasRef} onViewChange={setView} onCursorChange={setCursor} />
      </main>
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
