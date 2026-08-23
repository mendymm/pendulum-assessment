import { bobColor, mocha } from "../theme";
import { CONFIG_TRIGGER_ATTR } from "./ConfigBox";
import type { PendulumInstance } from "./Pendulum";

/** Horizontally-scrollable row of nodeId chips. Clicking one opens its config box. */
export function NodeGrid({
  pendulums,
  selectedNodeId,
  onSelect,
}: {
  pendulums: PendulumInstance[];
  selectedNodeId: number | null;
  onSelect: (nodeId: number, e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        maxWidth: "100%",
        padding: "4px 2px",
      }}
    >
      {pendulums.map(({ nodeId }) => {
        const selected = nodeId === selectedNodeId;
        return (
          <button
            key={nodeId}
            type="button"
            {...{ [CONFIG_TRIGGER_ATTR]: "" }}
            onClick={(e) => onSelect(nodeId, e)}
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              background: selected ? mocha.surface1 : mocha.surface0,
              color: mocha.text,
              border: `1px solid ${selected ? bobColor(nodeId) : mocha.surface1}`,
              borderRadius: 6,
              cursor: "pointer",
              font: "12px/1 ui-monospace, monospace",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: bobColor(nodeId) }} />
            {nodeId}
          </button>
        );
      })}
    </div>
  );
}
