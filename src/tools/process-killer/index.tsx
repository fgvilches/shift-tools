import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bolt,
  Cpu,
  Gauge,
  Layers,
  MemoryStick,
  RefreshCw,
  Search,
  Skull,
  Terminal,
  Zap,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input, SegmentedControl, Switch } from "@/components/ui/Form";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorNotice, InfoNotice, Meter, Progress } from "@/components/ui/Feedback";
import { LogViewer, type LogEntry } from "@/components/ui/LogViewer";
import { toast } from "@/components/ui/Toast";
import { system } from "@/lib/api";
import { errorMessage, isTauri } from "@/lib/ipc";
import { bytes, duration, percent, plural, truncateMiddle } from "@/lib/format";
import type { KillResult, ProcessInfo, SystemStats } from "@/lib/types";

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "node", label: "Node" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "java", label: "Java" },
  { value: "swift", label: "Swift" },
] as const;

type CategoryFilter = (typeof CATEGORIES)[number]["value"];
type Scope = "all" | "dev";

const SORTS = [
  { value: "memoryBytes", label: "RAM", dir: "desc" },
  { value: "cpuPercent", label: "CPU", dir: "desc" },
  { value: "runTimeSecs", label: "Uptime", dir: "desc" },
  { value: "name", label: "Name", dir: "asc" },
  { value: "pid", label: "PID", dir: "asc" },
] as const;

type SortKey = (typeof SORTS)[number]["value"];

export default function ProcessKillerView() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [scope, setScope] = useState<Scope>("all");
  const [sortKey, setSortKey] = useState<SortKey>("memoryBytes");
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [autoScan, setAutoScan] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pending, setPending] = useState<{ mode: "selected" | "all"; pids: number[]; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const logSeq = useRef(0);

  const log = useCallback((level: LogEntry["level"], message: string, detail?: string) => {
    logSeq.current += 1;
    setLogs((prev) => [
      ...prev.slice(-180),
      {
        id: logSeq.current,
        level,
        message,
        detail,
        timestamp: new Date().toLocaleTimeString("en-GB", { hour12: false }),
      },
    ]);
  }, []);

  const refresh = useCallback(
    async (silent = false) => {
      if (!isTauri) {
        setLoading(false);
        setError("This tool needs the native app. Launch it with `npm run app`.");
        return;
      }
      try {
        const [list, snapshot] = await Promise.all([system.processes(), system.stats()]);
        setProcesses(list);
        setStats(snapshot);
        setError(null);
        if (!silent) {
          const devCount = list.filter((p) => p.isDev).length;
          log(
            "info",
            `Scan complete — ${plural(devCount, "dev process", "dev processes")} of ${plural(list.length, "process", "processes")}`,
          );
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [log],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (!autoScan) return;
    const timer = window.setInterval(() => void refresh(true), 1500);
    return () => window.clearInterval(timer);
  }, [autoScan, refresh]);

  const devProcesses = useMemo(() => processes.filter((p) => p.isDev), [processes]);
  const otherProcesses = useMemo(() => processes.filter((p) => !p.isDev), [processes]);

  const filterList = useCallback(
    (list: ProcessInfo[]) => {
      const q = query.trim().toLowerCase();
      return list.filter((p) => {
        if (category !== "all" && p.category !== category) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.command.toLowerCase().includes(q) ||
          String(p.pid).includes(q) ||
          p.user.toLowerCase().includes(q)
        );
      });
    },
    [query, category],
  );

  const devRows = useMemo(() => filterList(devProcesses), [filterList, devProcesses]);
  const otherRows = useMemo(() => filterList(otherProcesses), [filterList, otherProcesses]);

  const devMemory = devProcesses.reduce((sum, p) => sum + p.memoryBytes, 0);
  const selectedProcesses = useMemo(() => processes.filter((p) => selected.has(p.pid)), [processes, selected]);
  const selectedBytes = selectedProcesses.reduce((sum, p) => sum + p.memoryBytes, 0);

  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(processes.map((p) => p.pid));
      const next = new Set([...prev].filter((pid) => alive.has(Number(pid))));
      return next.size === prev.size ? prev : next;
    });
  }, [processes]);

  const executeKill = async () => {
    if (!pending) return;
    setBusy(true);
    const { pids, bytes: targetBytes, mode } = pending;
    try {
      const results: KillResult[] = await system.kill(pids, false);
      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);

      log(
        succeeded.length > 0 ? "success" : "error",
        `${mode === "all" ? "Dispatch" : "Selection"} — ${succeeded.length}/${results.length} terminated`,
        `${bytes(targetBytes)} reclaimed`,
      );
      for (const failure of failed) {
        log("error", `PID ${failure.pid} (${failure.name}) not terminated`, failure.error ?? undefined);
      }
      if (succeeded.length > 0) {
        toast.success(
          `${plural(succeeded.length, "process", "processes")} terminated`,
          `${bytes(targetBytes)} of RAM reclaimed${failed.length > 0 ? ` · ${failed.length} refused` : ""}`,
        );
      } else if (failed.length > 0) {
        toast.error("No process could be terminated", failed[0]?.error ?? undefined);
      }
      setSelected(new Set());
      await refresh(true);
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      log("error", "Kill dispatch failed", message);
      toast.error("Kill dispatch failed", message);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (devProcesses.length > 0) {
          setPending({ mode: "all", pids: devProcesses.map((p) => p.pid), bytes: devMemory });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [devProcesses, devMemory]);

  const columns: Column<ProcessInfo>[] = [
    {
      key: "name",
      header: "Process & type",
      sortable: true,
      sortValue: (p) => p.name.toLowerCase(),
      render: (p) => (
        <div className="flex items-center gap-2 min-w-0 py-0.5">
          <span
            className={
              p.isDev
                ? "w-5 h-5 rounded-md bg-primary/12 border border-primary/25 flex items-center justify-center shrink-0"
                : "w-5 h-5 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0"
            }
          >
            <Zap size={10} className={p.isDev ? "text-primary-soft" : "text-outline"} />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-on-surface truncate max-w-[170px]">{p.name}</span>
              {p.isDev && (
                <span className="font-mono text-[9px] px-1 rounded bg-primary/15 text-primary-soft border border-primary/25 uppercase">
                  {p.category}
                </span>
              )}
              {p.isGuiApp && (
                <Badge tone="warning" className="h-4">
                  GUI
                </Badge>
              )}
              {p.protected && (
                <Badge tone="neutral" className="h-4">
                  system
                </Badge>
              )}
            </div>
            <div className="font-mono text-[9.5px] text-outline/80 truncate max-w-[230px]">
              {p.user || "—"} · {p.exe ? truncateMiddle(p.exe, 38) : "—"}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "pid",
      header: "PID",
      mono: true,
      align: "right",
      sortable: true,
      sortValue: (p) => p.pid,
      width: 66,
      render: (p) => <span className="text-on-variant">{p.pid}</span>,
    },
    {
      key: "memoryBytes",
      header: "RAM",
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (p) => p.memoryBytes,
      width: 92,
      render: (p) => (
        <span className={p.memoryBytes > 600 * 1024 * 1024 ? "text-warning" : "text-on-surface"}>{bytes(p.memoryBytes)}</span>
      ),
    },
    {
      key: "cpuPercent",
      header: "CPU",
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (p) => p.cpuPercent,
      width: 64,
      render: (p) => (
        <span className={p.cpuPercent > 25 ? "text-warning" : "text-on-variant"}>{percent(p.cpuPercent, 1)}</span>
      ),
    },
    {
      key: "runTimeSecs",
      header: "Uptime",
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (p) => p.runTimeSecs,
      width: 80,
      hideBelow: "md",
      render: (p) => <span className="text-on-variant">{duration(p.runTimeSecs)}</span>,
    },
    {
      key: "command",
      header: "Binary / command payload",
      hideBelow: "lg",
      render: (p) => (
        <span className="font-mono text-[10.5px] text-outline/85 truncate block max-w-[420px]" title={p.command}>
          {truncateMiddle(p.command, 78)}
        </span>
      ),
    },
  ];

  const targetProcesses = useMemo(
    () => processes.filter((p) => (pending?.pids ?? []).includes(p.pid)),
    [processes, pending],
  );

  const sortDef = SORTS.find((s) => s.value === sortKey) ?? SORTS[0];

  const tableProps = {
    columns,
    selected,
    onSelectedChange: setSelected,
    initialSort: { key: sortDef.value as string, dir: sortDef.dir },
  };

  const devSection = (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader
        title="Development processes"
        hint={`${plural(devRows.length, "candidate")} · ${bytes(devRows.reduce((s, p) => s + p.memoryBytes, 0))}`}
        icon={<Terminal size={13} />}
        actions={
          <>
            <Badge tone="primary" mono>
              dev tooling
            </Badge>
            <Badge tone="neutral" mono>
              {bytes(devMemory)} total
            </Badge>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <DataTable
          key={`dev-${sortKey}`}
          ariaLabel="Development processes"
          rows={devRows}
          rowKey={(p) => p.pid}
          rowTone={(p) => (p.memoryBytes > 900 * 1024 * 1024 ? "warning" : null)}
          empty={
            <EmptyState
              compact
              icon={loading ? <RefreshCw size={16} className="animate-spin" /> : <Skull size={16} />}
              title={loading ? "Scanning processes…" : "No development processes found"}
              description={loading ? "Reading the process table from the Rust core." : "Nothing matches the current filter."}
            />
          }
          footer={
            <tr>
              <td colSpan={columns.length + 1} className="px-2 h-7">
                <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                  <span>
                    {plural(devRows.length, "row")} · {bytes(devRows.reduce((s, p) => s + p.memoryBytes, 0))} reclaimable
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <Kbd>space</Kbd> select
                    </span>
                    <span className="flex items-center gap-1">
                      <Kbd>⇧⌘K</Kbd> kill all dev
                    </span>
                  </span>
                </div>
              </td>
            </tr>
          }
          {...tableProps}
        />
      </div>
    </Card>
  );

  const otherSection = (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader
        title="Everything else"
        hint={`${plural(otherRows.length, "process", "processes")} · apps, system daemons and background services`}
        icon={<Layers size={13} />}
        actions={
          <Badge tone="neutral" mono>
            {bytes(otherRows.reduce((s, p) => s + p.memoryBytes, 0))}
          </Badge>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <DataTable
          key={`other-${sortKey}`}
          ariaLabel="All other processes"
          rows={otherRows}
          rowKey={(p) => p.pid}
          empty={
            <EmptyState
              compact
              icon={<Layers size={16} />}
              title={loading ? "Scanning processes…" : "Nothing to show"}
              description="Every non-development process on the host appears here."
            />
          }
          {...tableProps}
        />
      </div>
    </Card>
  );

  return (
    <>
      <ToolView
        eyebrow="KILL SERVICE"
        eyebrowTone="error"
        eyebrowHint="SIGTERM / SIGKILL DISPATCHER"
        title="Process Killer"
        description="Terminate orphaned development runtimes and zombie servers — with every other host process visible behind them."
        telemetry={[
          { label: "Dev footprint", value: bytes(devMemory), tone: "error", icon: <MemoryStick size={14} /> },
          {
            label: "Dev processes",
            value: `${devProcesses.length} / ${processes.length}`,
            tone: "neutral",
            icon: <Cpu size={14} />,
          },
          {
            label: "GPU · host",
            value: stats && stats.gpuPercent !== null ? percent(stats.gpuPercent) : "—",
            tone: "tertiary",
            icon: <Gauge size={14} />,
          },
          {
            label: "Auto-scan",
            value: autoScan ? "1.5s loop" : "paused",
            tone: autoScan ? "success" : "warning",
            icon: <Dot tone={autoScan ? "success" : "warning"} pulse={autoScan} />,
          },
        ]}
        headerExtra={
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[10px] gap-3">
              <span className="flex items-center gap-1.5 text-on-variant min-w-0 truncate">
                <span className="text-on-surface font-medium">Host allocation</span>
                <span className="text-error font-semibold">{bytes(devMemory)}</span>
                <span className="text-outline">in dev processes</span>
              </span>
              <span className="text-outline shrink-0">
                {stats ? `${bytes(stats.totalMemoryBytes, 0)} physical · ${stats.cpuCores} cores` : ""}
                {stats && stats.gpuMemoryBytes ? ` · GPU ${bytes(stats.gpuMemoryBytes)}` : ""}
              </span>
            </div>
            <Meter
              ariaLabel="Memory split between development processes, other apps and available memory"
              segments={[
                {
                  label: "Dev processes",
                  value: stats && stats.totalMemoryBytes > 0 ? (devMemory / stats.totalMemoryBytes) * 100 : 0,
                  tone: "error",
                },
                {
                  label: "Other in use",
                  value:
                    stats && stats.totalMemoryBytes > 0
                      ? Math.max(0, ((stats.usedMemoryBytes - devMemory) / stats.totalMemoryBytes) * 100)
                      : 0,
                  tone: "primary",
                },
                {
                  label: "Available",
                  value:
                    stats && stats.totalMemoryBytes > 0 ? (stats.availableMemoryBytes / stats.totalMemoryBytes) * 100 : 100,
                  tone: "success",
                },
              ]}
            />
          </div>
        }
        toolbar={
          <>
            <Button
              variant="destructive"
              icon={<Bolt size={13} />}
              onClick={() => setPending({ mode: "all", pids: devProcesses.map((p) => p.pid), bytes: devMemory })}
              disabled={devProcesses.length === 0 || busy}
              trailing={<Kbd>⇧⌘K</Kbd>}
            >
              Kill all dev processes
            </Button>
            <Button
              icon={<Skull size={13} />}
              onClick={() =>
                setPending({ mode: "selected", pids: selectedProcesses.map((p) => p.pid), bytes: selectedBytes })
              }
              disabled={selectedProcesses.length === 0 || busy}
            >
              Kill selected{selectedProcesses.length > 0 ? ` (${selectedProcesses.length})` : ""}
            </Button>
            <div className="w-40">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter name, PID, user…"
                aria-label="Filter processes"
                sizeVariant="sm"
                leading={<Search size={11} />}
              />
            </div>
            <SegmentedControl
              value={scope}
              onChange={setScope}
              ariaLabel="Which processes to list"
              options={[
                { value: "all", label: "All processes", count: processes.length },
                { value: "dev", label: "Dev only", count: devProcesses.length },
              ]}
            />
            <SegmentedControl
              value={category}
              onChange={setCategory}
              ariaLabel="Filter by process category"
              options={CATEGORIES.slice(0, 4).map((c) => ({ value: c.value, label: c.label }))}
            />
            <SegmentedControl
              value={sortKey}
              onChange={(value) => setSortKey(value)}
              ariaLabel="Sort processes by"
              options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
            />
          </>
        }
        status={
          <>
            <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
              Auto-scan
              <Switch checked={autoScan} onChange={setAutoScan} label="Toggle auto scan" size="sm" />
            </span>
            <IconButton label="Refresh process list" icon={<RefreshCw size={13} />} onClick={() => void refresh()} />
          </>
        }
      >
        {error && <ErrorNotice title="Backend unavailable" message={error} onRetry={() => void refresh()} />}

        <div className={scope === "all" ? "flex min-h-0 flex-1 flex-col gap-3" : "flex min-h-0 flex-1 flex-col"}>
          {devSection}
          {scope === "all" && otherSection}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3">
          <LogViewer
            title="Signal audit log"
            logs={logs}
            onClear={() => setLogs([])}
            height={128}
            emptyLabel="No dispatch yet"
          />
          <Card className="p-3 space-y-2">
            <SectionLabel trailing={<Badge tone="error" mono>SIGTERM → SIGKILL</Badge>}>Dispatch policy</SectionLabel>
            <InfoNotice icon={<AlertTriangle size={12} />} tone="warning">
              SIGTERM goes out first. Anything still alive after 3 seconds receives SIGKILL. System processes and
              shift-tools itself are never signalled.
            </InfoNotice>
            <InfoNotice icon={<Gauge size={12} />} tone="neutral">
              GPU load is host-wide: macOS exposes no per-process GPU accounting, so it is a system tile rather than a
              per-row column.
            </InfoNotice>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wide text-outline">Selected</div>
                <div className="font-mono text-[12px] text-on-surface tnum">{selectedProcesses.length}</div>
              </div>
              <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wide text-outline">Reclaimable</div>
                <div className="font-mono text-[12px] text-error tnum">{bytes(selectedBytes)}</div>
              </div>
            </div>
            {loading && <Progress indeterminate label="Loading processes" />}
            {!loading && devProcesses.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-outline">
                  <span>Top dev consumer</span>
                  <span className="font-mono text-on-variant truncate max-w-[130px]">{devProcesses[0]?.name}</span>
                </div>
                <Progress
                  value={((devProcesses[0]?.memoryBytes ?? 0) / (devMemory || 1)) * 100}
                  tone="error"
                  label="Top consumer share of dev memory"
                />
              </div>
            )}
          </Card>
        </div>
      </ToolView>

      <ConfirmDialog
        open={pending !== null}
        busy={busy}
        destructive
        title={pending?.mode === "all" ? "Terminate every dev process?" : `Terminate ${pending?.pids.length ?? 0} process(es)?`}
        message={
          pending?.mode === "all"
            ? `shift-tools sends SIGTERM to ${pending.pids.length} development processes, freeing roughly ${bytes(pending.bytes)}. Anything that ignores the signal is force-killed.`
            : `Sending SIGTERM to ${pending?.pids.length ?? 0} processes releases about ${bytes(pending?.bytes ?? 0)}.`
        }
        confirmLabel={pending?.mode === "all" ? "Kill all" : "Kill selected"}
        onConfirm={() => void executeKill()}
        onCancel={() => setPending(null)}
        detail={
          <div className="max-h-40 overflow-y-auto rounded-lg border border-white/[0.07] bg-black/35 divide-y divide-white/[0.05]">
            {targetProcesses.slice(0, 12).map((p) => (
              <div key={p.pid} className="flex items-center justify-between px-2 py-1.5 text-[11px]">
                <span className="flex items-center gap-2 min-w-0">
                  <Dot tone={p.isGuiApp ? "warning" : p.isDev ? "error" : "neutral"} />
                  <span className="truncate text-on-surface">{p.name}</span>
                  <span className="font-mono text-[10px] text-outline">#{p.pid}</span>
                </span>
                <span className="font-mono text-[10px] text-on-variant shrink-0">{bytes(p.memoryBytes)}</span>
              </div>
            ))}
            {targetProcesses.length > 12 && (
              <div className="px-2 py-1.5 text-[10.5px] text-outline">+ {targetProcesses.length - 12} more</div>
            )}
          </div>
        }
      />
    </>
  );
}
