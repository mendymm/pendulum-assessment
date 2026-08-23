import { useRef } from "react";
import { mocha } from "../theme";

const HANDLE_PX = 22;
const DRAG_THRESHOLD_PX = 3; // movement beyond this counts as a drag, not a click

/**
 * A round handle sitting on a pendulum's anchor (at screen position x, y).
 * Click (no drag) opens the config popover; dragging moves the anchor along
 * y = 0 by converting horizontal pixel motion back into world meters.
 */
export function AnchorHandle({
  nodeId,
  x,
  y,
  pxPerMeter,
  anchorX,
  color,
  onAnchorMove,
  onOpenConfig,
}: {
  nodeId: number;
  x: number;
  y: number;
  pxPerMeter: number;
  anchorX: number;
  color: string;
  onAnchorMove?: (nodeId: number, anchorX: number) => void;
  onOpenConfig?: (nodeId: number, e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const drag = useRef<{ startClientX: number; startAnchorX: number; moved: boolean } | null>(null);

  return (
    <button
      type="button"
      title={`Node ${nodeId} — click to configure, drag to move`}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startClientX: e.clientX, startAnchorX: anchorX, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.startClientX;
        if (Math.abs(dx) > DRAG_THRESHOLD_PX) d.moved = true;
        if (d.moved) onAnchorMove?.(nodeId, d.startAnchorX + dx / pxPerMeter);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (!d.moved) onOpenConfig?.(nodeId, e);
        drag.current = null;
      }}
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        width: HANDLE_PX,
        height: HANDLE_PX,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        padding: 0,
        background: mocha.surface1,
        color: mocha.text,
        border: `2px solid ${color}`,
        cursor: "grab",
        pointerEvents: "auto",
        touchAction: "none",
        font: "12px/1 system-ui, sans-serif",
      }}
    >
      ⚙
    </button>
  );
}
