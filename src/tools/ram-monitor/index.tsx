import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  Cpu,
  Gauge,
  HardDrive,
  Layers,
  MemoryStick,
  Pause,
  Play,
  RefreshCw,
  Search,
  Skull,
  Zap,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input, SegmentedControl, Switch } from "@/components/ui/Form";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorNotice, InfoNotice, Meter, Progress, Skeleton } from "@/components/ui/Feedback";
import { Sparkline } from "@/components/ui/Charts";
import { toast } from "@/components/ui/Toast";
import { system } from "@/lib/api";
import { errorMessage } from "@/lib/ipc";
import { bytes, clockTime, duration, number, percent, plural } from "@/lib/format";
import type { RamProcess, RamSnapshot, SystemStats } from "@/lib/types";

const SAMPLE_MS = 2000;
const MAX_SAMPLES = 60;

type Pressure = RamSnapshot["pressure"];
type FilterValue = "all" | "heavy" | "dev";

const PRESSURE: Record<Pressure, { label: string; tone: Tone; note: string }> = {
  normal: {
    label: "Normal",
    tone: "success",
    note: "More than 25% of physical RAM is available. The compressor is holding steady.",
  },
  warning: {
    label: "Warning",
    tone: "warning",
    note: "Available memory dropped below 25%. Reclaim the heaviest consumers before the swap file starts growing.",
  },
  critical: {
    label: "Critical",
    tone: "error",
    note: "Available memory is below 10%. The kernel is compressing and swapping aggressively — expect stalls.",
  },
};

const CATEGORY_TONE: Record<RamProcess["category"], Tone> = {
  python: "primary",
  node: "success",
  rust: "tertiary",
  java: "warning",
  swift: "primary",
  go: "success",
  ruby: "tertiary",
  build: "warning",
  server: "tertiary",
  mobile: "primary",
  container: "success",
  other: "neutral",
};

function pct(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function KpiTile({
  label,
  value,
  suffix,
  detail,
  tone,
  icon,
  bar,
  barTone,
  loading,
}: {
  label: string;
  value: string;
  suffix: string;
  detail: string;
  tone: Tone;
  icon: ReactNode;
  bar: number;
  barTone: "primary" | "success" | "warning" | "error" | "tertiary";
  loading: boolean;
}) {
  const toneClass = {
    neutral: "text-on-surface",
    primary: "text-primary-soft",
    success: "text-secondary",
    warning: "text-warning",
    error: "text-error",
    tertiary: "text-tertiary",
  }[tone];

  return (
    <Card className="p-2.5 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</span>
        <span className={clsx("shrink-0", toneClass)}>{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="h-5 w-20" />
      ) : (
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className={clsx("font-mono text-[17px] leading-none font-semibold tnum truncate", toneClass)}>{value}</span>
          <span className="font-mono text-[9.5px] text-outline truncate">{suffix}</span>
        </div>
      )}
      <Progress value={bar} tone={barTone} label={`${label} utilisation`} height={3} />
      <span className="font-mono text-[9.5px] text-outline truncate" title={detail}>
        {detail}
      </span>
    </Card>
  );
}

export default function RamMonitorView() {
  const [snapshot, setSnapshot] = useState<RamSnapshot | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [usedHistory, setUsedHistory] = useState<number[]>([]);
  const [swapHistory, setSwapHistory] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [killTarget, setKillTarget] = useState<RamProcess | null>(null);
  const [killForce, setKillForce] = useState(false);
  const [killing, setKilling] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const [snap, live] = await Promise.all([system.ram(), system.stats()]);
      setSnapshot(snap);
      setStats(live);
      setError(null);
      setUsedHistory((prev) => [...prev, snap.usedBytes].slice(-MAX_SAMPLES));
      setSwapHistory((prev) => [...prev, snap.swapUsedBytes].slice(-MAX_SAMPLES));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => void refresh(true), SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [paused, refresh]);

  const totalBytes = snapshot?.totalBytes ?? 0;
  const pressure = snapshot ? PRESSURE[snapshot.pressure] : PRESSURE.normal;
  const availablePct = snapshot ? pct(snapshot.availableBytes, totalBytes) : 0;

  const split = useMemo(() => {
    if (!snapshot) {
      return { app: 0, wired: 0, compressed: 0, cached: 0, available: 0 };
    }
    const wired = snapshot.wiredBytes;
    const compressed = snapshot.compressedBytes;
    const cached = snapshot.cachedBytes;
    const available = snapshot.availableBytes;
    const app = Math.max(0, snapshot.totalBytes - available - wired - compressed - cached);
    return { app, wired, compressed, cached, available };
  }, [snapshot]);

  const segments = useMemo(
    () => [
      { label: "App memory", value: pct(split.app, totalBytes), tone: "primary" as const, bytes: split.app, dot: "bg-primary" },
      { label: "Wired", value: pct(split.wired, totalBytes), tone: "tertiary" as const, bytes: split.wired, dot: "bg-tertiary" },
      {
        label: "Compressed",
        value: pct(split.compressed, totalBytes),
        tone: "warning" as const,
        bytes: split.compressed,
        dot: "bg-warning",
      },
      { label: "Cached", value: pct(split.cached, totalBytes), tone: "neutral" as const, bytes: split.cached, dot: "bg-white/40" },
      {
        label: "Available",
        value: pct(split.available, totalBytes),
        tone: "success" as const,
        bytes: split.available,
        dot: "bg-secondary",
      },
    ],
    [split, totalBytes],
  );

  const processes = snapshot?.processes ?? [];

  const counts = useMemo(
    () => ({
      all: processes.length,
      heavy: processes.filter((p) => p.memoryBytes >= 500 * 1024 * 1024).length,
      dev: processes.filter((p) => p.category !== "other").length,
    }),
    [processes],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return processes.filter((p) => {
      if (filter === "heavy" && p.memoryBytes < 500 * 1024 * 1024) return false;
      if (filter === "dev" && p.category === "other") return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || String(p.pid).includes(q) || p.category.includes(q);
    });
  }, [processes, filter, query]);

  const filteredBytes = filtered.reduce((sum, p) => sum + p.memoryBytes, 0);
  const topConsumer = processes[0] ?? null;

  const usedPeak = usedHistory.length > 0 ? Math.max(...usedHistory) : 0;
  const usedLow = usedHistory.length > 0 ? Math.min(...usedHistory) : 0;
  const swapPeak = swapHistory.length > 0 ? Math.max(...swapHistory) : 0;
  const swapPct = snapshot ? pct(snapshot.swapUsedBytes, snapshot.swapTotalBytes) : 0;

  // Tight y-range with padding so small movements render as a real slope, not a filled block.
  const usedRange = usedPeak - usedLow;
  const usedPad = Math.max(usedRange * 0.25, usedPeak * 0.01, 1);
  const usedFloor = Math.max(0, usedLow - usedPad);
  const usedCeiling = usedPeak + usedPad;
  const swapFloor = 0;
  const swapRange = swapPeak - swapFloor;
  const swapPad = Math.max(swapRange * 0.25, swapPeak * 0.02, (snapshot?.swapTotalBytes ?? 0) * 0.005, 1);
  const swapCeiling = Math.max(swapPeak + swapPad, 1);

  const openKill = (process: RamProcess) => {
    setKillForce(false);
    setKillTarget(process);
  };

  const executeKill = async () => {
    if (!killTarget) return;
    setKilling(true);
    const target = killTarget;
    try {
      const results = await system.kill([target.pid], killForce);
      const result = results[0];
      if (result?.ok) {
        toast.success(
          `${target.name} terminated`,
          `${bytes(target.memoryBytes)} released · ${result.signal}${killForce ? " (forced)" : ""}`,
        );
      } else {
        toast.error(
          `${target.name} not terminated`,
          result?.error ?? "The backend refused to signal this process.",
        );
      }
      setKillTarget(null);
      await refresh(true);
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error("Kill dispatch failed", message);
    } finally {
      setKilling(false);
    }
  };

  const columns: Column<RamProcess>[] = [
    {
      key: "name",
      header: "Process",
      sortable: true,
      sortValue: (p) => p.name.toLowerCase(),
      render: (p) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 rounded-md bg-white/[0.05] border border-white/[0.06] flex items-center justify-center shrink-0">
            <Zap size={10} className={p.category === "server" ? "text-tertiary" : "text-primary-soft"} />
          </span>
          <span className="text-[12px] font-medium text-on-surface truncate max-w-[220px]" title={p.name}>
            {p.name}
          </span>
        </div>
      ),
    },
    {
      key: "pid",
      header: "PID",
      mono: true,
      align: "right",
      width: 62,
      sortable: true,
      sortValue: (p) => p.pid,
      render: (p) => <span className="text-outline">{p.pid}</span>,
    },
    {
      key: "memoryBytes",
      header: "RAM",
      mono: true,
      align: "right",
      width: 84,
      sortable: true,
      sortValue: (p) => p.memoryBytes,
      render: (p) => (
        <span className={p.memoryBytes >= 1024 * 1024 * 1024 ? "text-warning font-semibold" : "text-on-surface"}>
          {bytes(p.memoryBytes)}
        </span>
      ),
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      width: 96,
      hideBelow: "md",
      render: (p) => {
        const share = pct(p.memoryBytes, totalBytes);
        return (
          <span className="inline-flex items-center justify-end gap-1.5 w-full">
            <span className="w-10 h-1 rounded-full bg-white/10 overflow-hidden">
              <span className="block h-full rounded-full bg-primary/75" style={{ width: `${share}%` }} />
            </span>
            <span className="font-mono text-[10px] text-outline tnum w-9 text-right">{share.toFixed(1)}%</span>
          </span>
        );
      },
    },
    {
      key: "cpuPercent",
      header: "CPU",
      mono: true,
      align: "right",
      width: 62,
      sortable: true,
      sortValue: (p) => p.cpuPercent,
      render: (p) => (
        <span className={p.cpuPercent >= 25 ? "text-warning" : "text-on-variant"}>{percent(p.cpuPercent, 1)}</span>
      ),
    },
    {
      key: "category",
      header: "Category",
      width: 92,
      sortable: true,
      sortValue: (p) => p.category,
      render: (p) => (
        <Badge tone={CATEGORY_TONE[p.category]} mono className="h-4 px-1.5 text-[9px] uppercase">
          {p.category}
        </Badge>
      ),
    },
    {
      key: "kill",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      width: 40,
      render: (p) => (
        <IconButton
          size="sm"
          tone="danger"
          label={`Kill ${p.name}, PID ${p.pid}`}
          icon={<Skull size={11} />}
          onClick={() => openKill(p)}
        />
      ),
    },
  ];

  return (
    <>
      <ToolView
        eyebrow="MEMORY TELEMETRY"
        eyebrowTone={snapshot ? pressure.tone : "primary"}
        eyebrowHint={stats ? `${stats.hostName} · up ${duration(stats.uptimeSecs)}` : "MACH VM SAMPLER"}
        title="RAM Monitor"
        description="Live pressure, wired and compressed memory, and the processes actually holding your RAM."
        telemetry={[
          {
            label: "In use",
            value: snapshot ? `${bytes(snapshot.usedBytes)} / ${bytes(totalBytes, 0)}` : "—",
            tone: "primary",
            icon: <MemoryStick size={14} />,
          },
          {
            label: "Pressure",
            value: snapshot ? pressure.label : "—",
            tone: snapshot ? pressure.tone : "neutral",
            icon: <Gauge size={14} />,
          },
          {
            label: "Swap used",
            value: snapshot ? bytes(snapshot.swapUsedBytes) : "—",
            tone: swapPct > 50 ? "warning" : "neutral",
            icon: <HardDrive size={14} />,
          },
          {
            label: "Available",
            value: snapshot ? `${bytes(snapshot.availableBytes)} · ${percent(availablePct, 1)}` : "—",
            tone: snapshot ? pressure.tone : "neutral",
            icon: <Activity size={14} />,
          },
        ]}
        headerExtra={
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[10px] text-outline">
            <span className="flex items-center gap-3 flex-wrap">
              <span className="text-on-variant">{stats ? stats.cpuBrand : "Host telemetry"}</span>
              <span>
                CPU <span className="text-on-surface">{stats ? percent(stats.cpuUsagePercent, 0) : "—"}</span>
                {stats ? ` · ${stats.cpuCores} cores` : ""}
              </span>
              <span>
                Load <span className="text-on-surface">{stats ? stats.loadAvg.map((n) => n.toFixed(2)).join(" ") : "—"}</span>
              </span>
            </span>
            <span className="flex items-center gap-1.5 flex-wrap justify-end">
              <Badge tone={snapshot ? pressure.tone : "neutral"} mono dot pulse={Boolean(snapshot) && !paused}>
                {snapshot ? `${snapshot.pressure} · ${percent(availablePct, 0)} free` : "no sample"}
              </Badge>
              {paused ? (
                <Badge tone="warning" mono dot>
                  paused
                </Badge>
              ) : (
                <Badge tone="success" mono dot pulse>
                  live · 2s
                </Badge>
              )}
              <span className="text-outline">
                {snapshot ? `sampled ${clockTime(snapshot.takenAt)}` : "waiting for first sample"}
              </span>
            </span>
          </div>
        }
        status={
          <>
            <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
              {paused ? <Play size={11} /> : <Pause size={11} />}
              Sampling
              <Switch checked={!paused} onChange={(on) => setPaused(!on)} label="Toggle memory sampling" size="sm" />
            </span>
            <IconButton label="Refresh memory snapshot now" icon={<RefreshCw size={13} />} onClick={() => void refresh()} />
          </>
        }
      >
        {error && <ErrorNotice title="Backend unavailable" message={error} onRetry={() => void refresh()} />}

        {snapshot && snapshot.pressure !== "normal" && (
          <InfoNotice icon={<AlertTriangle size={12} />} tone="warning">
            <span className="font-semibold">
              {snapshot.pressure === "critical" ? "Memory pressure critical." : "Memory pressure elevated."}
            </span>{" "}
            {bytes(snapshot.availableBytes)} available ({percent(availablePct, 1)} of {bytes(totalBytes, 0)}),{" "}
            {bytes(snapshot.compressedBytes)} held by the compressor, {bytes(snapshot.swapUsedBytes)} swapped out.{" "}
            {snapshot.pressure === "critical"
              ? "Terminate the heaviest consumers below to avoid swap thrashing."
              : "Review the top consumers below before the kernel starts paging."}
          </InfoNotice>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-3">
          <Card className="p-3 flex flex-col gap-2.5 justify-between min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <SectionLabel>Physical memory spectrum</SectionLabel>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-mono text-[15px] font-semibold text-on-surface tnum">
                    {snapshot ? bytes(snapshot.usedBytes) : "—"}
                  </span>
                  <span className="font-mono text-[10.5px] text-outline">
                    used of {snapshot ? bytes(totalBytes, 0) : "—"} unified
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge tone={snapshot ? pressure.tone : "neutral"} mono>
                  {snapshot ? `${percent(availablePct, 1)} available` : "no sample"}
                </Badge>
                <Badge tone="neutral" mono>
                  {snapshot ? number(usedHistory.length) + " samples" : "—"}
                </Badge>
              </div>
            </div>

            {snapshot ? (
              <Meter ariaLabel="Physical memory split: app, wired, compressed, cached and available" segments={segments} height={12} />
            ) : (
              <Skeleton className="h-3 w-full" />
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
              {segments.map((segment) => (
                <div
                  key={segment.label}
                  className="flex items-center justify-between gap-2 rounded-lg bg-black/25 border border-white/[0.05] px-2 py-1.5 min-w-0"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={clsx("w-2 h-2 rounded-full shrink-0", segment.dot)} />
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-outline truncate">
                      {segment.label}
                    </span>
                  </span>
                  <span className="text-right leading-tight shrink-0">
                    <span className="block font-mono text-[10.5px] text-on-surface tnum">{bytes(segment.bytes)}</span>
                    <span className="block font-mono text-[9px] text-outline tnum">{percent(segment.value, 1)}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 font-mono text-[9.5px] text-outline pt-0.5">
              <span className="flex items-center gap-1.5 truncate">
                <ArrowDownUp size={10} className="shrink-0" />
                App = total − available − wired − compressed − cached
              </span>
              <span className="shrink-0">vm_stat · {SAMPLE_MS / 1000}s cadence</span>
            </div>

            <div className="pt-1 border-t border-white/[0.055] grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center justify-between gap-2 font-mono text-[9.5px] text-outline">
                  <span className="flex items-center gap-1.5">
                    <Dot tone={snapshot ? pressure.tone : "neutral"} />
                    Headroom
                  </span>
                  <span className="text-on-variant">
                    {snapshot ? `${bytes(snapshot.availableBytes)} · ${percent(availablePct, 1)}` : "—"}
                  </span>
                </div>
                <Progress
                  value={availablePct}
                  tone={snapshot?.pressure === "critical" ? "error" : snapshot?.pressure === "warning" ? "warning" : "success"}
                  label="Available memory headroom"
                  height={4}
                />
              </div>
              <div className="min-w-0 font-mono text-[9.5px] text-outline sm:text-right">
                {topConsumer ? (
                  <>
                    <span className="uppercase tracking-[0.06em]">Top consumer </span>
                    <span className="text-on-surface truncate inline-block max-w-[150px] align-bottom" title={topConsumer.name}>
                      {topConsumer.name}
                    </span>{" "}
                    <span className="text-warning">{bytes(topConsumer.memoryBytes)}</span>
                  </>
                ) : (
                  <span>Top consumer —</span>
                )}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-1 gap-3 min-w-0">
            <KpiTile
              label="Wired"
              value={snapshot ? bytes(snapshot.wiredBytes) : "—"}
              suffix={snapshot ? percent(pct(snapshot.wiredBytes, totalBytes), 1) : ""}
              detail="Kernel-resident, cannot be paged out"
              tone="tertiary"
              icon={<Layers size={13} />}
              bar={snapshot ? pct(snapshot.wiredBytes, totalBytes) : 0}
              barTone="tertiary"
              loading={loading && !snapshot}
            />
            <KpiTile
              label="Compressed"
              value={snapshot ? bytes(snapshot.compressedBytes) : "—"}
              suffix={snapshot ? percent(pct(snapshot.compressedBytes, totalBytes), 1) : ""}
              detail="Held by the Mach memory compressor"
              tone="warning"
              icon={<Activity size={13} />}
              bar={snapshot ? pct(snapshot.compressedBytes, totalBytes) : 0}
              barTone="warning"
              loading={loading && !snapshot}
            />
            <KpiTile
              label="Swap"
              value={snapshot ? bytes(snapshot.swapUsedBytes) : "—"}
              suffix={snapshot ? `of ${bytes(snapshot.swapTotalBytes, 0)}` : ""}
              detail={snapshot ? `${percent(swapPct, 1)} of the swap file in use` : "Swapfile telemetry"}
              tone={swapPct > 50 ? "error" : swapPct > 10 ? "warning" : "success"}
              icon={<HardDrive size={13} />}
              bar={swapPct}
              barTone={swapPct > 50 ? "error" : swapPct > 10 ? "warning" : "success"}
              loading={loading && !snapshot}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-3 min-w-0">
          <Card className="flex flex-col min-w-0 overflow-hidden">
            <CardHeader
              title="Top consumers"
              hint={snapshot ? `${plural(processes.length, "process")} sampled · ranked by resident bytes` : "Awaiting snapshot"}
              icon={<Cpu size={13} />}
              actions={
                <>
                  <Badge tone="neutral" mono>
                    {bytes(filteredBytes)}
                  </Badge>
                  <span aria-live="polite">
                    <Badge tone={filtered.length > 0 ? "primary" : "neutral"} mono>
                      {filtered.length}/{counts.all}
                    </Badge>
                  </span>
                </>
              }
            />
            <div className="flex flex-wrap items-center gap-2 px-2.5 py-2 border-b border-white/[0.055]">
              <div className="w-44 shrink-0">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter name, PID, type…"
                  aria-label="Filter processes by name, PID or category"
                  sizeVariant="sm"
                  leading={<Search size={11} />}
                />
              </div>
              <SegmentedControl<FilterValue>
                value={filter}
                onChange={setFilter}
                ariaLabel="Filter processes by size or type"
                options={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "heavy", label: "≥ 500 MB", count: counts.heavy },
                  { value: "dev", label: "Dev", count: counts.dev },
                ]}
              />
            </div>
            <DataTable
              ariaLabel="Processes ranked by resident memory"
              columns={columns}
              rows={filtered}
              rowKey={(p) => p.pid}
              initialSort={{ key: "memoryBytes", dir: "desc" }}
              rowTone={(p) => (p.memoryBytes >= 1024 * 1024 * 1024 ? "warning" : null)}
              empty={
                <EmptyState
                  compact
                  icon={loading ? <RefreshCw size={16} className="animate-spin" /> : <Layers size={16} />}
                  title={loading ? "Reading memory snapshot…" : error ? "No snapshot available" : "No matching processes"}
                  description={
                    loading
                      ? "Querying Mach VM statistics and the process table."
                      : error
                        ? "Fix the backend error above, then refresh."
                        : "Clear the filter to see every process in the current sample."
                  }
                />
              }
              footer={
                <tr>
                  <td colSpan={columns.length} className="px-2 h-7">
                    <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-outline">
                      <span className="truncate">
                        {plural(filtered.length, "row")} · {bytes(filteredBytes)} resident in view
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span>{snapshot ? `${plural(processes.length, "process")} in snapshot` : "no sample"}</span>
                        <span className="text-outline/60">•</span>
                        <span className="flex items-center gap-1">
                          <Skull size={9} /> per-row kill asks first
                        </span>
                      </span>
                    </div>
                  </td>
                </tr>
              }
            />
          </Card>

          <div className="flex flex-col gap-3 min-w-0">
            <Card className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <SectionLabel>Resident memory trend</SectionLabel>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="font-mono text-[15px] font-semibold text-primary-soft tnum">
                      {snapshot ? bytes(snapshot.usedBytes) : "—"}
                    </span>
                    <span className="font-mono text-[9.5px] text-outline">
                      {usedHistory.length > 1 ? `peak ${bytes(usedPeak)}` : "collecting"}
                    </span>
                  </div>
                </div>
                <Badge tone="neutral" mono>
                  {MAX_SAMPLES} × 2s
                </Badge>
              </div>
              {usedHistory.length > 0 ? (
                <Sparkline
                  data={usedHistory}
                  width={320}
                  height={56}
                  min={usedFloor}
                  max={usedCeiling}
                  tone="primary"
                  ariaLabel={`Used memory over the last ${usedHistory.length} samples, currently ${bytes(snapshot?.usedBytes ?? 0)}`}
                  className="w-full"
                />
              ) : (
                <Skeleton className="h-14 w-full" />
              )}
              <div className="flex items-center justify-between gap-2 font-mono text-[9.5px] text-outline pt-0.5">
                <span>{usedHistory.length > 0 ? `low ${bytes(usedLow)}` : "no data"}</span>
                <span className="text-on-variant">
                  now {snapshot ? bytes(snapshot.usedBytes) : "—"}
                </span>
              </div>
            </Card>

            <Card className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <SectionLabel>Swap activity</SectionLabel>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="font-mono text-[15px] font-semibold text-tertiary tnum">
                      {snapshot ? bytes(snapshot.swapUsedBytes) : "—"}
                    </span>
                    <span className="font-mono text-[9.5px] text-outline">
                      of {snapshot ? bytes(snapshot.swapTotalBytes, 0) : "—"}
                    </span>
                  </div>
                </div>
                <Badge tone={swapPct > 50 ? "error" : swapPct > 10 ? "warning" : "success"} mono>
                  {snapshot ? percent(swapPct, 1) : "—"}
                </Badge>
              </div>
              <Progress
                value={swapPct}
                tone={swapPct > 50 ? "error" : swapPct > 10 ? "warning" : "success"}
                label="Swap file utilisation"
                height={6}
              />
              {swapHistory.length > 0 ? (
                <Sparkline
                  data={swapHistory}
                  width={320}
                  height={40}
                  min={swapFloor}
                  max={swapCeiling}
                  tone="tertiary"
                  ariaLabel={`Swap usage over the last ${swapHistory.length} samples, currently ${bytes(snapshot?.swapUsedBytes ?? 0)}`}
                  className="w-full"
                />
              ) : (
                <Skeleton className="h-10 w-full" />
              )}
              <div className="flex items-center justify-between gap-2 font-mono text-[9.5px] text-outline">
                <span>peak {swapPeak > 0 ? bytes(swapPeak) : "0 B"}</span>
                <span className={swapPct > 10 ? "text-warning" : "text-secondary"}>
                  {snapshot && snapshot.swapUsedBytes === 0 ? "zero swap pressure" : swapPct > 10 ? "paging active" : "low"}
                </span>
              </div>
            </Card>

            <Card className="p-3 space-y-1.5">
              <SectionLabel>Pressure thresholds</SectionLabel>
              <p className="text-[10.5px] leading-relaxed text-outline">
                The backend derives pressure from available RAM: above 25% is normal, 10–25% raises a warning, below 10%
                is critical. Values refresh from <span className="font-mono text-on-variant">vm_stat</span> and the
                process table.
              </p>
              <div className="flex items-center justify-between gap-2 font-mono text-[9.5px]">
                <span className="flex items-center gap-1.5 text-secondary">
                  <Dot tone="success" /> normal
                </span>
                <span className="flex items-center gap-1.5 text-warning">
                  <Dot tone="warning" /> warning
                </span>
                <span className="flex items-center gap-1.5 text-error">
                  <Dot tone="error" /> critical
                </span>
              </div>
            </Card>

            <Button
              block
              variant="default"
              icon={<RefreshCw size={12} />}
              onClick={() => void refresh()}
              loading={loading}
            >
              Take a manual sample
            </Button>
          </div>
        </div>
      </ToolView>

      <ConfirmDialog
        open={killTarget !== null}
        busy={killing}
        destructive
        title={`Terminate ${killTarget?.name ?? "process"}?`}
        message={
          killTarget
            ? `PID ${killTarget.pid} is holding ${bytes(killTarget.memoryBytes)}. Sending ${killForce ? "SIGKILL" : "SIGTERM"} stops the process immediately; unsaved work is lost.`
            : ""
        }
        confirmLabel={killForce ? "Force kill" : "Kill process"}
        onConfirm={() => void executeKill()}
        onCancel={() => setKillTarget(null)}
        detail={
          killTarget ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-black/35 px-2.5 py-2 text-[11px]">
                <span className="flex items-center gap-2 min-w-0">
                  <Dot tone={CATEGORY_TONE[killTarget.category]} />
                  <span className="truncate text-on-surface">{killTarget.name}</span>
                  <span className="font-mono text-[10px] text-outline shrink-0">#{killTarget.pid}</span>
                </span>
                <span className="font-mono text-[10px] text-on-variant shrink-0">{bytes(killTarget.memoryBytes)}</span>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-on-surface">Force kill (SIGKILL)</div>
                  <div className="text-[10px] text-outline leading-snug">
                    Skips the polite SIGTERM and cannot be caught. Use it only if the process ignores termination.
                  </div>
                </div>
                <Switch checked={killForce} onChange={setKillForce} label="Force kill with SIGKILL" size="sm" />
              </div>
            </div>
          ) : null
        }
      />
    </>
  );
}
