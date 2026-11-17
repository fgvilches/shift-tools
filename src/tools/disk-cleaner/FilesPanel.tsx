import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Copy,
  FolderOpen,
  HardDrive,
  Trophy,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorNotice, InfoNotice, Progress } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Form";
import { toast } from "@/components/ui/Toast";
import { system, util } from "@/lib/api";
import { errorMessage } from "@/lib/ipc";
import { bytes, dateTime, plural, truncateMiddle } from "@/lib/format";
import type { CleanReport, DiskScanProgress, LargeFile } from "@/lib/types";

const MIN_SIZES = [
  { value: "50", label: "≥ 50 MB" },
  { value: "100", label: "≥ 100 MB" },
  { value: "500", label: "≥ 500 MB" },
  { value: "1024", label: "≥ 1 GB" },
];

const KIND_TONE: Record<string, Tone> = {
  video: "tertiary",
  archive: "warning",
  "disk image": "warning",
  application: "primary",
  binary: "neutral",
  database: "primary",
  image: "tertiary",
  document: "neutral",
  log: "neutral",
  file: "neutral",
};

export function FilesPanel({ tabs }: { tabs: ReactNode }) {
  const [root, setRoot] = useState("~");
  const [minSize, setMinSize] = useState("100");
  const [files, setFiles] = useState<LargeFile[]>([]);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<DiskScanProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [scannedRoot, setScannedRoot] = useState<string | null>(null);
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
    const unsubscribe = system.onDiskScan((payload) => {
      if (payload.phase === "files") setProgress(payload);
    });
    try {
      const list = await system.scanLargeFiles(root, Number(minSize) * 1024 * 1024, 200);
      setFiles(list);
      setScannedRoot(root);
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      unsubscribe();
      inFlight.current = false;
      setScanning(false);
      setProgress(null);
    }
  }, [root, minSize]);

  const totalBytes = useMemo(() => files.reduce((sum, f) => sum + f.sizeBytes, 0), [files]);
  const selectedFiles = useMemo(() => files.filter((f) => selected.has(f.path)), [files, selected]);
  const selectedBytes = useMemo(() => selectedFiles.reduce((sum, f) => sum + f.sizeBytes, 0), [selectedFiles]);
  const biggest = files[0];

  const reveal = useCallback(async (path: string) => {
    try {
      await util.reveal(path);
    } catch (err) {
      toast.error("Could not open Finder", errorMessage(err));
    }
  }, []);

  const copyPath = (path: string) => {
    if (!navigator.clipboard) {
      toast.error("Clipboard unavailable", "This webview blocked clipboard access.");
      return;
    }
    void navigator.clipboard
      .writeText(path)
      .then(() => toast.success("Path copied", path))
      .catch((err: unknown) => toast.error("Could not copy path", errorMessage(err)));
  };

  const trash = useCallback(async () => {
    if (selectedFiles.length === 0) {
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    try {
      const result = await system.trashPaths(selectedFiles.map((f) => f.path));
      const moved = result.filter((r) => r.ok);
      const failed = result.filter((r) => !r.ok);
      setReports(result);
      setSelected(new Set());
      setConfirmOpen(false);
      if (moved.length > 0) {
        toast.success(
          `${plural(moved.length, "file")} moved to Trash`,
          `${bytes(moved.reduce((sum, r) => sum + r.freedBytes, 0))} · recoverable from the Trash`,
        );
        setFiles((prev) => prev.filter((f) => !moved.some((m) => m.id === f.path)));
      } else if (failed.length > 0) {
        toast.error("Nothing was moved", failed[0]?.error ?? undefined);
      }
    } catch (err) {
      toast.error("Could not move files", errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }, [selectedFiles]);

  const columns: Column<LargeFile>[] = [
    {
      key: "name",
      header: "File",
      sortable: true,
      sortValue: (f) => f.name.toLowerCase(),
      render: (f) => (
        <div className="min-w-0 py-0.5 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-on-surface truncate max-w-[220px]" title={f.name}>
              {f.name}
            </span>
            <Badge tone={KIND_TONE[f.kind] ?? "neutral"}>{f.kind}</Badge>
          </div>
          <div className="font-mono text-[9.5px] text-outline/80 truncate max-w-[320px]">
            {truncateMiddle(f.path.replace(/^\/Users\/[^/]+/, "~"), 56)}
          </div>
        </div>
      ),
    },
    {
      key: "sizeBytes",
      header: "Size",
      align: "right",
      mono: true,
      width: 96,
      sortable: true,
      sortValue: (f) => f.sizeBytes,
      render: (f) => (
        <span className={f.sizeBytes > 1024 ** 3 ? "text-warning font-semibold" : "text-on-surface"}>{bytes(f.sizeBytes)}</span>
      ),
    },
    {
      key: "modified",
      header: "Modified",
      width: 128,
      hideBelow: "md",
      sortable: true,
      sortValue: (f) => f.modified,
      render: (f) => <span className="font-mono text-[10.5px] text-outline">{f.modified ? dateTime(f.modified) : "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      width: 76,
      align: "right",
      render: (f) => (
        <div className="flex items-center justify-end gap-0.5">
          <IconButton size="sm" label={`Copy path of ${f.name}`} icon={<Copy size={11} />} onClick={() => copyPath(f.path)} />
          <IconButton size="sm" label={`Reveal ${f.name} in Finder`} icon={<FolderOpen size={11} />} onClick={() => void reveal(f.path)} />
        </div>
      ),
    },
  ];

  const okCount = reports?.filter((r) => r.ok).length ?? 0;
  const movedBytes = reports?.reduce((sum, r) => sum + r.freedBytes, 0) ?? 0;

  return (
    <>
      <ToolView
        eyebrow="LARGEST FILES"
        eyebrowTone="warning"
        eyebrowHint="RANKED BY SIZE"
        title="Disk Cleaner"
        description="Find the biggest files on this Mac, ordered by size, and move the ones you do not need to the Trash."
        telemetry={[
          { label: "Top 200 size", value: bytes(totalBytes), tone: "tertiary", icon: <HardDrive size={14} /> },
          { label: "Files listed", value: String(files.length), tone: "neutral", icon: <Trophy size={14} /> },
          {
            label: "Biggest",
            value: biggest ? bytes(biggest.sizeBytes) : "—",
            tone: "warning",
            icon: <ShieldAlert size={14} />,
          },
        ]}
        toolbar={
          <>
            {tabs}
            <div className="w-40">
              <Input
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void scan();
                }}
                placeholder="~ or /Volumes/…"
                aria-label="Directory to scan"
                sizeVariant="sm"
                mono
                leading={<Search size={11} />}
              />
            </div>
            <div className="w-32">
              <Select
                value={minSize}
                onChange={(e) => setMinSize(e.target.value)}
                options={MIN_SIZES}
                sizeVariant="sm"
                aria-label="Minimum file size"
              />
            </div>
            <Button
              icon={<RefreshCw size={13} />}
              onClick={() => void scan()}
              loading={scanning}
              disabled={scanning || busy}
            >
              Scan files
            </Button>
            <Button
              variant="destructive"
              icon={<Trash2 size={13} />}
              onClick={() => setConfirmOpen(true)}
              disabled={selectedBytes === 0 || scanning || busy}
            >
              Move to Trash{selectedBytes > 0 ? ` (${bytes(selectedBytes)})` : ""}
            </Button>
          </>
        }
        status={
          scanning ? (
            <Badge tone="primary" dot pulse>
              {progress ? `${progress.scanned.toLocaleString("en-US")} entries · ${elapsed}s` : `walking · ${elapsed}s`}
            </Badge>
          ) : (
            <Badge tone={files.length > 0 ? "success" : "neutral"} dot>
              {scannedRoot ? `${plural(files.length, "file")} in ${scannedRoot}` : "not scanned"}
            </Badge>
          )
        }
      >
        {error && <ErrorNotice title="File scan failed" message={error} onRetry={() => void scan()} />}

        <InfoNotice tone="neutral" icon={<ShieldAlert size={12} />}>
          Files are never deleted here: moving to Trash keeps them recoverable. The walk is bounded to 90 seconds, so a
          huge volume may report partial results — run it again on a narrower folder for a full pass.
        </InfoNotice>

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader
            title="Largest files"
            hint={`${plural(files.length, "file")} · sorted by size descending`}
            icon={<Trophy size={13} />}
            actions={
              <>
                <Badge tone={selectedBytes > 0 ? "primary" : "neutral"} mono>
                  {bytes(selectedBytes)} selected
                </Badge>
                <Badge tone="tertiary" mono>
                  {bytes(totalBytes)} listed
                </Badge>
              </>
            }
          />
          {scanning && <Progress indeterminate label="Walking the filesystem" height={2} />}
          <div className="min-h-0 flex-1 overflow-auto">
            <DataTable
              ariaLabel="Largest files on disk"
              columns={columns}
              rows={files}
              rowKey={(f) => f.path}
              selected={selected}
              onSelectedChange={setSelected}
              rowTone={(f) => (f.sizeBytes > 5 * 1024 ** 3 ? "warning" : null)}
              initialSort={{ key: "sizeBytes", dir: "desc" }}
              empty={
                <EmptyState
                  compact
                  icon={scanning ? <RefreshCw size={16} className="animate-spin" /> : <Trophy size={16} />}
                  title={scanning ? "Walking the filesystem…" : "No scan yet"}
                  description={
                    scanning
                      ? "Counting file sizes. Large volumes take up to 90 seconds."
                      : "Pick a folder and a minimum size, then scan to rank the biggest files."
                  }
                  action={
                    !scanning ? (
                      <Button size="xs" icon={<Search size={11} />} onClick={() => void scan()}>
                        Scan {root}
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
              title="Trash report"
              hint={`${okCount}/${reports.length} moved · ${bytes(movedBytes)}`}
              icon={<Trash2 size={13} />}
              actions={<IconButton label="Dismiss trash report" icon={<X size={12} />} size="sm" onClick={() => setReports(null)} />}
            />
            <div className="max-h-36 overflow-y-auto divide-y divide-white/[0.05]">
              {reports.map((report) => (
                <div key={report.id} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
                  <Badge tone={report.ok ? "success" : "error"} dot>
                    {report.ok ? "moved" : "failed"}
                  </Badge>
                  <span className="text-on-surface truncate max-w-[260px]">{report.label}</span>
                  {report.error && (
                    <span className="font-mono text-[10px] text-outline truncate min-w-0" title={report.error}>
                      {report.error}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-on-variant tnum shrink-0">{bytes(report.freedBytes)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </ToolView>

      <ConfirmDialog
        open={confirmOpen}
        busy={busy}
        title={`Move ${plural(selectedFiles.length, "file")} to the Trash?`}
        message={`About ${bytes(selectedBytes)} will move to the Trash, where you can still recover it. Nothing is deleted permanently from here.`}
        confirmLabel="Move to Trash"
        onConfirm={() => void trash()}
        onCancel={() => {
          if (!busy) setConfirmOpen(false);
        }}
        detail={
          <div className="max-h-48 overflow-y-auto rounded-lg border border-white/[0.07] bg-black/35 divide-y divide-white/[0.05]">
            {selectedFiles.slice(0, 20).map((file) => (
              <div key={file.path} className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
                <span className="truncate text-on-surface">{file.name}</span>
                <span className="font-mono text-[10px] text-on-variant shrink-0">{bytes(file.sizeBytes)}</span>
              </div>
            ))}
            {selectedFiles.length > 20 && (
              <div className="px-2 py-1.5 text-[10.5px] text-outline">+ {selectedFiles.length - 20} more</div>
            )}
          </div>
        }
      />
    </>
  );
}
