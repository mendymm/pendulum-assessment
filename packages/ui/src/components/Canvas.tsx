import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { mocha } from "../theme";

/**
 * The camera into the conceptually-infinite world.
 * (x, y) is the world-space point at the top-left of the viewport.
 * pxPerMeter is the zoom: how many screen pixels one world meter occupies.
 * World coordinates are in meters. SVG's y-axis points down, which matches
 * pendulums hanging *below* the beam (the beam sits at y = 0).
 */
interface Camera {
  x: number;
  y: number;
  pxPerMeter: number;
}

const INITIAL_CAMERA: Camera = { x: -200, y: -30, pxPerMeter: 1.5 };
const MIN_PX_PER_METER = 0.2;
const MAX_PX_PER_METER = 400;
const GRID_STEP = 100; // meters between grid lines
const MAX_GRID_LINES = 500; // safety cap so extreme zoom-out can't flood the DOM

/** Integer multiples of `step` covering [lo, hi], capped to avoid runaway line counts. */
function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  if ((hi - lo) / step > MAX_GRID_LINES) return out;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

export interface CameraView {
  centerX: number;
  centerY: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

interface CanvasProps {
  onViewChange?: (view: CameraView) => void;
  onCursorChange?: (cursor: WorldPoint | null) => void;
}

export interface CanvasHandle {
  /** Multiply the current zoom by `factor` (>1 zooms in), keeping the viewport center fixed. */
  zoomBy: (factor: number) => void;
}

const clampZoom = (ppm: number) => Math.min(MAX_PX_PER_METER, Math.max(MIN_PX_PER_METER, ppm));

export const Canvas = memo(
  forwardRef<CanvasHandle, CanvasProps>(function Canvas({ onViewChange, onCursorChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const sizeRef = useRef(size);
    sizeRef.current = size;
    const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
    const cameraRef = useRef(camera);
    cameraRef.current = camera;
    const dragRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

    // Track the container's pixel size so 1 world-meter is always square on screen.
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        setSize({ w: width, h: height });
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    // Drag to pan.
    const onPointerDown = useCallback(
      (e: React.PointerEvent) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { startX: e.clientX, startY: e.clientY, camX: camera.x, camY: camera.y };
      },
      [camera.x, camera.y],
    );

    const onPointerMove = useCallback(
      (e: React.PointerEvent) => {
        // Report cursor position in world coordinates.
        if (onCursorChange) {
          const rect = e.currentTarget.getBoundingClientRect();
          const c = cameraRef.current;
          onCursorChange({
            x: c.x + (e.clientX - rect.left) / c.pxPerMeter,
            y: c.y + (e.clientY - rect.top) / c.pxPerMeter,
          });
        }

        const drag = dragRef.current;
        if (!drag) return;
        setCamera((c) => ({
          ...c,
          x: drag.camX - (e.clientX - drag.startX) / c.pxPerMeter,
          y: drag.camY - (e.clientY - drag.startY) / c.pxPerMeter,
        }));
      },
      [onCursorChange],
    );

    const onPointerUp = useCallback((e: React.PointerEvent) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }, []);

    const onPointerLeave = useCallback(() => onCursorChange?.(null), [onCursorChange]);

    // Zoom by `factor` around a pixel anchor, keeping the world point under it fixed.
    const zoomAtPixel = useCallback((px: number, py: number, factor: number) => {
      setCamera((c) => {
        const next = clampZoom(c.pxPerMeter * factor);
        const worldX = c.x + px / c.pxPerMeter;
        const worldY = c.y + py / c.pxPerMeter;
        return { pxPerMeter: next, x: worldX - px / next, y: worldY - py / next };
      });
    }, []);

    // Wheel to zoom, keeping the point under the cursor fixed.
    const onWheel = useCallback(
      (e: React.WheelEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        zoomAtPixel(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.001));
      },
      [zoomAtPixel],
    );

    // Zoom controls driven from outside (e.g. the +/- buttons) pivot on the viewport center.
    useImperativeHandle(
      ref,
      () => ({
        zoomBy: (factor: number) => zoomAtPixel(sizeRef.current.w / 2, sizeRef.current.h / 2, factor),
      }),
      [zoomAtPixel],
    );

    // Report the world point at the center of the viewport to the parent.
    useEffect(() => {
      if (!onViewChange || size.w === 0 || size.h === 0) return;
      onViewChange({
        centerX: camera.x + size.w / camera.pxPerMeter / 2,
        centerY: camera.y + size.h / camera.pxPerMeter / 2,
      });
    }, [camera, size, onViewChange]);

    if (size.w === 0 || size.h === 0) {
      return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
    }

    // Visible world rectangle derived from the camera + container size.
    const viewW = size.w / camera.pxPerMeter;
    const viewH = size.h / camera.pxPerMeter;
    const left = camera.x;
    const top = camera.y;
    const right = camera.x + viewW;
    const bottom = camera.y + viewH;

    const xLines = ticks(left, right, GRID_STEP);
    const yLines = ticks(top, bottom, GRID_STEP);

    return (
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", overflow: "hidden", cursor: dragRef.current ? "grabbing" : "grab" }}
      >
        <svg
          role="img"
          aria-label="Pendulum simulation canvas"
          width="100%"
          height="100%"
          viewBox={`${left} ${top} ${viewW} ${viewH}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onWheel={onWheel}
          style={{ display: "block", touchAction: "none" }}
        >
          {/* Background */}
          <rect x={left} y={top} width={viewW} height={viewH} fill={mocha.base} />

          {/* Grid (100 m spacing, thin lines) */}
          <g stroke={mocha.surface0} strokeWidth={1} vectorEffect="non-scaling-stroke">
            {xLines.map((x) => (
              <line key={`x${x}`} x1={x} y1={top} x2={x} y2={bottom} />
            ))}
            {yLines.map((y) => (
              <line key={`y${y}`} x1={left} y1={y} x2={right} y2={y} />
            ))}
          </g>

          {/* World origin axes (x = 0 vertical, y = 0 horizontal), emphasized */}
          <g stroke={mocha.surface2} strokeWidth={1.5} vectorEffect="non-scaling-stroke">
            <line x1={0} y1={top} x2={0} y2={bottom} />
            <line x1={left} y1={0} x2={right} y2={0} />
          </g>

          {/* The beam that pendulums hang from, at y = 0 */}
          <line
            x1={left}
            y1={0}
            x2={right}
            y2={0}
            stroke={mocha.overlay1}
            strokeWidth={4}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    );
  }),
);
