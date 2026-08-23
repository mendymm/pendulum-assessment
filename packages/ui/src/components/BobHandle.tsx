import { useRef } from "react";

interface CameraLike {
  x: number;
  y: number;
  pxPerMeter: number;
}

const MIN_GRAB_PX = 16; // keep tiny bobs grabbable
const ANGLE_LIMIT = Math.PI / 2; // never lift the bob above the beam (y = 0)

/**
 * A transparent, circular grab area over a pendulum's bob. Dragging it rotates
 * the bob around its anchor at the fixed string length (snapping to the arc):
 * the angle is derived from the anchor→pointer direction, so distance is ignored.
 * The angle is committed live as you drag; releasing is the "drop".
 */
export function BobHandle({
  nodeId,
  sx,
  sy,
  screenR,
  anchorX,
  camera,
  containerRef,
  onDrop,
}: {
  nodeId: number;
  sx: number;
  sy: number;
  screenR: number;
  anchorX: number;
  camera: CameraLike;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDrop?: (nodeId: number, angle: number) => void;
}) {
  const dragging = useRef(false);

  // Angle from vertical (0 = straight down) of the anchor→pointer direction.
  const angleFrom = (clientX: number, clientY: number): number | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const worldX = camera.x + (clientX - rect.left) / camera.pxPerMeter;
    const worldY = camera.y + (clientY - rect.top) / camera.pxPerMeter;
    const angle = Math.atan2(worldX - anchorX, worldY); // +y is down, matching a hanging bob
    // Clamp to ±90° so the bob never rises above the beam at y = 0.
    return Math.max(-ANGLE_LIMIT, Math.min(ANGLE_LIMIT, angle));
  };

  const diameter = Math.max(screenR * 2, MIN_GRAB_PX);

  return (
    <div
      data-bob={nodeId}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const a = angleFrom(e.clientX, e.clientY);
        if (a !== null) onDrop?.(nodeId, a);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        const a = angleFrom(e.clientX, e.clientY);
        if (a !== null) onDrop?.(nodeId, a);
        dragging.current = false;
      }}
      style={{
        position: "absolute",
        left: sx,
        top: sy,
        transform: "translate(-50%, -50%)",
        width: diameter,
        height: diameter,
        borderRadius: "50%",
        cursor: "grab",
        pointerEvents: "auto",
        touchAction: "none",
      }}
    />
  );
}
