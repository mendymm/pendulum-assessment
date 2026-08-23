import type { PendulumLocation } from "@pendulum/shared/src/types";
import { Fragment, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { bobColor, mocha } from "../theme";
import { AnchorHandle } from "./AnchorHandle";
import { type BobPose, BobHandle } from "./BobHandle";
import {
  locationGeometry,
  Pendulum,
  type PendulumGeometry,
  pendulumGeometry,
  type PendulumInstance,
} from "./Pendulum";

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

const INITIAL_CAMERA: Camera = { x: -1, y: -0.5, pxPerMeter: 200 };
const MIN_PX_PER_METER = 1;
const MAX_PX_PER_METER = 5000;
const MIN_GRID_GAP_PX = 30; // don't draw grid lines closer than this on screen
const FIT_PADDING = 0.15; // fraction of extra space around content when fitting

/** Pick a "nice" world-space grid step (1/2/5 × 10ⁿ meters) so lines stay legible at any zoom. */
function niceStep(pxPerMeter: number): number {
  const rawStep = MIN_GRID_GAP_PX / pxPerMeter;
  const pow = 10 ** Math.floor(Math.log10(rawStep));
  for (const mult of [1, 2, 5, 10]) {
    if (mult * pow >= rawStep) return mult * pow;
  }
  return 10 * pow;
}

/** Integer multiples of `step` covering [lo, hi]. */
function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

/** Camera that frames all pendulums (plus the beam at y = 0) within the viewport. */
function fitCamera(pendulums: PendulumInstance[], size: { w: number; h: number }): Camera {
  if (pendulums.length === 0) return INITIAL_CAMERA;

  let minX = 0;
  let maxX = 0;
  let minY = 0; // include the beam at y = 0
  let maxY = 0;
  for (const { config } of pendulums) {
    const { anchorX, bobX, bobY, r } = pendulumGeometry(config);
    minX = Math.min(minX, anchorX, bobX - r);
    maxX = Math.max(maxX, anchorX, bobX + r);
    minY = Math.min(minY, bobY - r);
    maxY = Math.max(maxY, bobY + r);
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const worldW = (maxX - minX || 1) * (1 + 2 * FIT_PADDING);
  const worldH = (maxY - minY || 1) * (1 + 2 * FIT_PADDING);
  const pxPerMeter = clampZoom(Math.min(size.w / worldW, size.h / worldH));

  return {
    pxPerMeter,
    x: cx - size.w / pxPerMeter / 2,
    y: cy - size.h / pxPerMeter / 2,
  };
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
  pendulums: PendulumInstance[];
  // Live bob positions from the gateway feed, keyed by nodeId. A node present here
  // renders at its swinging position; absent nodes fall back to config geometry.
  locations?: Map<number, PendulumLocation>;
  onViewChange?: (view: CameraView) => void;
  onCursorChange?: (cursor: WorldPoint | null) => void;
  onOpenConfig?: (nodeId: number, e: React.MouseEvent<HTMLButtonElement>) => void;
  onAnchorMove?: (nodeId: number, anchorX: number) => void;
  onAnchorDrop?: (nodeId: number, anchorX: number) => void;
  onBobDrag?: (nodeId: number, pose: BobPose) => void;
  onBobDrop?: (nodeId: number, pose: BobPose) => void;
}

export interface CanvasHandle {
  /** Multiply the current zoom by `factor` (>1 zooms in), keeping the viewport center fixed. */
  zoomBy: (factor: number) => void;
}

const clampZoom = (ppm: number) => Math.min(MAX_PX_PER_METER, Math.max(MIN_PX_PER_METER, ppm));

export const Canvas = memo(
  forwardRef<CanvasHandle, CanvasProps>(function Canvas(
    {
      pendulums,
      locations,
      onViewChange,
      onCursorChange,
      onOpenConfig,
      onAnchorMove,
      onAnchorDrop,
      onBobDrag,
      onBobDrop,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const sizeRef = useRef(size);
    sizeRef.current = size;
    const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
    const cameraRef = useRef(camera);
    cameraRef.current = camera;
    const pendulumsRef = useRef(pendulums);
    pendulumsRef.current = pendulums;
    const dragRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

    // Keep the pendulums framed until the user takes control of the camera.
    // (Re-fits across the transient sizes emitted while the layout settles, and
    // on window resize / node-count change, but stops once the user pans or zooms.
    // Intentionally does NOT refit on config edits, so tweaking a value doesn't
    // yank the camera around.)
    const userControlled = useRef(false);
    useEffect(() => {
      if (userControlled.current || size.w === 0 || size.h === 0) return;
      setCamera(fitCamera(pendulumsRef.current, size));
    }, [size, pendulums.length]);

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
        userControlled.current = true;
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
      userControlled.current = true;
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

    const step = niceStep(camera.pxPerMeter);
    const xLines = ticks(left, right, step);
    const yLines = ticks(top, bottom, step);

    // The solid bob renders at the live swinging position when the gateway has one
    // for this node; otherwise it sits at the config (drop) pose.
    const liveGeomFor = (p: PendulumInstance): PendulumGeometry => {
      const loc = locations?.get(p.nodeId);
      return loc ? locationGeometry(loc) : pendulumGeometry(p.config);
    };

    return (
      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          cursor: dragRef.current ? "grabbing" : "grab",
        }}
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

          {/* Grid (adaptive 1/2/5×10ⁿ m spacing, thin lines).
              vector-effect must be on each line — it is not inherited from the <g>. */}
          <g stroke={mocha.surface0} strokeWidth={1}>
            {xLines.map((x) => (
              <line key={`x${x}`} x1={x} y1={top} x2={x} y2={bottom} vectorEffect="non-scaling-stroke" />
            ))}
            {yLines.map((y) => (
              <line key={`y${y}`} x1={left} y1={y} x2={right} y2={y} vectorEffect="non-scaling-stroke" />
            ))}
          </g>

          {/* World origin axes (x = 0 vertical, y = 0 horizontal), emphasized */}
          <g stroke={mocha.surface2} strokeWidth={1.5}>
            <line x1={0} y1={top} x2={0} y2={bottom} vectorEffect="non-scaling-stroke" />
            <line x1={left} y1={0} x2={right} y2={0} vectorEffect="non-scaling-stroke" />
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

          {/* Pendulums: solid bob at the live position, plus a faint ghost at the
              launch (drop) angle whenever the sim is reporting a live position —
              so you can see where a running bob will relaunch from. */}
          {pendulums.map((p) => (
            <Fragment key={p.nodeId}>
              {locations?.has(p.nodeId) && (
                <Pendulum geometry={pendulumGeometry(p.config)} color={bobColor(p.nodeId)} ghost />
              )}
              <Pendulum geometry={liveGeomFor(p)} color={bobColor(p.nodeId)} />
            </Fragment>
          ))}
        </svg>

        {/* Interactive handles (fixed pixel size, projected from world space).
            The layer ignores pointer events except on the handles themselves. */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {pendulums.map((p) => {
            const { nodeId } = p;
            // Handles operate on the config (drop) pose: the anchor sits on the
            // beam, and the bob handle rides the stationary launch-angle ghost.
            const g = pendulumGeometry(p.config);
            return (
              <Fragment key={nodeId}>
                <AnchorHandle
                  nodeId={nodeId}
                  x={(g.anchorX - camera.x) * camera.pxPerMeter}
                  y={(0 - camera.y) * camera.pxPerMeter}
                  pxPerMeter={camera.pxPerMeter}
                  anchorX={g.anchorX}
                  color={bobColor(nodeId)}
                  onAnchorMove={onAnchorMove}
                  onAnchorDrop={onAnchorDrop}
                  onOpenConfig={onOpenConfig}
                />
                <BobHandle
                  nodeId={nodeId}
                  sx={(g.bobX - camera.x) * camera.pxPerMeter}
                  sy={(g.bobY - camera.y) * camera.pxPerMeter}
                  screenR={g.r * camera.pxPerMeter}
                  anchorX={g.anchorX}
                  camera={camera}
                  containerRef={containerRef}
                  onDrag={onBobDrag}
                  onDrop={onBobDrop}
                />
              </Fragment>
            );
          })}
        </div>
      </div>
    );
  }),
);
