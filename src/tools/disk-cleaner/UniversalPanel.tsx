import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Copy,
  Database,
  FolderOpen,
  HardDrive,
  Radar,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorNotice, InfoNotice, Progress } from "@/components/ui/Feedback";
import { SegmentedControl } from "@/components/ui/Form";
import { toast } from "@/components/ui/Toast";
import { system, util } from "@/lib/api";
import { errorMessage } from "@/lib/ipc";
import { bytes, plural, relative, truncateMiddle } from "@/lib/format";
import type { CacheEntry, CleanReport, DiskScanProgress } from "@/lib/types";

const PRESETS = [
  { value: "all", label: "Everything", roots: [] as string[] },
  { value: "user", label: "User + apps", roots: ["user", "apps"] },
  { value: "dev", label: "Dev caches", roots: ["dev"] },
  { value: "system", label: "System", roots: ["system"] },
] as const;

type Preset = (typeof PRESETS)[number]["value"];

const KIND_TONE: Record<string, Tone> = {
  "user-cache": "primary",
  "app-container": "tertiary",
  "dev-cache": "success",
  xcode: "warning",
  "system-cache": "neutral",
};

function copyPath(path: string) {
  if (!navigator.clipboard) {
    toast.error("Clipboard unavailable", "This webview blocked clipboard access.");
    return;
  }
  void navigator.clipboard
    .writeText(path)
    .then(() => toast.success("Path copied", path))
    .catch((err: unknown) => toast.error("Could not copy path", errorMessage(err)));
}

export function UniversalPanel({ tabs }: { tabs: ReactNode }) {
  const [preset, setPreset] = useState<Preset>("all");
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<DiskScanProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<CleanReport[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!scanning) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [scanning]);

  const scan = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setScanning(true);
    setError(null);
    setProgress(null);
    const roots = PRESETS.find((p) => p.value === preset)?.roots ?? [];
    const unsubscribe = system.onDiskScan((payload) => {
      if (payload.phase === "caches") setProgress(payload);
    });
    try {
      const list = await system.scanCaches([...roots]);
      setEntries(list);
      setLastScanAt(new Date().toISOString());
      setSelected(new Set(list.filter((e) => e.sizeBytes > 0).map((e) => e.path)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      unsubscribe();
      inFlight.current = false;
      setScanning(false);
      setProgress(null);
    }
  }, [preset]);

  useEffect(() => {
    void scan();
    // Scan once on mount; the preset control triggers a rescan explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalBytes = useMemo(() => entries.reduce((sum, e) => sum + e.sizeBytes, 0), [entries]);
  const selectedEntries = useMemo(() => entries.filter((e) => selected.has(e.path)), [entries, selected]);
  const selectedBytes = useMemo(() => selectedEntries.reduce((sum, e) => sum + e.sizeBytes, 0), [selectedEntries]);
  const lockedCount = useMemo(() => entries.filter((e) => !e.writable).length, [entries]);

  const clean = useCallback(async () => {
    if (selectedEntries.length === 0) {
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    try {
      const result = await system.cleanCachePaths(selectedEntries.map((e) => e.path));
      const freed = result.reduce((sum, r) => sum + r.freedBytes, 0);
      const failed = result.filter((r) => !r.ok);
      setReports(result);
      setSelected(new Set());
      setConfirmOpen(false);
      if (freed > 0) {
        toast.success(`${bytes(freed)} freed`, `${result.length - failed.length}/${result.length} cache directories cleared`);
      } else if (failed.length > 0) {
        toast.error("Nothing could be freed", failed[0]?.error ?? undefined);
      } else {
        toast.info("Caches already empty", "The selected directories held no reclaimable files.");
      }
      await scan();
    } catch (err) {
      toast.error("Clean failed", errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }, [selectedEntries, scan]);

  const reveal = useCallback(async (path: string) => {
    try {
      await util.reveal(path);
    } catch (err) {
      toast.error("Could not open Finder", errorMessage(err));
    }
  }, []);

  const columns: Column<CacheEntry>[] = [
    {
      key: "label",
      header: "Cache",
      sortable: true,
      sortValue: (e) => e.label.toLowerCase(),
      render: (e) => (
        <div className="flex items-center gap-2 min-w-0 py-0.5">
          <span className="w-5 h-5 rounded-md bg-white/[0.05] border border-white/[0.06] flex items-center justify-center shrink-0 text-on-variant">
            <Database size={10} />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-on-surface truncate max-w-[190px]">{e.label}</span>
              {e.sizeBytes > 2 * 1024 ** 3 && (
                <Badge tone="warning" className="h-4">
                  heavy
                </Badge>
              )}
              {!e.writable && (
                <Badge tone="neutral" className="h-4" title="Not writable without elevated privileges">
                  locked
                </Badge>
              )}
            </div>
            <div className="font-mono text-[9.5px] text-outline/80 truncate max-w-[240px]">
              {truncateMiddle(e.path.replace(/^\/Users\/[^/]+/, "~"), 40)}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      width: 108,
      sortable: true,
      sortValue: (e) => e.kind,
      render: (e) => (
        <Badge tone={KIND_TONE[e.kind] ?? "neutral"} mono>
          {e.kind.replace("-cache", "").replace("app-container", "app")}
        </Badge>
      ),
    },
    {
      key: "fileCount",
      header: "Files",
      align: "right",
      mono: true,
      width: 74,
      sortable: true,
      sortValue: (e) => e.fileCount,
      render: (e) => <span className="text-outline">{e.fileCount.toLocaleString("en-US")}</span>,
    },
    {
      key: "sizeBytes",
      header: "Size",
      align: "right",
      mono: true,
      width: 92,
      sortable: true,
      sortValue: (e) => e.sizeBytes,
      render: (e) => (
        <span
          className={e.sizeBytes > 2 * 1024 ** 3 ? "text-warning" : "text-on-surface"}
          title={e.partial ? "Walk stopped at the time budget: real size is at least this" : undefined}
        >
          {e.partial ? "≥ " : ""}
          {bytes(e.sizeBytes)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: 72,
      align: "right",
      render: (e) => (
        <div className="flex items-center justify-end gap-0.5">
          <IconButton size="sm" label={`Copy path for ${e.label}`} icon={<Copy size={11} />} onClick={() => copyPath(e.path)} />
          <IconButton
            size="sm"
            label={`Reveal ${e.label} in Finder`}
            icon={<FolderOpen size={11} />}
            onClick={() => void reveal(e.path)}
          />
        </div>
      ),
    },
  ];

  const okCount = reports?.filter((r) => r.ok).length ?? 0;
  const freedTotal = reports?.reduce((sum, r) => sum + r.freedBytes, 0) ?? 0;

  return (
    <>
      <ToolView
        eyebrow="UNIVERSAL SCAN"
        eyebrowTone="primary"
        eyebrowHint="EVERY CACHE ON THIS MAC"
        title="Disk Cleaner"
        description="Sweep beyond the curated list: user caches, app containers, developer stores and system caches, ranked by size."
        telemetry={[
          { label: "Reclaimable", value: bytes(totalBytes), tone: "tertiary", icon: <HardDrive size={14} /> },
          { label: "Caches found", value: String(entries.length), tone: "neutral", icon: <Radar size={14} /> },
          {
            label: "Locked",
            value: String(lockedCount),
            tone: lockedCount > 0 ? "warning" : "success",
            icon: <ShieldCheck size={14} />,
          },
        ]}
        toolbar={
          <>
            {tabs}
            <SegmentedControl
              value={preset}
              onChange={(value) => {
                setPreset(value);
                setEntries([]);
                setSelected(new Set());
              }}
              ariaLabel="Scan scope"
              options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            />
            <Button icon={<RefreshCw size={13} />} onClick={() => void scan()} loading={scanning} disabled={scanning || busy} trailing={<Kbd>⌘S</Kbd>}>
              Scan
            </Button>
            <Button
              variant="destructive"
              icon={<Trash2 size={13} />}
              onClick={() => setConfirmOpen(true)}
              disabled={selectedBytes === 0 || scanning || busy}
            >
              Clean selected{selectedBytes > 0 ? ` (${bytes(selectedBytes)})` : ""}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSelected(new Set(entries.filter((e) => e.sizeBytes > 0).map((e) => e.path)))}
              disabled={entries.length === 0 || scanning}
            >
              Select all
            </Button>
          </>
        }
        status={
          scanning ? (
            <Badge tone="primary" dot pulse>
              {progress ? `${progress.scanned}/${progress.total} · ${elapsed}s` : `scanning · ${elapsed}s`}
            </Badge>
          ) : (
            <Badge tone={totalBytes > 0 ? "success" : "neutral"} dot>
              {lastScanAt ? `${bytes(totalBytes)} · ${relative(lastScanAt)}` : "not scanned"}
            </Badge>
          )
        }
      >
        {error && <ErrorNotice title="Cache scan failed" message={error} onRetry={() => void scan()} />}

        <InfoNotice tone="neutral" icon={<ShieldCheck size={12} />}>
          Cleaning deletes the <span className="font-medium">contents</span> of each cache directory and keeps the
          directory itself. The Rust core refuses any path outside your home or <span className="font-mono">/Library/Caches</span>,
          and never touches a container that is not a cache.
        </InfoNotice>

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader
            title="Discovered caches"
            hint={`${plural(entries.length, "directory", "directories")} · sorted by size`}
            icon={<Radar size={13} />}
            actions={
              <>
                <Badge tone={selectedBytes > 0 ? "primary" : "neutral"} mono>
                  {bytes(selectedBytes)} selected
                </Badge>
                <Badge tone="tertiary" mono>
                  {bytes(totalBytes)} total
                </Badge>
              </>
            }
          />
          {scanning && <Progress indeterminate label="Scanning cache directories" height={2} />}
          <div className="min-h-0 flex-1 overflow-auto">
            <DataTable
              ariaLabel="Discovered cache directories"
              columns={columns}
              rows={entries}
              rowKey={(e) => e.path}
              selected={selected}
              onSelectedChange={setSelected}
              initialSort={{ key: "sizeBytes", dir: "desc" }}
              empty={
                <EmptyState
                  compact
                  icon={scanning ? <RefreshCw size={16} className="animate-spin" /> : error ? <AlertTriangle size={16} className="text-error" /> : <Radar size={16} />}
                  title={scanning ? "Walking the cache roots…" : error ? "Scan failed" : "No caches in this scope"}
                  description={
                    scanning
                      ? "Measuring each cache directory. App containers can take a while."
                      : error
                        ? "The backend rejected the request. Retry to scan again."
                        : "Try a wider scope, or run the scan again after using some apps."
                  }
                  action={
                    !scanning ? (
                      <Button size="xs" icon={<RefreshCw size={11} />} onClick={() => void scan()}>
                        Scan now
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          </div>
        </Card>

        {reports && (
          <Card className="overflow-hidden">
            <CardHeader
              title="Clean report"
              hint={`${okCount}/${reports.length} cleared · ${bytes(freedTotal)} freed`}
              icon={<ShieldCheck size={13} />}
              actions={
                <IconButton label="Dismiss clean report" icon={<X size={12} />} size="sm" onClick={() => setReports(null)} />
              }
            />
            <div className="max-h-40 overflow-y-auto divide-y divide-white/[0.05]">
              {reports.map((report) => (
                <div key={report.id} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
                  <Badge tone={report.ok ? "success" : "error"} dot>
                    {report.ok ? "ok" : "failed"}
                  </Badge>
                  <span className="text-on-surface truncate max-w-[240px]">{report.label}</span>
                  {report.error && (
                    <span className="font-mono text-[10px] text-outline truncate min-w-0" title={report.error}>
                      {report.error}
                    </span>
                  )}
                  <span className={`ml-auto font-mono text-[11px] tnum shrink-0 ${report.freedBytes > 0 ? "text-secondary" : "text-outline"}`}>
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
        title={`Clear ${plural(selectedEntries.length, "cache directory", "cache directories")}?`}
        message={`Deletes the contents of ${plural(selectedEntries.length, "directory", "directories")}, freeing about ${bytes(selectedBytes)}. Directories stay, apps rebuild their caches on next launch.`}
        confirmLabel={`Clean ${bytes(selectedBytes)}`}
        onConfirm={() => void clean()}
        onCancel={() => {
          if (!busy) setConfirmOpen(false);
        }}
        detail={
          <div className="max-h-48 overflow-y-auto rounded-lg border border-white/[0.07] bg-black/35 divide-y divide-white/[0.05]">
            {selectedEntries.slice(0, 20).map((entry) => (
              <div key={entry.path} className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
                <span className="truncate text-on-surface">{entry.label}</span>
                <span className="font-mono text-[10px] text-on-variant shrink-0">{bytes(entry.sizeBytes)}</span>
              </div>
            ))}
            {selectedEntries.length > 20 && (
              <div className="px-2 py-1.5 text-[10.5px] text-outline">+ {selectedEntries.length - 20} more</div>
            )}
          </div>
        }
      />
    </>
  );
}
