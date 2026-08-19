import { RUNTIME_CONFIG } from "@pendulum/shared";
import { PendulumCanvas, type PendulumView } from "./components/PendulumCanvas";

// Placeholder layout until live snapshots arrive from the gateway:
// evenly-spaced anchors, each pendulum given a distinct rest angle.
function initialPendulums(count: number): PendulumView[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = -0.6 + (1.2 * i) / Math.max(count - 1, 1);
    return {
      id: i,
      angle,
      config: {
        initialAngle: angle,
        mass: 5,
        length: 240,
        anchor: { x: count === 1 ? 0.5 : i / (count - 1) },
      },
    };
  });
}

export function App() {
  const pendulums = initialPendulums(RUNTIME_CONFIG.simCount);

  return (
    <div className="app">
      <PendulumCanvas pendulums={pendulums} />
      <header className="bar">
        <strong>Distributed Pendulum</strong>
      </header>
    </div>
  );
}
