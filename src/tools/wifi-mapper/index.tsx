import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  Circle,
  FileText,
  Map as MapIcon,
  MapPin,
  Minus,
  MousePointer2,
  Plus,
  Radar,
  RefreshCw,
  Save,
  Square,
  Trash2,
  Type,
  Wifi,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, SectionLabel } from "@/components/ui/Card";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorNotice, Skeleton, Spinner } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Tabs } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { network } from "@/lib/api";
import { cmd, errorMessage } from "@/lib/ipc";
import { clockTime, plural, relative, rssiQuality } from "@/lib/format";
import type { MapPoint, MapScan, MapShape, MapSummary, WifiMapDoc } from "@/lib/types";
import { MapCanvas } from "./components/MapCanvas";
import { ReportView, type CoverageRow } from "./components/ReportView";
import {
  analyzeChannels,
  coverageCsv,
  downloadText,
  latestScans,
  networkName,
  networkStats,
  newId,
  nextPointLabel,
  round,
  rssiColor,
  siteAverageRssi,
  slugify,
  summarizePoint,
  type Vec,
} from "./lib/analysis";
import { TOOL_BY_KEY, TOOL_LABELS, TOOL_ORDER, TOOL_SHORTCUTS, type MapTool } from "./lib/tools";

/**
 * capture_point_scans is wired in Rust but not re-exported by the shared
 * `network` client, so this view calls it through the IPC primitive directly.
 * No shared file is modified.
 */
const capturePointScans = () => cmd<MapScan[]>("capture_point_scans");

type Tab = "plan" | "report";

type Pending =
  | { kind: "point"; id: string; name: string }
  | { kind: "shape"; id: string; name: string }
  | { kind: "map"; id: string; name: string }
  | { kind: "discard"; id: string; name: string };

const EMPTY_POINTS: MapPoint[] = [];

function toolIcon(tool: MapTool) {
  switch (tool) {
    case "select":
      return <MousePointer2 size={15} />;
    case "line":
      return <Minus size={16} />;
    case "rect":
      return <Square size={15} />;
    case "circle":
      return <Circle size={15} />;
    case "text":
      return <Type size={15} />;
    case "point":
      return <MapPin size={15} />;
  }
}

function newShapeId(): string {
  return newId("shape");
}

export default function WifiMapperView() {
  const [doc, setDoc] = useState<WifiMapDoc | null>(null);
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMapId, setLoadingMapId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("plan");
  const [tool, setTool] = useState<MapTool>("select");
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [heatmap, setHeatmap] = useState(true);
  const [coverage, setCoverage] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await network.maps();
      setMaps(list);
      const first = list[0];
      if (first) {
        const loaded = await network.loadMap(first.id);
        setDoc(loaded);
        setLastSaved(loaded.updatedAt);
        setDirty(false);
        setSelectedPointId(null);
        setSelectedShapeId(null);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const refreshList = useCallback(async () => {
    try {
      const list = await network.maps();
      setMaps(list);
    } catch (err) {
      toast.error("Could not list maps", errorMessage(err));
    }
  }, []);

  const points = doc?.points ?? EMPTY_POINTS;
  const coverageRows = useMemo<CoverageRow[]>(
    () => points.map((point) => ({ point, summary: summarizePoint(point) })),
    [points],
  );
  const networks = useMemo(() => networkStats(points), [points]);
  const channelAnalysis = useMemo(() => analyzeChannels(points), [points]);
  const siteAverage = useMemo(() => siteAverageRssi(points), [points]);
  const scannedCount = coverageRows.filter((row) => row.summary.strongest !== null).length;

  const selectedPoint = useMemo(
    () => (selectedPointId ? (doc?.points.find((point) => point.id === selectedPointId) ?? null) : null),
    [doc, selectedPointId],
  );
  const selectedSummary = useMemo(() => (selectedPoint ? summarizePoint(selectedPoint) : null), [selectedPoint]);
  const selectedScans = useMemo(
    () => (selectedPoint ? [...latestScans(selectedPoint)].sort((a, b) => b.rssi - a.rssi) : []),
    [selectedPoint],
  );
  const channelOccupancy = useMemo(() => {
    const counts = new Map<number, number>();
    for (const scan of selectedScans) {
      if (scan.channel === null) continue;
      counts.set(scan.channel, (counts.get(scan.channel) ?? 0) + 1);
    }
    return counts;
  }, [selectedScans]);

  const touch = useCallback((updater: (current: WifiMapDoc) => WifiMapDoc) => {
    setDoc((prev) => (prev ? { ...updater(prev), updatedAt: new Date().toISOString() } : prev));
    setDirty(true);
  }, []);

  /* --------------------------------- maps --------------------------------- */

  const saveMap = useCallback(async () => {
    if (!doc || saving) return;
    setSaving(true);
    const updatedAt = new Date().toISOString();
    const stamped: WifiMapDoc = { ...doc, updatedAt };
    try {
      const summary = await network.saveMap(stamped);
      setDoc(stamped);
      setDirty(false);
      setLastSaved(updatedAt);
      setMaps((prev) => [summary, ...prev.filter((item) => item.id !== summary.id)]);
      toast.success("Map saved", `${summary.name} · ${plural(summary.pointCount, "point")}`);
    } catch (err) {
      toast.error("Could not save map", errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [doc, saving]);

  const openMap = useCallback(async (id: string) => {
    setLoadingMapId(id);
    try {
      const loaded = await network.loadMap(id);
      setDoc(loaded);
      setDirty(false);
      setLastSaved(loaded.updatedAt);
      setSelectedPointId(null);
      setSelectedShapeId(null);
      setScanError(null);
      setTab("plan");
    } catch (err) {
      toast.error("Could not open map", errorMessage(err));
    } finally {
      setLoadingMapId(null);
    }
  }, []);

  const requestMap = (id: string) => {
    if (!doc || id === doc.id) return;
    if (dirty) {
      setPending({ kind: "discard", id, name: maps.find((item) => item.id === id)?.name ?? "another map" });
      return;
    }
    void openMap(id);
  };

  const createMap = () => {
    const now = new Date().toISOString();
    const next: WifiMapDoc = {
      id: newId("map"),
      name: "Untitled survey",
      description: "",
      width: 1000,
      height: 650,
      shapes: [],
      points: [],
      createdAt: now,
      updatedAt: now,
    };
    setDoc(next);
    setDirty(true);
    setLastSaved(null);
    setTab("plan");
    setTool("select");
    setSelectedPointId(null);
    setSelectedShapeId(null);
    setScanError(null);
    toast.info("Draft plan created", "Draw the envelope, drop points, then save it to disk.");
  };

  const confirmPending = async () => {
    if (!pending) return;
    const action = pending;

    if (action.kind === "point" || action.kind === "shape") {
      setDoc((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          updatedAt: new Date().toISOString(),
          points: action.kind === "point" ? prev.points.filter((point) => point.id !== action.id) : prev.points,
          shapes: action.kind === "shape" ? prev.shapes.filter((shape) => shape.id !== action.id) : prev.shapes,
        };
      });
      if (action.kind === "point" && selectedPointId === action.id) setSelectedPointId(null);
      if (action.kind === "shape" && selectedShapeId === action.id) setSelectedShapeId(null);
      setDirty(true);
      setPending(null);
      toast.info(action.kind === "point" ? "Point deleted" : "Shape deleted", action.name);
      return;
    }

    if (action.kind === "discard") {
      setPending(null);
      await openMap(action.id);
      return;
    }

    setPendingBusy(true);
    try {
      await network.deleteMap(action.id);
      const list = await network.maps();
      setMaps(list);
      setDoc(null);
      setDirty(false);
      setLastSaved(null);
      setSelectedPointId(null);
      setSelectedShapeId(null);
      const first = list[0];
      if (first) {
        const loaded = await network.loadMap(first.id);
        setDoc(loaded);
        setLastSaved(loaded.updatedAt);
      }
      toast.success("Map deleted", action.name);
    } catch (err) {
      toast.error("Could not delete map", errorMessage(err));
    } finally {
      setPendingBusy(false);
      setPending(null);
    }
  };

  /* -------------------------------- geometry ------------------------------- */

  const addPoint = useCallback((position: Vec) => {
    const id = newId("pt");
    setDoc((prev) => {
      if (!prev) return prev;
      const point: MapPoint = {
        id,
        x: round(position.x, 1),
        y: round(position.y, 1),
        label: nextPointLabel(prev.points),
        createdAt: new Date().toISOString(),
        scans: [],
      };
      return { ...prev, points: [...prev.points, point], updatedAt: new Date().toISOString() };
    });
    setSelectedPointId(id);
    setSelectedShapeId(null);
    setDirty(true);
  }, []);

  const addShape = useCallback(
    (shape: MapShape) => {
      touch((current) => ({ ...current, shapes: [...current.shapes, shape] }));
      setSelectedShapeId(shape.id);
      setSelectedPointId(null);
    },
    [touch],
  );

  const movePoint = useCallback(
    (id: string, x: number, y: number) => {
      setDoc((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          points: prev.points.map((point) => (point.id === id ? { ...point, x, y } : point)),
          updatedAt: new Date().toISOString(),
        };
      });
      setDirty(true);
    },
    [],
  );

  const commitText = () => {
    if (!textDraft) return;
    const label = textDraft.value.trim();
    if (!label) return;
    addShape({
      id: newShapeId(),
      kind: "text",
      points: [{ x: textDraft.x, y: textDraft.y }],
      label,
      color: null,
    });
    setTextDraft(null);
  };

  /* --------------------------------- scans -------------------------------- */

  const scanHere = useCallback(async () => {
    if (!doc || scanning) return;
    setScanning(true);
    setScanError(null);
    const existing = selectedPointId ? (doc.points.find((point) => point.id === selectedPointId) ?? null) : null;
    const targetId = existing?.id ?? newId("pt");
    const isNew = existing === null;
    try {
      const scans = await capturePointScans();
      if (scans.length === 0) {
        toast.warning("No beacons captured", "The adapter returned an empty scan. Check Wi-Fi and Location permission.");
        return;
      }
      const createdAt = new Date().toISOString();
      setDoc((prev) => {
        if (!prev) return prev;
        if (isNew) {
          const point: MapPoint = {
            id: targetId,
            x: round(prev.width / 2, 1),
            y: round(prev.height / 2, 1),
            label: nextPointLabel(prev.points),
            createdAt,
            scans,
          };
          return { ...prev, points: [...prev.points, point], updatedAt: createdAt };
        }
        return {
          ...prev,
          updatedAt: createdAt,
          points: prev.points.map((point) =>
            point.id === targetId ? { ...point, scans: [...point.scans, ...scans] } : point,
          ),
        };
      });
      setSelectedPointId(targetId);
      setSelectedShapeId(null);
      setDirty(true);
      setTab("plan");
      const strongest = scans.reduce((best, scan) => (scan.rssi > best.rssi ? scan : best), scans[0] as MapScan);
      toast.success(
        `Sample recorded · ${plural(scans.length, "beacon")}`,
        `${networkName(strongest)} ${strongest.rssi} dBm${isNew ? " · new point created" : ""}`,
      );
    } catch (err) {
      const message = errorMessage(err);
      setScanError(message);
      toast.error("Scan failed", message);
    } finally {
      setScanning(false);
    }
  }, [doc, scanning, selectedPointId]);

  /* -------------------------------- exports -------------------------------- */

  const exportJson = () => {
    if (!doc) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      application: "shift-tools",
      map: doc,
      coverage: coverageRows.map((row) => ({
        point: row.point.label,
        x: row.point.x,
        y: row.point.y,
        samples: row.summary.samples,
        beacons: row.summary.beacons,
        strongest: row.summary.strongestName,
        rssi: row.summary.strongest?.rssi ?? null,
        averageRssi: row.summary.averageRssi === null ? null : round(row.summary.averageRssi, 1),
        channels: row.summary.channels,
        band: row.summary.band,
        quality: row.summary.quality.label,
      })),
      networks,
      channelAnalysis,
    };
    downloadText(`${slugify(doc.name)}-wifi-survey.json`, JSON.stringify(payload, null, 2), "application/json");
    toast.success("JSON exported", `${doc.name} · ${plural(doc.points.length, "point")}`);
  };

  const exportCsv = () => {
    if (!doc) return;
    downloadText(`${slugify(doc.name)}-coverage.csv`, coverageCsv(doc), "text/csv");
    toast.success("Coverage CSV exported", `${plural(doc.points.length, "point")} · latest samples`);
  };

  /* ------------------------------- shortcuts ------------------------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveMap();
        return;
      }
      if (typing || pending !== null || textDraft !== null) return;

      const nextTool = TOOL_BY_KEY[event.key.toLowerCase()];
      if (nextTool) {
        event.preventDefault();
        setTool(nextTool);
        return;
      }
      if (event.key === "Escape") {
        setTool("select");
        setSelectedPointId(null);
        setSelectedShapeId(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedPointId && doc) {
          const point = doc.points.find((item) => item.id === selectedPointId);
          if (point) {
            event.preventDefault();
            setPending({ kind: "point", id: point.id, name: point.label });
          }
          return;
        }
        if (selectedShapeId && doc) {
          const shape = doc.shapes.find((item) => item.id === selectedShapeId);
          if (shape) {
            event.preventDefault();
            setPending({ kind: "shape", id: shape.id, name: shape.kind });
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, pending, textDraft, selectedPointId, selectedShapeId, saveMap]);

  /* --------------------------------- header -------------------------------- */

  const mapOptions = [
    ...(doc && !maps.some((item) => item.id === doc.id) ? [{ value: doc.id, label: `${doc.name} · unsaved` }] : []),
    ...maps.map((item) => ({ value: item.id, label: `${item.name} · ${plural(item.pointCount, "pt")}` })),
  ];

  const siteTone = siteAverage === null ? "neutral" : rssiQuality(siteAverage).tone;
  const sampledTone = points.length > 0 && scannedCount === points.length ? "success" : points.length === 0 ? "neutral" : "warning";

  const pendingTitle =
    pending?.kind === "point"
      ? `Delete ${pending.name}?`
      : pending?.kind === "shape"
        ? "Delete the selected shape?"
        : pending?.kind === "map"
          ? `Delete ${pending.name}?`
          : "Discard unsaved changes?";

  const pendingMessage =
    pending?.kind === "point"
      ? `The point and its ${plural(
          doc?.points.find((point) => point.id === pending.id)?.scans.length ?? 0,
          "stored scan",
        )} are removed from ${doc?.name ?? "this map"}. This cannot be undone.`
      : pending?.kind === "shape"
        ? "The selected floor-plan shape is removed. Measurement points are not affected."
        : pending?.kind === "map"
          ? `"${pending.name}" and its ${plural(doc?.points.length ?? 0, "measurement point")} are deleted from disk. This cannot be undone.`
          : `"${doc?.name ?? "This map"}" has unsaved changes. Opening "${pending?.name ?? "another map"}" discards them.`;

  return (
    <>
      <ToolView
        eyebrow="SITE SURVEY"
        eyebrowTone="success"
        eyebrowHint="FLOORPLAN · RSSI HEATMAP"
        title="WiFi Mapper"
        description="Draw a floor plan, capture signal at each measurement point, and generate a coverage report."
        telemetry={[
          { label: "Survey points", value: `${points.length}`, tone: "primary", icon: <MapPin size={14} /> },
          { label: "BSSIDs", value: `${networks.length}`, tone: "tertiary", icon: <Wifi size={14} /> },
          {
            label: "Site average",
            value: siteAverage === null ? "—" : `${siteAverage.toFixed(0)} dBm`,
            tone: siteTone,
            icon: <Radar size={14} />,
          },
          {
            label: "Sampled",
            value: `${scannedCount}/${points.length}`,
            tone: sampledTone,
            icon: <MapIcon size={14} />,
          },
        ]}
        toolbar={
          <>
            {mapOptions.length > 0 && (
              <div className="w-52">
                <Select
                  aria-label="Load a saved map"
                  value={doc?.id ?? ""}
                  onChange={(event) => requestMap(event.target.value)}
                  options={mapOptions}
                  sizeVariant="sm"
                  disabled={loadingMapId !== null}
                />
              </div>
            )}
            <Button icon={<Plus size={13} />} onClick={createMap} disabled={loading}>
              New map
            </Button>
            <Button
              variant="primary"
              icon={<Save size={13} />}
              loading={saving}
              disabled={!doc || !dirty}
              onClick={() => void saveMap()}
              trailing={<Kbd>⌘S</Kbd>}
            >
              Save map
            </Button>
          </>
        }
        status={
          <>
            <Badge tone={dirty ? "warning" : lastSaved ? "success" : "neutral"} dot>
              {dirty ? "Unsaved changes" : lastSaved ? `Saved ${relative(lastSaved)}` : doc ? "Draft map" : "No map loaded"}
            </Badge>
            <IconButton
              label="Reload map list"
              icon={loading ? <Spinner size={13} /> : <RefreshCw size={13} />}
              onClick={() => void refreshList()}
              disabled={loading}
            />
          </>
        }
      >
        {loadError && (
          <ErrorNotice title="Map storage unavailable" message={loadError} onRetry={() => void bootstrap()} />
        )}

        <div className="flex items-center justify-between gap-2">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            ariaLabel="WiFi mapper views"
            items={[
              { value: "plan", label: "Floor plan", icon: <MapIcon size={12} /> },
              { value: "report", label: "Report", icon: <FileText size={12} />, count: points.length },
            ]}
          />
          <span className="font-mono text-[10px] text-outline">
            {doc ? `${doc.shapes.length} shapes · ${doc.points.length} points · ${doc.width}×${doc.height} u` : ""}
          </span>
        </div>

        {loading ? (
          <Card className="flex min-h-[420px] flex-1 flex-col gap-2 p-3" aria-busy="true">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="min-h-[300px] flex-1" />
            <span className="sr-only">Loading saved floor plans</span>
          </Card>
        ) : !doc ? (
          <Card className="flex min-h-[420px] flex-1 items-center justify-center p-4">
            <EmptyState
              icon={<MapIcon size={18} />}
              title="No floor plans yet"
              description="Create a plan, draw the walls, then capture RSSI at each measurement point. Maps are saved by the native app and listed here next time."
              action={
                <div className="flex items-center gap-2">
                  <Button variant="primary" icon={<Plus size={13} />} onClick={createMap}>
                    Create floor plan
                  </Button>
                  <Button icon={<RefreshCw size={13} />} onClick={() => void bootstrap()}>
                    Reload
                  </Button>
                </div>
              }
            />
          </Card>
        ) : tab === "report" ? (
          <ReportView
            doc={doc}
            coverage={coverageRows}
            networks={networks}
            channels={channelAnalysis}
            saving={saving}
            dirty={dirty}
            onSave={() => void saveMap()}
            onExportJson={exportJson}
            onExportCsv={exportCsv}
            onSelectPoint={(id) => {
              setSelectedPointId(id);
              setSelectedShapeId(null);
              setTab("plan");
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
            <div
              role="toolbar"
              aria-label="Plan drawing tools"
              className="flex shrink-0 items-center gap-1 self-start rounded-xl border border-white/[0.055] bg-black/30 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] xl:flex-col"
            >
              {TOOL_ORDER.map((item) => (
                <IconButton
                  key={item}
                  label={`${TOOL_LABELS[item]} (${TOOL_SHORTCUTS[item]})`}
                  icon={toolIcon(item)}
                  active={tool === item}
                  onClick={() => setTool(item)}
                />
              ))}
              <span className="mx-1 hidden h-px w-6 bg-white/10 xl:mx-0 xl:my-1 xl:block" />
              <span className="hidden select-none font-mono text-[9px] text-outline xl:block">V L R C T P</span>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <MapCanvas
                doc={doc}
                tool={tool}
                selectedPointId={selectedPointId}
                selectedShapeId={selectedShapeId}
                heatmap={heatmap}
                coverage={coverage}
                onHeatmapChange={setHeatmap}
                onCoverageChange={setCoverage}
                onSelectPoint={setSelectedPointId}
                onSelectShape={setSelectedShapeId}
                onMovePoint={movePoint}
                onAddPoint={addPoint}
                onAddShape={addShape}
                onRequestText={(position) => setTextDraft({ x: position.x, y: position.y, value: "" })}
              />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 font-mono text-[10px] text-outline">
                <span>
                  Surveyed <span className="text-on-surface">{scannedCount}/{points.length}</span> points
                </span>
                <span>
                  Beacons{" "}
                  <span className="text-on-surface">
                    {coverageRows.reduce((sum, row) => sum + row.summary.beacons, 0)}
                  </span>
                </span>
                <span>
                  Heatmap <span className="text-primary-soft">{heatmap ? "on" : "off"}</span> · coverage{" "}
                  <span className="text-primary-soft">{coverage ? "radial" : "flat"}</span>
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <Kbd>Del</Kbd> remove selection
                </span>
              </div>
            </div>

            <aside className="flex w-full shrink-0 flex-col gap-3 xl:w-[320px] 2xl:w-[340px]">
              <Card className="space-y-2.5 p-3">
                <SectionLabel trailing={<Badge tone="neutral" mono>{plural(doc.points.length, "pt")}</Badge>}>
                  Survey map
                </SectionLabel>
                <Field label="Map name">
                  <Input
                    aria-label="Map name"
                    sizeVariant="sm"
                    value={doc.name}
                    onChange={(event) => touch((current) => ({ ...current, name: event.target.value }))}
                  />
                </Field>
                <Field label="Description" hint="Stored with the map and shown in the saved list.">
                  <Textarea
                    aria-label="Map description"
                    rows={2}
                    value={doc.description}
                    placeholder="Floor, building, or survey campaign notes…"
                    onChange={(event) => touch((current) => ({ ...current, description: event.target.value }))}
                  />
                </Field>
                <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2 text-[10px] text-outline">
                  <span>
                    Tool{" "}
                    <span className="font-mono text-primary-soft">
                      {TOOL_LABELS[tool]} · {TOOL_SHORTCUTS[tool]}
                    </span>
                  </span>
                  <span className="font-mono">{lastSaved ? relative(lastSaved) : "not saved"}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="xs" icon={<Plus size={11} />} onClick={() => addPoint({ x: doc.width / 2, y: doc.height / 2 })}>
                    Point at centre
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<Trash2 size={11} />}
                    onClick={() => setPending({ kind: "map", id: doc.id, name: doc.name })}
                    disabled={!maps.some((item) => item.id === doc.id)}
                  >
                    Delete map
                  </Button>
                </div>
              </Card>

              <Card className="space-y-2 p-3">
                <SectionLabel trailing={<Badge tone="neutral" mono>{doc.points.length}</Badge>}>
                  Measurement points
                </SectionLabel>
                {doc.points.length === 0 ? (
                  <p className="text-[11px] leading-relaxed text-outline">
                    Select the point tool <Kbd>P</Kbd> and click the plan, or use “Point at centre”.
                  </p>
                ) : (
                  <div className="max-h-52 space-y-0.5 overflow-y-auto pr-0.5">
                    {doc.points.map((point) => {
                      const summary = summarizePoint(point);
                      const active = point.id === selectedPointId;
                      return (
                        <div
                          key={point.id}
                          className={clsx(
                            "group flex items-center gap-1 rounded-md border pr-0.5 transition-colors",
                            active
                              ? "border-primary/30 bg-primary/[0.12]"
                              : "border-transparent hover:bg-white/[0.04]",
                          )}
                        >
                          <button
                            type="button"
                            aria-label={`Select point ${point.label}`}
                            aria-pressed={active}
                            onClick={() => {
                              setSelectedPointId(point.id);
                              setSelectedShapeId(null);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left"
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: rssiColor(summary.strongest?.rssi ?? null) }}
                            />
                            <span className="truncate font-mono text-[11px] text-on-surface">{point.label}</span>
                            <span className="ml-auto shrink-0 font-mono text-[10px] tnum text-outline">
                              {summary.strongest ? `${summary.strongest.rssi} dBm` : "no sample"}
                            </span>
                          </button>
                          <IconButton
                            label={`Delete point ${point.label}`}
                            size="sm"
                            tone="danger"
                            icon={<Trash2 size={11} />}
                            onClick={() => setPending({ kind: "point", id: point.id, name: point.label })}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card className="space-y-2.5 p-3">
                <SectionLabel
                  trailing={
                    selectedSummary ? <Badge tone={selectedSummary.quality.tone}>{selectedSummary.quality.label}</Badge> : undefined
                  }
                >
                  Selected point
                </SectionLabel>

                {!selectedPoint || !selectedSummary ? (
                  <EmptyState
                    compact
                    icon={<MapPin size={16} />}
                    title="No point selected"
                    description="Click a marker on the plan. Scanning with nothing selected records a new point at the centre."
                  />
                ) : (
                  <>
                    <Field label="Label">
                      <Input
                        aria-label="Point label"
                        sizeVariant="sm"
                        value={selectedPoint.label}
                        onChange={(event) =>
                          touch((current) => ({
                            ...current,
                            points: current.points.map((point) =>
                              point.id === selectedPoint.id ? { ...point, label: event.target.value } : point,
                            ),
                          }))
                        }
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-outline">
                      <span>X {selectedPoint.x.toFixed(1)}</span>
                      <span>Y {selectedPoint.y.toFixed(1)}</span>
                      <span>{plural(selectedSummary.samples, "sample")}</span>
                      <span>{plural(selectedSummary.beacons, "beacon")}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="rounded-lg border border-white/[0.05] bg-black/30 px-2 py-1.5">
                        <div className="text-[8.5px] font-semibold uppercase tracking-[0.08em] text-outline">Strongest</div>
                        <div
                          className="font-mono text-[13px] font-semibold tnum"
                          style={{ color: rssiColor(selectedSummary.strongest?.rssi ?? null) }}
                        >
                          {selectedSummary.strongest?.rssi ?? "—"}
                          <span className="ml-0.5 text-[8.5px] font-normal text-outline">dBm</span>
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/[0.05] bg-black/30 px-2 py-1.5">
                        <div className="text-[8.5px] font-semibold uppercase tracking-[0.08em] text-outline">Average</div>
                        <div className="font-mono text-[13px] font-semibold text-on-surface tnum">
                          {selectedSummary.averageRssi === null ? "—" : selectedSummary.averageRssi.toFixed(0)}
                          <span className="ml-0.5 text-[8.5px] font-normal text-outline">dBm</span>
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/[0.05] bg-black/30 px-2 py-1.5">
                        <div className="text-[8.5px] font-semibold uppercase tracking-[0.08em] text-outline">Channel</div>
                        <div className="font-mono text-[13px] font-semibold text-primary-soft tnum">
                          {selectedSummary.strongest?.channel ?? "—"}
                          <span className="ml-0.5 text-[8.5px] font-normal text-outline">
                            {selectedSummary.band ?? ""}
                          </span>
                        </div>
                      </div>
                    </div>
                    {selectedSummary.strongestName && (
                      <p className="truncate text-[10.5px] text-outline">
                        Strongest network <span className="text-on-variant">{selectedSummary.strongestName}</span>
                        {selectedSummary.snr !== null ? ` · SNR ${selectedSummary.snr} dB` : ""}
                      </p>
                    )}

                    {selectedScans.length > 0 && (
                      <div className="space-y-1 border-t border-white/[0.06] pt-2">
                        <div className="flex items-center justify-between text-[10px] text-outline">
                          <span>Latest beacons</span>
                          <span className="font-mono">{clockTime(selectedSummary.scannedAt)}</span>
                        </div>
                        <div className="max-h-40 space-y-0.5 overflow-y-auto pr-0.5">
                          {selectedScans.map((scan, index) => {
                            const shared = scan.channel !== null && (channelOccupancy.get(scan.channel) ?? 0) > 1;
                            return (
                              <div
                                key={`${scan.bssid ?? scan.ssid ?? "scan"}-${scan.channel ?? "?"}-${index}`}
                                className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-white/[0.03]"
                              >
                                <span
                                  className="h-1 w-1 shrink-0 rounded-full"
                                  style={{ background: rssiColor(scan.rssi) }}
                                />
                                <span className="min-w-0 flex-1 truncate text-[10.5px] text-on-variant" title={scan.ssid ?? undefined}>
                                  {networkName(scan)}
                                </span>
                                {shared && <Badge tone="warning" className="h-4 px-1 text-[8.5px]">co-ch</Badge>}
                                <span className="font-mono text-[10px] tnum" style={{ color: rssiColor(scan.rssi) }}>
                                  {scan.rssi}
                                </span>
                                <span className="w-7 text-right font-mono text-[9px] text-outline">
                                  {scan.channel ?? "—"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <Button block variant="primary" icon={<Radar size={13} />} loading={scanning} onClick={() => void scanHere()}>
                  Scan here
                </Button>
                {scanError && (
                  <ErrorNotice title="Capture failed" message={scanError} onRetry={() => void scanHere()} retryLabel="Retry" />
                )}
                {selectedPoint && (
                  <Button
                    block
                    size="xs"
                    variant="destructive"
                    icon={<Trash2 size={11} />}
                    onClick={() => setPending({ kind: "point", id: selectedPoint.id, name: selectedPoint.label })}
                  >
                    Delete point
                  </Button>
                )}
              </Card>
            </aside>
          </div>
        )}
      </ToolView>

      <Modal
        open={textDraft !== null}
        onClose={() => setTextDraft(null)}
        title="Add plan label"
        description="The label is placed where you clicked the plan. Use it for room names, zones, or access-point positions."
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTextDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={commitText} disabled={!textDraft?.value.trim()}>
              Add label
            </Button>
          </>
        }
      >
        <Field label="Label text" htmlFor="wifi-mapper-label">
          <Input
            id="wifi-mapper-label"
            autoFocus
            data-autofocus
            value={textDraft?.value ?? ""}
            placeholder="Boardroom, AP-1, dead zone…"
            onChange={(event) =>
              setTextDraft((prev) => (prev ? { ...prev, value: event.target.value } : prev))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitText();
              }
            }}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={pending !== null}
        busy={pendingBusy}
        destructive
        title={pendingTitle}
        message={pendingMessage}
        confirmLabel={
          pending?.kind === "map" ? "Delete map" : pending?.kind === "discard" ? "Discard and open" : "Delete"
        }
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
