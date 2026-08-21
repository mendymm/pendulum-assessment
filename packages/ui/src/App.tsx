import { type PendulumConfig, RUNTIME_CONFIG } from "@pendulum/shared";
import { Controls } from "./components/Controls";
import { PendulumScene } from "./components/PendulumScene";
import { computeViewBox } from "./svgTransform";
import { useUiUpdates } from "./useUiUpdates";

// Seed config mirroring the sim-node defaults (anchor.x = nodeId, length 1m).
// This is the UI's source of truth for anchors / lengths / masses — it drives
// the viewBox and the bob colors. The gateway only streams live positions, so
// until a config feed / control panel exists this seed stands in for it.
function seedConfigs(count: number): PendulumConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    angle: 0.4,
    mass: 1 + i * 2, // vary mass so the color mapping is visible
    length: 1,
    anchor: { x: i },
  }));
}

export function App() {
  const configs = seedConfigs(RUNTIME_CONFIG.simCount);
  const locations = useUiUpdates();
  const viewBox = computeViewBox(configs);

  return (
    <div className="app">
      <PendulumScene configs={configs} locations={locations} viewBox={viewBox} />
      <header className="bar">
        <strong>Distributed Pendulum</strong>
        <Controls />
      </header>
    </div>
  );
}
