import { RUNTIME_CONFIG } from "@pendulum/shared";
import { PendulumCanvas, type PendulumView } from "./components/PendulumCanvas";

// Placeholder layout until live snapshots arrive from the gateway:
// evenly-spaced anchors, each pendulum given a distinct rest angle.
function initialPendulums(count: number): PendulumView[] {
  return Array.from({ length: count }, (_, i) => {
    const fraction = count === 1 ? 0.5 : i / (count - 1);
    const angle = -0.6 + (1.2 * i) / Math.max(count - 1, 1);
    return {
      id: i,
      angle,
      config: {
        initialAngle: angle,
        mass: 5,
        length: 240,
        anchor: { x: fraction },
      },
    };
  });
}

export function App() {
  const pendulums = initialPendulums(RUNTIME_CONFIG.simCount);

  return (
    <div
      style={{
        position: "relative",
        height: "100vh",
        background: "#1e1e2e",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Canvas fills the whole screen */}
      <PendulumCanvas pendulums={pendulums} />

      {/* Config bar overlaid at the very top of the canvas */}
      <header
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "10vh",
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 20px",
          boxSizing: "border-box",
          color: "#e2e8f0",
          borderBottom: "1px solid rgba(226,232,240,0.15)",
        }}
      >
        <strong style={{ fontSize: 18 }}>Distributed Pendulum</strong>
      </header>
    </div>
  );
}
