import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, Radio, ZoomIn, ZoomOut } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";
import { clamp } from "@/lib/format";
import type { MapPoint, MapScan, MapShape, WifiMapDoc } from "@/lib/types";
import { latestScans, rssiColor, round, type Vec } from "../lib/analysis";
import type { MapTool } from "../lib/tools";

interface View {
  zoom: number;
  center: Vec;
}

interface Draft {
  tool: "line" | "rect" | "circle";
  start: Vec;
  current: Vec;
  pointerId: number;
}

export interface MapCanvasProps {
  doc: WifiMapDoc;
  tool: MapTool;
  selectedPointId: string | null;
  selectedShapeId: string | null;
  heatmap: boolean;
  coverage: boolean;
  onHeatmapChange: (value: boolean) => void;
  onCoverageChange: (value: boolean) => void;
  onSelectPoint: (id: string | null) => void;
  onSelectShape: (id: string | null) => void;
  onMovePoint: (id: string, x: number, y: number) => void;
  onAddPoint: (position: Vec) => void;
  onAddShape: (shape: MapShape) => void;
  onRequestText: (position: Vec) => void;
}

const GRID_MINOR = 20;
const GRID_MAJOR = 100;

function shapeRadius(shape: MapShape): number {
  const [a, b] = shape.points;
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function MapCanvas({
  doc,
  tool,
  selectedPointId,
  selectedShapeId,
  heatmap,
  coverage,
  onHeatmapChange,
  onCoverageChange,
  onSelectPoint,
  onSelectShape,
  onMovePoint,
  onAddPoint,
  onAddShape,
  onRequestText,
}: MapCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, center: { x: doc.width / 2, y: doc.height / 2 } });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [panning, setPanning] = useState(false);
  const [cursor, setCursor] = useState<Vec | null>(null);

  const panRef = useRef<{ clientX: number; clientY: number; center: Vec; scale: number; pointerId: number } | null>(
    null,
  );
  const dragRef = useRef<{ id: string; offset: Vec; pointerId: number } | null>(null);

  const clampCenter = useCallback(
    (center: Vec, zoom: number): Vec => {
      const visibleWidth = doc.width / zoom;
      const visibleHeight = doc.height / zoom;
      return {
        x: visibleWidth >= doc.width ? doc.width / 2 : clamp(center.x, visibleWidth / 2, doc.width - visibleWidth / 2),
        y:
          visibleHeight >= doc.height
            ? doc.height / 2
            : clamp(center.y, visibleHeight / 2, doc.height - visibleHeight / 2),
      };
    },
    [doc.width, doc.height],
  );

  useEffect(() => {
    setView({ zoom: 1, center: { x: doc.width / 2, y: doc.height / 2 } });
    setDraft(null);
  }, [doc.id, doc.width, doc.height]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Vec => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const world = point.matrixTransform(ctm.inverse());
      return { x: clamp(world.x, 0, doc.width), y: clamp(world.y, 0, doc.height) };
    },
    [doc.width, doc.height],
  );

  /* Wheel zoom anchored at the cursor, applied through the viewBox. */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const anchor = toWorld(event.clientX, event.clientY);
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView((prev) => {
        const nextZoom = clamp(prev.zoom * factor, 0.5, 3);
        if (nextZoom === prev.zoom) return prev;
        const ratio = prev.zoom / nextZoom;
        const center = clampCenter(
          {
            x: anchor.x - (anchor.x - prev.center.x) * ratio,
            y: anchor.y - (anchor.y - prev.center.y) * ratio,
          },
          nextZoom,
        );
        return { zoom: nextZoom, center };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toWorld, clampCenter]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDraft(null);
      panRef.current = null;
      dragRef.current = null;
      setPanning(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const zoomBy = (factor: number) => {
    setView((prev) => {
      const nextZoom = clamp(prev.zoom * factor, 0.5, 3);
      return { zoom: nextZoom, center: clampCenter(prev.center, nextZoom) };
    });
  };

  const fit = () => setView({ zoom: 1, center: { x: doc.width / 2, y: doc.height / 2 } });

  const endGesture = (pointerId: number) => {
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
    panRef.current = null;
    dragRef.current = null;
    setPanning(false);
  };

  const commitDraft = (current: Draft) => {
    const { start } = current;
    const end = current.current;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance < 6) return;
    if (current.tool === "line") {
      onAddShape({
        id: `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        kind: "line",
        points: [start, end],
        label: null,
        color: null,
      });
      return;
    }
    if (current.tool === "rect") {
      onAddShape({
        id: `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        kind: "rect",
        points: [
          { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
          { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
        ],
        label: null,
        color: null,
      });
      return;
    }
    onAddShape({
      id: `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "circle",
      points: [start, { x: start.x + distance, y: start.y }],
      label: null,
      color: null,
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const world = toWorld(event.clientX, event.clientY);

    if (tool === "point") {
      onAddPoint(world);
      return;
    }
    if (tool === "text") {
      onRequestText(world);
      return;
    }
    if (tool === "line" || tool === "rect" || tool === "circle") {
      setDraft({ tool, start: world, current: world, pointerId: event.pointerId });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    onSelectPoint(null);
    onSelectShape(null);
    const scale = svgRef.current?.getScreenCTM()?.a ?? 1;
    panRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      center: view.center,
      scale: scale === 0 ? 1 : scale,
      pointerId: event.pointerId,
    };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const world = toWorld(event.clientX, event.clientY);
    setCursor(world);

    if (draft) {
      setDraft({ ...draft, current: world });
      return;
    }
    if (panRef.current) {
      const pan = panRef.current;
      const dx = (event.clientX - pan.clientX) / pan.scale;
      const dy = (event.clientY - pan.clientY) / pan.scale;
      setView((prev) => ({
        zoom: prev.zoom,
        center: clampCenter({ x: pan.center.x - dx, y: pan.center.y - dy }, prev.zoom),
      }));
      return;
    }
    const drag = dragRef.current;
    if (drag) {
      onMovePoint(drag.id, round(clamp(world.x - drag.offset.x, 0, doc.width), 1), round(clamp(world.y - drag.offset.y, 0, doc.height), 1));
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (draft) commitDraft(draft);
    setDraft(null);
    endGesture(event.pointerId);
  };

  const startPointDrag = (event: ReactPointerEvent<SVGGElement>, point: MapPoint) => {
    event.stopPropagation();
    onSelectPoint(point.id);
    onSelectShape(null);
    if (tool !== "select") return;
    const world = toWorld(event.clientX, event.clientY);
    dragRef.current = {
      id: point.id,
      offset: { x: world.x - point.x, y: world.y - point.y },
      pointerId: event.pointerId,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const visibleWidth = doc.width / view.zoom;
  const visibleHeight = doc.height / view.zoom;
  const viewBox = `${view.center.x - visibleWidth / 2} ${view.center.y - visibleHeight / 2} ${visibleWidth} ${visibleHeight}`;
  const pointsWithSignal = doc.points.filter((point) => latestScans(point).length > 0);
  const cursorStyle = panning ? "grabbing" : tool === "select" ? "grab" : "crosshair";

  const renderShape = (shape: MapShape) => {
    const active = shape.id === selectedShapeId;
    const stroke = active ? "#aac7ff" : (shape.color ?? "#7b8496");
    const width = active ? 2.6 : 2;
    const hit = (event: ReactPointerEvent<SVGElement>) => {
      event.stopPropagation();
      onSelectShape(shape.id);
      onSelectPoint(null);
    };

    if (shape.kind === "line" && shape.points[0] && shape.points[1]) {
      const [a, b] = shape.points;
      return (
        <g key={shape.id} onPointerDown={hit} className="cursor-pointer">
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={width} strokeLinecap="round" />
        </g>
      );
    }
    if (shape.kind === "rect" && shape.points[0] && shape.points[1]) {
      const [a, b] = shape.points;
      return (
        <g key={shape.id} onPointerDown={hit} className="cursor-pointer">
          <rect
            x={a.x}
            y={a.y}
            width={Math.max(1, b.x - a.x)}
            height={Math.max(1, b.y - a.y)}
            fill="rgba(255,255,255,0.012)"
            stroke={stroke}
            strokeWidth={width}
            rx={2}
          />
        </g>
      );
    }
    if (shape.kind === "circle" && shape.points[0]) {
      const radius = shapeRadius(shape);
      return (
        <g key={shape.id} onPointerDown={hit} className="cursor-pointer">
          <circle
            cx={shape.points[0].x}
            cy={shape.points[0].y}
            r={radius}
            fill="rgba(255,255,255,0.012)"
            stroke={stroke}
            strokeWidth={width}
          />
        </g>
      );
    }
    if (shape.kind === "text" && shape.points[0]) {
      return (
        <g key={shape.id} onPointerDown={hit} className="cursor-pointer">
          <text
            x={shape.points[0].x}
            y={shape.points[0].y}
            fill={active ? "#aac7ff" : (shape.color ?? "#c0c6d6")}
            fontSize={13}
            fontFamily="JetBrains Mono, SF Mono, monospace"
            style={{ userSelect: "none" }}
          >
            {shape.label ?? "Label"}
          </text>
        </g>
      );
    }
    return null;
  };

  return (
    <div className="glass-card flex min-h-[460px] flex-1 flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.055] px-2.5">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
            <Radio size={12} /> Heatmap
          </span>
          <Switch checked={heatmap} onChange={onHeatmapChange} label="Toggle RSSI heatmap" size="sm" />
          <span className="mx-0.5 h-3 w-px bg-white/10" />
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
            Coverage fill
          </span>
          <Switch checked={coverage} onChange={onCoverageChange} label="Toggle radial coverage fill" size="sm" />
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 font-mono text-[10px] text-outline">
            {Math.round(doc.width)} × {Math.round(doc.height)} u
          </span>
          <IconButton label="Zoom out" size="sm" icon={<ZoomOut size={13} />} onClick={() => zoomBy(1 / 1.25)} />
          <span className="w-11 text-center font-mono text-[10.5px] text-on-variant tnum">{Math.round(view.zoom * 100)}%</span>
          <IconButton label="Zoom in" size="sm" icon={<ZoomIn size={13} />} onClick={() => zoomBy(1.25)} />
          <IconButton label="Fit plan to view" size="sm" icon={<Maximize2 size={12} />} onClick={fit} />
        </div>
      </div>

      <div className="relative flex-1 bg-[#0b0b11]">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full touch-none select-none"
          style={{ cursor: cursorStyle }}
          role="application"
          aria-label="Floor plan canvas. Drag empty space to pan, use the toolbar tools to draw, and drag measurement points to move them."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => setCursor(null)}
        >
          <defs>
            <pattern id="wifi-grid-minor" width={GRID_MINOR} height={GRID_MINOR} patternUnits="userSpaceOnUse">
              <path d={`M ${GRID_MINOR} 0 L 0 0 0 ${GRID_MINOR}`} fill="none" stroke="#1c1c24" strokeWidth={0.6} />
            </pattern>
            <pattern id="wifi-grid-major" width={GRID_MAJOR} height={GRID_MAJOR} patternUnits="userSpaceOnUse">
              <rect width={GRID_MAJOR} height={GRID_MAJOR} fill="url(#wifi-grid-minor)" />
              <path d={`M ${GRID_MAJOR} 0 L 0 0 0 ${GRID_MAJOR}`} fill="none" stroke="#2b2b36" strokeWidth={1} />
            </pattern>
            {pointsWithSignal.map((point, index) => {
              const latest = latestScans(point);
              const strongest = latest.reduce<number | null>(
                (best, scan) => (best === null || scan.rssi > best ? scan.rssi : best),
                null,
              );
              const color = rssiColor(strongest);
              return (
                <radialGradient key={`grad-${point.id}`} id={`wifi-heat-${index}`}>
                  <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                  <stop offset="45%" stopColor={color} stopOpacity={0.26} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </radialGradient>
              );
            })}
          </defs>

          <rect x={0} y={0} width={doc.width} height={doc.height} fill="#0e0e14" />
          <rect x={0} y={0} width={doc.width} height={doc.height} fill="url(#wifi-grid-major)" />

          {heatmap && (
            <g style={coverage ? { filter: "blur(10px)" } : undefined} className="pointer-events-none">
              {pointsWithSignal.map((point, index) => {
                const latest = latestScans(point);
                const strongest = latest.reduce<number | null>(
                  (best, scan) => (best === null || scan.rssi > best ? scan.rssi : best),
                  null,
                );
                if (strongest === null) return null;
                const radius = clamp(120 + (strongest + 95) * 4.5, 110, 330);
                return (
                  <circle
                    key={`heat-${point.id}`}
                    cx={point.x}
                    cy={point.y}
                    r={radius}
                    fill={coverage ? `url(#wifi-heat-${index})` : rssiColor(strongest)}
                    opacity={coverage ? 1 : 0.16}
                  />
                );
              })}
            </g>
          )}

          <rect
            x={0}
            y={0}
            width={doc.width}
            height={doc.height}
            fill="none"
            stroke="#353540"
            strokeWidth={2}
            className="pointer-events-none"
          />

          <g>{doc.shapes.map(renderShape)}</g>

          {draft && (
            <g className="pointer-events-none" stroke="#aac7ff" strokeWidth={1.6} strokeDasharray="5 3" fill="none">
              {draft.tool === "line" && (
                <line x1={draft.start.x} y1={draft.start.y} x2={draft.current.x} y2={draft.current.y} />
              )}
              {draft.tool === "rect" && (
                <rect
                  x={Math.min(draft.start.x, draft.current.x)}
                  y={Math.min(draft.start.y, draft.current.y)}
                  width={Math.abs(draft.current.x - draft.start.x)}
                  height={Math.abs(draft.current.y - draft.start.y)}
                />
              )}
              {draft.tool === "circle" && (
                <circle
                  cx={draft.start.x}
                  cy={draft.start.y}
                  r={Math.hypot(draft.current.x - draft.start.x, draft.current.y - draft.start.y)}
                />
              )}
            </g>
          )}

          <g>
            {doc.points.map((point) => {
              const latest = latestScans(point);
              const strongest = latest.reduce<MapScan | null>(
                (best, scan) => (best === null || scan.rssi > best.rssi ? scan : best),
                null,
              );
              const rssi = strongest?.rssi ?? null;
              const color = rssiColor(rssi);
              const active = point.id === selectedPointId;
              return (
                <g
                  key={point.id}
                  role="button"
                  aria-label={`Measurement point ${point.label}${rssi === null ? ", no sample" : `, ${rssi} dBm`}`}
                  className={tool === "select" ? "cursor-move" : "cursor-pointer"}
                  onPointerDown={(event) => startPointDrag(event, point)}
                >
                  <circle cx={point.x} cy={point.y} r={15} fill="transparent" />
                  {active && (
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={19}
                      fill={color}
                      fillOpacity={0.12}
                      stroke={color}
                      strokeDasharray="3 2.5"
                      strokeWidth={1.4}
                    />
                  )}
                  <circle cx={point.x} cy={point.y} r={9} fill={color} fillOpacity={0.24} />
                  <circle cx={point.x} cy={point.y} r={4.6} fill={color} stroke="#0e0e14" strokeWidth={1.2} />
                  <text
                    x={point.x}
                    y={point.y - 13}
                    textAnchor="middle"
                    fontSize={9.5}
                    fontWeight={600}
                    fill="#e4e1ea"
                    style={{ userSelect: "none" }}
                  >
                    {point.label}
                  </text>
                  <text
                    x={point.x}
                    y={point.y + 21}
                    textAnchor="middle"
                    fontSize={8.5}
                    fontFamily="JetBrains Mono, SF Mono, monospace"
                    fill={color}
                    style={{ userSelect: "none" }}
                  >
                    {rssi === null ? "no sample" : `${rssi} dBm`}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex items-center gap-2.5 rounded-lg border border-white/[0.07] bg-black/65 px-2.5 py-1.5 font-mono text-[10px] text-on-variant backdrop-blur-md">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary shadow-[0_0_8px_rgba(48,209,88,0.7)]" />
            {doc.points.length > 0 ? `${doc.points.length} pts` : "No points"}
          </span>
          <span className="h-3 w-px bg-white/15" />
          <span>
            X {cursor ? cursor.x.toFixed(1) : "—"} · Y {cursor ? cursor.y.toFixed(1) : "—"}
          </span>
          <span className="h-3 w-px bg-white/15" />
          <span>{(view.zoom).toFixed(2)}×</span>
        </div>

        <div className="pointer-events-none absolute bottom-2.5 right-2.5 w-40 rounded-lg border border-white/[0.07] bg-black/65 px-2 py-1.5 backdrop-blur-md">
          <div className="flex items-center justify-between font-mono text-[9px] text-outline">
            <span>-30</span>
            <span>RSSI dBm</span>
            <span>-90</span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-gradient-to-r from-secondary via-primary-container to-error" />
          <div className="mt-1 flex items-center justify-between text-[8.5px] text-outline">
            <span>Optimal</span>
            <span>Deadzone</span>
          </div>
        </div>

        {doc.points.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
            <div className="rounded-xl border border-white/[0.08] bg-black/55 px-4 py-2.5 text-center backdrop-blur-md">
              <p className="text-[12px] font-medium text-on-surface">Blank plan — draw the envelope first</p>
              <p className="mt-0.5 text-[11px] text-outline">
                Press <span className="font-mono text-on-variant">R</span> for rooms or{" "}
                <span className="font-mono text-on-variant">P</span>, then click, to drop a measurement point.
              </p>
            </div>
          </div>
        )}

        {selectedPointId === null && doc.points.length > 0 && (
          <div className="pointer-events-none absolute left-2.5 top-2.5">
            <Badge tone="neutral" mono>
              click a point to inspect
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
