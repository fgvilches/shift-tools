import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Box,
  Clock,
  Code2,
  Coffee,
  Cog,
  Container,
  Copy,
  Database,
  FolderOpen,
  HardDrive,
  Hammer,
  Package,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorNotice, Meter, Progress } from "@/components/ui/Feedback";
import { BarSeries } from "@/components/ui/Charts";
import { toast } from "@/components/ui/Toast";
import { system, util } from "@/lib/api";
import { errorMessage } from "@/lib/ipc";
import { bytes, bytesParts, percent, plural, relative, truncateMiddle } from "@/lib/format";
import type { CleanReport, DiskTarget } from "@/lib/types";

interface KindMeta {
  label: string;
  tone: Tone;
  icon: ReactNode;
}

const KIND_META: Record<string, KindMeta> = {
  xcode: { label: "xcode", tone: "tertiary", icon: <Hammer size={10} /> },
  node: { label: "node", tone: "success", icon: <Package size={10} /> },
  python: { label: "python", tone: "primary", icon: <Box size={10} /> },
  rust: { label: "rust", tone: "warning", icon: <Cog size={10} /> },
  java: { label: "java", tone: "tertiary", icon: <Coffee size={10} /> },
  container: { label: "container", tone: "primary", icon: <Container size={10} /> },
  go: { label: "go", tone: "primary", icon: <Code2 size={10} /> },
  system: { label: "system", tone: "neutral", icon: <Database size={10} /> },
};

function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? { label: kind, tone: "neutral", icon: <Database size={10} /> };
}

type TargetStatusKey = "exists" | "missing" | "permissions";

interface TargetStatus {
  key: TargetStatusKey;
  label: string;
  tone: Tone;
  hint: string;
}

function targetStatus(target: DiskTarget): TargetStatus {
  if (!target.exists) {
    return { key: "missing", label: "missing", tone: "neutral", hint: "Path does not exist on this machine" };
  }
  if (target.sizeBytes === 0) {
    return {
      key: "permissions",
      label: "permissions",
      tone: "warning",
      hint: "Directory exists but reports 0 bytes — empty, or contents are not readable",
    };
  }
  return { key: "exists", label: "exists", tone: "success", hint: "Directory readable and measured" };
}

const STATUS_ORDER: Record<TargetStatusKey, number> = { missing: 0, permissions: 1, exists: 2 };

const SEGMENT_TONES: Tone[] = ["tertiary", "primary", "success", "warning", "neutral"];

const TONE_DOT: Record<Tone, string> = {
  primary: "bg-primary",
  success: "bg-secondary",
  warning: "bg-warning",
  error: "bg-error",
  tertiary: "bg-tertiary",
  neutral: "bg-white/30",
};

function displayPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

export function CuratedPanel({ tabs }: { tabs: ReactNode }) {
  const [targets, setTargets] = useState<DiskTarget[]>([]);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [scanned, setScanned] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<CleanReport[] | null>(null);
  const [sessionFreed, setSessionFreed] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const initialised = useRef(false);
  const scanningRef = useRef(false);

  const refresh = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    try {
      const list = await system.diskTargets();
      setTargets(list);
      setError(null);
      setScanned(true);
      setLastScanAt(new Date().toISOString());
      if (!initialised.current) {
        initialised.current = true;
        setSelected(new Set(list.filter((t) => t.exists && t.sizeBytes > 0).map((t) => t.id)));
      } else {
        setSelected((prev) => {
          const alive = new Set(list.map((t) => t.id));
          const next = new Set([...prev].filter((id) => alive.has(String(id))));
          return next.size === prev.size ? prev : next;
        });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!scanning) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [scanning]);

  const totalBytes = useMemo(
    () => targets.reduce((sum, t) => (t.exists ? sum + t.sizeBytes : sum), 0),
    [targets],
  );
  const presentCount = useMemo(() => targets.filter((t) => t.exists).length, [targets]);
  const missingCount = useMemo(() => targets.filter((t) => !t.exists).length, [targets]);
  const noAccessCount = useMemo(
    () => targets.filter((t) => t.exists && t.sizeBytes === 0).length,
    [targets],
  );

  const selectedTargets = useMemo(
    () => targets.filter((t) => selected.has(t.id) && t.exists),
    [targets, selected],
  );
  const selectedBytes = useMemo(
    () => selectedTargets.reduce((sum, t) => sum + t.sizeBytes, 0),
    [selectedTargets],
  );

  const familyGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const target of targets) {
      if (!target.exists || target.sizeBytes === 0) continue;
      map.set(target.kind, (map.get(target.kind) ?? 0) + target.sizeBytes);
    }
    return [...map.entries()]
      .map(([kind, sizeBytes]) => ({ kind, sizeBytes, meta: kindMeta(kind) }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes);
  }, [targets]);

  const familySegments = useMemo(() => {
    const top = familyGroups.slice(0, 4);
    const restBytes = familyGroups.slice(4).reduce((sum, g) => sum + g.sizeBytes, 0);
    const segments = top.map((g, i) => ({
      label: g.meta.label,
      value: g.sizeBytes,
      tone: SEGMENT_TONES[i] ?? "neutral",
    }));
    if (restBytes > 0) segments.push({ label: "other", value: restBytes, tone: "neutral" });
    return segments;
  }, [familyGroups]);

  const largestFamily = familyGroups[0];
  const familyScale = largestFamily?.sizeBytes ?? 0;
  const barUnit = familyScale >= 1024 ** 3 ? " GB" : " MB";
  const barDivisor = barUnit === " GB" ? 1024 ** 3 : 1024 ** 2;

  const barItems = useMemo(
    () =>
      [...targets]
        .filter((t) => t.exists && t.sizeBytes > 0)
        .sort((a, b) => b.sizeBytes - a.sizeBytes)
        .slice(0, 6)
        .map((t) => ({
          label: t.label,
          value: t.sizeBytes / barDivisor,
          tone: kindMeta(t.kind).tone,
        })),
    [targets, barDivisor],
  );

  const parts = bytesParts(totalBytes);
  const selectedShare = totalBytes > 0 ? (selectedBytes / totalBytes) * 100 : 0;

  const copyPath = useCallback(async (target: DiskTarget) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable in this webview");
      await navigator.clipboard.writeText(target.path);
      toast.success("Path copied", target.path);
    } catch (err) {
      toast.error("Could not copy path", errorMessage(err));
    }
  }, []);

  const revealTarget = useCallback(async (target: DiskTarget) => {
    try {
      await util.reveal(target.path);
    } catch (err) {
      toast.error("Could not open Finder", errorMessage(err));
    }
  }, []);

  const runClean = useCallback(async () => {
    if (selectedTargets.length === 0) {
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    try {
      const result = await system.cleanDisk(selectedTargets.map((t) => t.id));
      const freed = result.reduce((sum, r) => sum + r.freedBytes, 0);
      const succeeded = result.filter((r) => r.ok);
      const failed = result.filter((r) => !r.ok);

      setReports(result);
      setSessionFreed((prev) => prev + freed);
      setSelected(new Set());
      setConfirmOpen(false);

      if (freed > 0) {
        toast.success(
          `${bytes(freed)} freed`,
          `${succeeded.length}/${result.length} targets cleaned${failed.length > 0 ? ` · ${failed.length} failed` : ""}`,
        );
      } else if (failed.length > 0) {
        toast.error("Nothing could be freed", failed[0]?.error ?? undefined);
      } else {
        toast.info("Caches already empty", "The selected targets held no reclaimable files.");
      }

      await refresh();
    } catch (err) {
      const message = errorMessage(err);
      toast.error("Clean failed", message);
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }, [selectedTargets, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!scanningRef.current && !busy) void refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh, busy]);

  const columns: Column<DiskTarget>[] = [
    {
      key: "label",
      header: "Target",
      sortable: true,
      sortValue: (t) => t.label.toLowerCase(),
      render: (t) => {
        const meta = kindMeta(t.kind);
        return (
          <div className="flex items-center gap-2 min-w-0 py-0.5">
            <span className="w-5 h-5 rounded-md bg-white/[0.05] border border-white/[0.06] flex items-center justify-center shrink-0 text-on-variant">
              {meta.icon}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`text-[12px] font-medium truncate max-w-[190px] ${t.exists ? "text-on-surface" : "text-outline"}`}>
                  {t.label}
                </span>
                {t.exists && t.sizeBytes > 4 * 1024 ** 3 && (
                  <Badge tone="warning" className="h-4">
                    heavy
                  </Badge>
                )}
              </div>
              <div className="text-[10px] text-outline/80 truncate max-w-[220px]">{t.detail}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: "path",
      header: "Path",
      hideBelow: "lg",
      render: (t) => (
        <button
          type="button"
          onClick={() => void copyPath(t)}
          aria-label={`Copy path ${t.path}`}
          title={`Copy ${t.path}`}
          className="group/copy flex items-center gap-1.5 max-w-[260px] text-left"
        >
          <span className="font-mono text-[10.5px] text-outline/90 truncate group-hover/copy:text-primary-soft transition-colors">
            {truncateMiddle(displayPath(t.path), 38)}
          </span>
          <Copy size={10} className="shrink-0 text-outline opacity-0 group-hover/copy:opacity-100 transition-opacity" />
        </button>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      sortable: true,
      sortValue: (t) => kindMeta(t.kind).label,
      width: 82,
      render: (t) => {
        const meta = kindMeta(t.kind);
        return (
          <Badge tone={meta.tone} mono>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: "sizeBytes",
      header: "Size",
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (t) => t.sizeBytes,
      width: 88,
      render: (t) =>
        t.sizeBytes > 0 ? (
          <span className="text-on-surface">{bytes(t.sizeBytes)}</span>
        ) : (
          <span className="text-outline">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      width: 100,
      sortable: true,
      sortValue: (t) => STATUS_ORDER[targetStatus(t).key],
      render: (t) => {
        const status = targetStatus(t);
        return (
          <Badge tone={status.tone} dot title={status.hint}>
            {status.label}
          </Badge>
        );
      },
    },
    {
      key: "reveal",
      header: <span className="sr-only">Reveal</span>,
      width: 34,
      align: "center",
      render: (t) => (
        <span className="inline-flex">
          <IconButton
            size="sm"
            label={t.exists ? `Reveal ${t.label} in Finder` : `${t.label} is missing on disk`}
            icon={<FolderOpen size={12} />}
            disabled={!t.exists}
            onClick={() => void revealTarget(t)}
            className="disabled:opacity-30 disabled:pointer-events-none"
          />
        </span>
      ),
    },
  ];

  const okCount = reports?.filter((r) => r.ok).length ?? 0;
  const failedCount = reports ? reports.length - okCount : 0;
  const freedTotal = reports?.reduce((sum, r) => sum + r.freedBytes, 0) ?? 0;

  return (
    <>
      <ToolView
        eyebrow="STORAGE RECLAIM"
        eyebrowTone="tertiary"
        eyebrowHint="APFS · DEV CACHE PURGE"
        title="Disk Cleaner"
        description="Reclaim gigabytes from Xcode DerivedData, package manager caches, and container images."
        telemetry={[
          {
            label: "Reclaimable",
            value: bytes(totalBytes),
            tone: "tertiary",
            icon: <HardDrive size={14} />,
          },
          {
            label: "Targets",
            value: `${presentCount} / ${targets.length}`,
            tone: "neutral",
            icon: <FolderOpen size={14} />,
          },
          {
            label: "Last scan",
            value: scanning ? "scanning…" : lastScanAt ? relative(lastScanAt) : "never",
            tone: scanning ? "primary" : lastScanAt ? "success" : "warning",
            icon: <Clock size={14} />,
          },
        ]}
        headerExtra={
          <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-3 lg:items-center">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
                Total safe reclaimable
              </div>
              <div className="flex items-baseline gap-1.5 pt-1 flex-wrap">
                <span className="font-mono text-[26px] leading-none font-semibold text-on-surface tnum">
                  {parts.value}
                </span>
                <span className="text-[13px] font-medium text-primary-soft">{parts.unit}</span>
                <Badge tone={totalBytes > 0 ? "tertiary" : "neutral"} dot className="ml-0.5 self-center">
                  {totalBytes > 0 ? "ready to purge" : "nothing cached"}
                </Badge>
              </div>
              <div className="pt-1 font-mono text-[10px] text-outline">
                {plural(presentCount, "present target")} · {bytes(selectedBytes)} selected
              </div>
            </div>
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                <span className="text-outline">By cache family</span>
                <span className="text-outline" aria-live="polite">
                  {scanning
                    ? `scanning caches… ${elapsed}s`
                    : lastScanAt
                      ? `scanned ${relative(lastScanAt)}`
                      : "not scanned"}
                </span>
              </div>
              <Meter
                segments={familySegments}
                height={9}
                ariaLabel="Reclaimable bytes grouped by cache family"
              />
              {familyGroups.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1">
                  {familySegments.map((segment) => (
                    <div key={segment.label} className="flex items-center gap-1.5 min-w-0 font-mono text-[10px]">
                      <span className={`w-2 h-2 rounded-[2px] shrink-0 ${TONE_DOT[segment.tone]}`} aria-hidden />
                      <span className="text-on-variant truncate">{segment.label}</span>
                      <span className="text-outline shrink-0 ml-auto">{bytes(segment.value)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="font-mono text-[10px] text-outline">
                  {scanning ? "Measuring cache directories…" : "No cache directories measured yet."}
                </p>
              )}
            </div>
          </div>
        }
        toolbar={
          <>
            {tabs}
            <Button
              icon={<RefreshCw size={13} />}
              onClick={() => void refresh()}
              loading={scanning}
              disabled={scanning || busy}
              trailing={<Kbd>⌘S</Kbd>}
            >
              Scan
            </Button>
            <Button
              variant="destructive"
              icon={<Trash2 size={13} />}
              onClick={() => setConfirmOpen(true)}
              loading={busy}
              disabled={selectedTargets.length === 0 || selectedBytes === 0}
            >
              Clean selected{selectedBytes > 0 ? ` (${bytes(selectedBytes)})` : ""}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSelected(new Set(targets.filter((t) => t.exists).map((t) => t.id)))}
              disabled={presentCount === 0 || scanning || busy}
            >
              Select all present
            </Button>
          </>
        }
        status={
          <>
            {scanning ? (
              <Badge tone="primary" dot pulse>
                {targets.length > 0 ? "rescanning caches…" : "scanning caches…"}
              </Badge>
            ) : error ? (
              <Badge tone="error" dot>
                scan failed
              </Badge>
            ) : (
              <Badge tone={totalBytes > 0 ? "success" : "neutral"} dot>
                {totalBytes > 0 ? `${bytes(totalBytes)} reclaimable` : "caches clear"}
              </Badge>
            )}
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-outline">
              <ShieldCheck size={12} className="text-secondary" aria-hidden />
              regenerable only
            </span>
          </>
        }
      >
        {error && <ErrorNotice title="Cache scan failed" message={error} onRetry={() => void refresh()} />}

        <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <CardHeader
            title="Cleanup targets"
            hint={`${plural(targets.length, "target")} · ${presentCount} present · default sort by size`}
            icon={<HardDrive size={13} />}
            actions={
              <>
                <Badge tone={selectedBytes > 0 ? "primary" : "neutral"} mono>
                  {bytes(selectedBytes)} selected
                </Badge>
                <Badge tone="tertiary" mono>
                  {bytes(totalBytes)} reclaimable
                </Badge>
              </>
            }
          />
          {scanning && <Progress indeterminate label="Scanning cache directories" height={2} />}
          <div className="flex-1 min-h-0 overflow-auto">
            <DataTable
              ariaLabel="Disk cleanup targets"
              columns={columns}
              rows={targets}
              rowKey={(t) => t.id}
              selected={selected}
              onSelectedChange={setSelected}
              initialSort={{ key: "sizeBytes", dir: "desc" }}
              empty={
                <EmptyState
                  compact
                  icon={
                    scanning ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : error ? (
                      <AlertTriangle size={16} className="text-error" />
                    ) : (
                      <HardDrive size={16} />
                    )
                  }
                  title={
                    scanning && targets.length === 0
                      ? "Scanning caches…"
                      : error
                        ? "Targets could not be read"
                        : scanned
                          ? "No cache targets detected"
                          : "Waiting for the first scan"
                  }
                  description={
                    scanning && targets.length === 0
                      ? "Walking Xcode, package manager and container cache directories. This can take up to 20 seconds."
                      : error
                        ? "The backend rejected the request. Retry to scan the filesystem again."
                        : scanned
                          ? "None of the known cache locations exist on this machine yet."
                          : "Run a scan to measure every known developer cache."
                  }
                  action={
                    !scanning && (error || !scanned) ? (
                      <Button size="xs" icon={<RefreshCw size={11} />} onClick={() => void refresh()}>
                        Scan now
                      </Button>
                    ) : undefined
                  }
                />
              }
              footer={
                <tr>
                  <td colSpan={columns.length + 1} className="px-2 h-7">
                    <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-outline">
                      <span>
                        {presentCount} present · {missingCount} missing · {noAccessCount} zero-byte ·{" "}
                        {bytes(totalBytes)} reclaimable
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="flex items-center gap-1">click path to copy</span>
                        <span className="flex items-center gap-1">
                          <Kbd>⌘S</Kbd> rescan
                        </span>
                      </span>
                    </div>
                  </td>
                </tr>
              }
            />
          </div>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <Card className="p-3 space-y-2">
            <SectionLabel
              trailing={
                <Badge tone={selectedTargets.length > 0 ? "primary" : "neutral"} mono>
                  {plural(selectedTargets.length, "target")}
                </Badge>
              }
            >
              Selection
            </SectionLabel>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0" aria-live="polite">
                <div className="font-mono text-[20px] leading-none font-semibold text-primary-soft tnum">
                  {bytes(selectedBytes)}
                </div>
                <div className="pt-1 text-[10.5px] text-outline">
                  selected of {bytes(totalBytes)} reclaimable
                </div>
              </div>
              <span className="font-mono text-[12px] text-on-variant tnum shrink-0">
                {percent(selectedShare, 0)}
              </span>
            </div>
            <Meter
              segments={[
                { label: "Selected", value: selectedBytes, tone: "primary" },
                { label: "Not selected", value: Math.max(0, totalBytes - selectedBytes), tone: "neutral" },
              ]}
              height={8}
              ariaLabel="Share of reclaimable bytes selected for cleaning"
            />
            <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
              <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wide text-outline">Present</div>
                <div className="text-[12px] text-secondary tnum">{presentCount}</div>
              </div>
              <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wide text-outline">Missing</div>
                <div className="text-[12px] text-on-variant tnum">{missingCount}</div>
              </div>
              <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wide text-outline">0-byte</div>
                <div className="text-[12px] text-warning tnum">{noAccessCount}</div>
              </div>
            </div>
          </Card>

          <Card className="p-3 space-y-2 min-w-0">
            <SectionLabel
              trailing={
                <span className="font-mono text-[10px] text-outline">
                  {barItems.length > 0 ? `top ${barItems.length} · ${barUnit.trim()}` : "no data"}
                </span>
              }
            >
              Biggest contributors
            </SectionLabel>
            {barItems.length > 0 ? (
              <BarSeries items={barItems} unit={barUnit} rowHeight={18} />
            ) : (
              <EmptyState
                compact
                icon={<HardDrive size={15} />}
                title={scanning ? "Measuring…" : "No measurable caches"}
                description={
                  scanning
                    ? "Reading directory trees from disk."
                    : "Cache targets exist but report zero bytes."
                }
              />
            )}
            <div className="flex items-center justify-between font-mono text-[10px] text-outline border-t border-white/[0.05] pt-1.5">
              <span>purge mode: delete contents, keep directories</span>
              <span className="text-on-variant">{bytes(sessionFreed)} freed this session</span>
            </div>
          </Card>
        </div>

        {reports && (
          <Card className="overflow-hidden">
            <CardHeader
              title="Clean report"
              hint={`${okCount}/${reports.length} targets cleaned · ${bytes(freedTotal)} freed${
                failedCount > 0 ? ` · ${failedCount} failed` : ""
              }`}
              icon={<ShieldCheck size={13} />}
              actions={
                <>
                  <Badge tone={failedCount > 0 ? "warning" : "success"} mono>
                    {bytes(freedTotal)}
                  </Badge>
                  <IconButton
                    label="Dismiss clean report"
                    icon={<X size={12} />}
                    size="sm"
                    onClick={() => setReports(null)}
                  />
                </>
              }
            />
            <div className="max-h-44 overflow-y-auto divide-y divide-white/[0.05]">
              {reports.map((report) => (
                <div key={report.id} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
                  <Badge tone={report.ok ? "success" : "error"} dot>
                    {report.ok ? "ok" : "failed"}
                  </Badge>
                  <span className="text-on-surface truncate max-w-[220px]">{report.label}</span>
                  {report.error && (
                    <span className="font-mono text-[10px] text-outline truncate min-w-0" title={report.error}>
                      {report.error}
                    </span>
                  )}
                  <span
                    className={`ml-auto font-mono text-[11px] tnum shrink-0 ${
                      report.freedBytes > 0 ? "text-secondary" : "text-outline"
                    }`}
                  >
                    {bytes(report.freedBytes)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </ToolView>

      <ConfirmDialog
        open={confirmOpen}
        busy={busy}
        destructive
        title={`Purge ${plural(selectedTargets.length, "cache target")}?`}
        message={`Permanently deletes the contents of ${plural(
          selectedTargets.length,
          "directory",
          "directories",
        )}, freeing about ${bytes(selectedBytes)}. Nothing outside these paths is touched, and every target is regenerated by its build tool on the next run.`}
        confirmLabel={`Clean ${bytes(selectedBytes)}`}
        onConfirm={() => void runClean()}
        onCancel={() => {
          if (!busy) setConfirmOpen(false);
        }}
        detail={
          <div className="space-y-2">
            <div className="max-h-48 overflow-y-auto rounded-lg border border-white/[0.07] bg-black/35 divide-y divide-white/[0.05]">
              {selectedTargets.map((target) => (
                <div key={target.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-on-variant shrink-0">{kindMeta(target.kind).icon}</span>
                    <span className="truncate text-on-surface">{target.label}</span>
                  </span>
                  <span className="font-mono text-[10px] text-on-variant shrink-0">{bytes(target.sizeBytes)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-black/35 px-2 py-1.5 font-mono text-[10.5px]">
              <span className="text-outline">{plural(selectedTargets.length, "directory", "directories")} · contents only</span>
              <span className="text-error font-semibold">{bytes(selectedBytes)}</span>
            </div>
          </div>
        }
      />
    </>
  );
}
