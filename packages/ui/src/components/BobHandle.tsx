import { LengthSchema } from "@pendulum/shared/src/types";
import { useRef } from "react";

interface CameraLike {
  x: number;
  y: number;
  pxPerMeter: number;
}

const MIN_GRAB_PX = 20; // keep tiny bobs grabbable
const ANGLE_LIMIT = Math.PI / 2; // never lift the bob above the beam (y = 0)
const LENGTH_MIN = 0.5; // m — don't let the string collapse to zero
const LENGTH_MAX = LengthSchema._zod.bag.maximum ?? 100;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The drop pose set by a drag: launch angle + string length. */
export interface BobPose {
  angle: number;
  length: number;
}

/**
 * A transparent, circular grab area over a pendulum's drop-angle ghost. Dragging
 * it moves the bob to the pointer: the anchor→pointer direction sets the launch
 * angle and the distance sets the string length. The pose is committed live via
 * `onDrag`; releasing is the `onDrop`.
 *
 * The handle rides the (stationary) launch-angle ghost, not the swinging live bob,
 * so it stays a fixed target even while the sim runs.
 */
export function BobHandle({
  nodeId,
  sx,
  sy,
  screenR,
  anchorX,
  camera,
  containerRef,
  onDrag,
  onDrop,
}: {
  nodeId: number;
  sx: number;
  sy: number;
  screenR: number;
  anchorX: number;
  camera: CameraLike;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDrag?: (nodeId: number, pose: BobPose) => void;
  onDrop?: (nodeId: number, pose: BobPose) => void;
}) {
  const dragging = useRef(false);

  // Drop pose from the pointer: angle from vertical (0 = straight down) of the
  // anchor→pointer direction, and length = anchor→pointer distance. Both clamped.
  const poseFrom = (clientX: number, clientY: number): BobPose | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const dx = camera.x + (clientX - rect.left) / camera.pxPerMeter - anchorX;
    const dy = camera.y + (clientY - rect.top) / camera.pxPerMeter; // anchor sits at y = 0
    return {
      angle: clamp(Math.atan2(dx, dy), -ANGLE_LIMIT, ANGLE_LIMIT), // +y is down, matching a hanging bob
      length: clamp(Math.hypot(dx, dy), LENGTH_MIN, LENGTH_MAX),
    };
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
        const pose = poseFrom(e.clientX, e.clientY);
        if (pose) onDrag?.(nodeId, pose);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        const pose = poseFrom(e.clientX, e.clientY);
        if (pose) onDrop?.(nodeId, pose);
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
