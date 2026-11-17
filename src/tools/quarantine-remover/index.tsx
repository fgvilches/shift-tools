import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  AppWindow,
  ArrowRightLeft,
  Check,
  FileArchive,
  FileCode2,
  FolderOpen,
  Minus,
  Package,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { CopyButton } from "@/components/ui/CodeArea";
import { DropZone } from "@/components/ui/DropZone";
import { Input, Switch } from "@/components/ui/Form";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorNotice, InfoNotice } from "@/components/ui/Feedback";
import { LogViewer, type LogEntry } from "@/components/ui/LogViewer";
import { toast } from "@/components/ui/Toast";
import { system, util } from "@/lib/api";
import { errorMessage, isTauri } from "@/lib/ipc";
import { bytes, clockTime, plural } from "@/lib/format";
import type { BundleInspection, QuarantineResult } from "@/lib/types";

const ACCEPTED = [".app", ".dmg", ".pkg"];

interface QueuedTarget {
  path: string;
  inspection: BundleInspection | null;
  inspecting: boolean;
  inspectError: string | null;
  result: QuarantineResult | null;
  clearedAt: string | null;
}

interface PlannedCommand {
  command: string;
  active: boolean;
  note: string;
}

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
}

function parentDir(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut > 0 ? trimmed.slice(0, cut) : "/";
}

function quotePath(path: string): string {
  return /[\s'"$`]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

function targetIcon(target: QueuedTarget) {
  const kind = (target.inspection?.kind ?? "").toLowerCase();
  if (target.inspection?.isApp || kind.includes("app")) {
    return { icon: <AppWindow size={13} />, tone: "text-primary-soft" };
  }
  if (kind.includes("dmg") || kind.includes("disk") || kind.includes("image")) {
    return { icon: <FileArchive size={13} />, tone: "text-tertiary" };
  }
  if (kind.includes("pkg") || kind.includes("install")) {
    return { icon: <Package size={13} />, tone: "text-[#8ff0a4]" };
  }
  return { icon: <FileCode2 size={13} />, tone: "text-on-variant" };
}

function targetState(target: QueuedTarget): { label: string; tone: Tone } {
  if (target.inspecting) return { label: "Inspecting", tone: "primary" };
  if (target.inspectError) return { label: "Error", tone: "error" };
  if (!target.inspection) return { label: "Queued", tone: "neutral" };
  if (!target.inspection.exists) return { label: "Missing", tone: "warning" };
  if (target.result?.status === "error") return { label: "Failed", tone: "error" };
  if (target.result?.status === "cleaned" && !target.inspection.hasQuarantine) {
    return { label: "Cleared", tone: "success" };
  }
  if (target.inspection.hasQuarantine) return { label: "Quarantined", tone: "warning" };
  return { label: "Clean", tone: "success" };
}

function AttributeRow({
  attribute,
  variant = "plain",
}: {
  attribute: string;
  variant?: "plain" | "removed" | "kept";
}) {
  const split = attribute.indexOf(": ");
  const key = split >= 0 ? attribute.slice(0, split) : attribute;
  const value = split >= 0 ? attribute.slice(split + 2) : "";
  return (
    <div className="flex items-start gap-1.5 font-mono text-[10.5px] leading-[16px]">
      {variant === "removed" && <Minus size={10} className="mt-[3px] shrink-0 text-error" />}
      {variant === "kept" && <Check size={10} className="mt-[3px] shrink-0 text-secondary" />}
      {variant === "plain" && <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/70" />}
      <span className="min-w-0 break-all">
        <span
          className={clsx(
            "text-primary-soft",
            variant === "removed" && "text-outline line-through",
            variant === "kept" && "text-[#c8e6d0]",
          )}
        >
          {key}
        </span>
        {value && <span className="text-outline">: {value}</span>}
      </span>
    </div>
  );
}

function MiniStat({ label, value, tone = "text-on-surface" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.055] bg-black/30 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.08em] text-outline">{label}</div>
      <div className={clsx("truncate font-mono text-[11.5px] tnum", tone)} title={value}>
        {value}
      </div>
    </div>
  );
}

export default function QuarantineRemoverView() {
  const [targets, setTargets] = useState<QueuedTarget[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(true);
  const [pathInput, setPathInput] = useState("");
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nativeDragOver, setNativeDragOver] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logSeq = useRef(0);

  const log = useCallback((level: LogEntry["level"], message: string, detail?: string) => {
    logSeq.current += 1;
    setLogs((prev) => [
      ...prev.slice(-240),
      {
        id: logSeq.current,
        level,
        message,
        detail,
        timestamp: new Date().toLocaleTimeString("en-GB", { hour12: false }),
      },
    ]);
  }, []);

  const inspectTarget = useCallback(
    async (path: string, quiet = false) => {
      setTargets((prev) => prev.map((t) => (t.path === path ? { ...t, inspecting: true, inspectError: null } : t)));
      try {
        const inspection = await system.inspectBundle(path);
        setTargets((prev) => prev.map((t) => (t.path === path ? { ...t, inspection, inspecting: false } : t)));
        if (!quiet) {
          log(
            "info",
            `Inspected ${baseName(path)}`,
            inspection.exists
              ? `${inspection.kind} · ${plural(inspection.attributes.length, "attribute")}`
              : "path does not exist",
          );
        }
      } catch (err) {
        const message = errorMessage(err);
        setTargets((prev) => prev.map((t) => (t.path === path ? { ...t, inspecting: false, inspectError: message } : t)));
        log("error", `Inspection failed — ${baseName(path)}`, message);
      }
    },
    [log],
  );

  const addPaths = useCallback(
    (paths: string[]) => {
      const cleaned = paths.map((p) => p.trim()).filter((p) => p.length > 0);
      const known = new Set(targets.map((t) => t.path));
      const fresh: QueuedTarget[] = [];
      for (const path of cleaned) {
        if (known.has(path)) continue;
        known.add(path);
        fresh.push({
          path,
          inspection: null,
          inspecting: true,
          inspectError: null,
          result: null,
          clearedAt: null,
        });
      }
      if (fresh.length === 0) return;
      setTargets((prev) => [...prev, ...fresh.filter((f) => !prev.some((t) => t.path === f.path))]);
      setSelected((prev) => prev ?? fresh[0].path);
      log("info", `Queued ${plural(fresh.length, "target")}`, fresh.map((f) => baseName(f.path)).join(", "));
      for (const target of fresh) void inspectTarget(target.path);
    },
    [targets, inspectTarget, log],
  );

  const addPathsRef = useRef(addPaths);
  useEffect(() => {
    addPathsRef.current = addPaths;
  }, [addPaths]);

  const browse = useCallback(async () => {
    if (!isTauri) {
      toast.error("Native app required", "Launch the desktop build to use the macOS file picker.");
      return;
    }
    try {
      const picked = await open({
        multiple: true,
        directory: false,
        title: "Select apps, disk images or installers",
        filters: [
          { name: "Bundles & installers", extensions: ["app", "dmg", "pkg"] },
          { name: "Executables", extensions: ["bin", "sh", "command", "zip"] },
        ],
      });
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      if (paths.length > 0) addPaths(paths);
    } catch (err) {
      toast.error("Could not open the file picker", errorMessage(err));
    }
  }, [addPaths]);

  const inspectTypedPath = () => {
    const value = pathInput.trim();
    if (!value) return;
    addPaths([value]);
    setPathInput("");
  };

  const refreshAll = () => {
    if (targets.length === 0) return;
    void Promise.all(targets.map((t) => inspectTarget(t.path)));
  };

  const removeTarget = (path: string) => {
    const next = targets.filter((t) => t.path !== path);
    setTargets(next);
    setSelected((current) => (current === path ? (next[0]?.path ?? null) : current));
    setConfirmPath((current) => (current === path ? null : current));
  };

  const clearQueue = () => {
    if (targets.length === 0) return;
    setTargets([]);
    setSelected(null);
    setActionError(null);
    log("info", "Queue cleared", `${plural(targets.length, "target")} dropped from the workbench`);
  };

  const confirmTarget = useMemo(
    () => targets.find((t) => t.path === confirmPath) ?? null,
    [targets, confirmPath],
  );

  const executeClear = async () => {
    if (!confirmPath) return;
    const path = confirmPath;
    setBusy(true);
    setActionError(null);
    log("info", `Clear requested — ${baseName(path)}`, path);
    try {
      const result = await system.clearQuarantine(path, recursive);
      for (const command of result.commands) log("debug", command);
      log(
        result.status === "error" ? "error" : result.status === "cleaned" ? "success" : "info",
        result.message,
        `${result.attributesBefore.length} → ${result.attributesAfter.length} keys`,
      );
      setTargets((prev) =>
        prev.map((t) =>
          t.path === path ? { ...t, result, clearedAt: new Date().toISOString() } : t,
        ),
      );
      if (result.status === "cleaned") {
        const afterKeys = new Set(result.attributesAfter);
        const removedKeys = result.attributesBefore.filter((a) => !afterKeys.has(a)).length;
        toast.success("Quarantine cleared", `${baseName(path)} · ${plural(removedKeys, "attribute")} removed`);
      } else if (result.status === "already_clean") {
        toast.info("Already clean", result.message);
      } else {
        toast.error("Clear reported an error", result.message);
      }
      void inspectTarget(path, true);
    } catch (err) {
      const message = errorMessage(err);
      setActionError(message);
      log("error", `Clear failed — ${baseName(path)}`, message);
      toast.error("Clear failed", message);
    } finally {
      setBusy(false);
      setConfirmPath(null);
    }
  };

  const revealTarget = async (path: string) => {
    try {
      await util.reveal(path);
      log("info", `Revealed ${baseName(path)} in Finder`);
    } catch (err) {
      toast.error("Could not reveal target", errorMessage(err));
    }
  };

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setNativeDragOver(true);
        } else if (payload.type === "leave") {
          setNativeDragOver(false);
        } else if (payload.type === "drop") {
          setNativeDragOver(false);
          if (payload.paths.length > 0) addPathsRef.current(payload.paths);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => setNativeDragOver(false));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void browse();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [browse]);

  const selectedTarget = useMemo(
    () => targets.find((t) => t.path === selected) ?? null,
    [targets, selected],
  );

  const quarantinedCount = targets.filter((t) => t.inspection?.hasQuarantine).length;
  const clearedCount = targets.filter((t) => t.result?.status === "cleaned").length;
  const attributeCount = targets.reduce((sum, t) => sum + (t.inspection?.attributes.length ?? 0), 0);
  const pendingCount = targets.filter((t) => t.inspecting).length;
  const errorCount = targets.filter((t) => t.inspectError || t.result?.status === "error").length;
  const firstInspectError = targets.find((t) => t.inspectError)?.inspectError ?? null;

  const canClear = Boolean(selectedTarget?.inspection?.hasQuarantine) && !busy;

  const planned = useMemo<PlannedCommand[]>(() => {
    if (!selectedTarget) return [];
    const quoted = quotePath(selectedTarget.path);
    const hasQuarantine = selectedTarget.inspection?.hasQuarantine ?? false;
    const known = selectedTarget.inspection !== null;
    return [
      {
        command: `xattr -d com.apple.quarantine ${quoted}`,
        active: hasQuarantine,
        note: !known ? "awaiting inspection" : hasQuarantine ? "removes the Gatekeeper flag" : "flag already absent",
      },
      {
        command: `xattr -cr ${quoted}`,
        active: recursive && known,
        note: !known
          ? "awaiting inspection"
          : recursive
            ? "recursively strips remaining extended attributes"
            : "recursive strip disabled",
      },
    ];
  }, [selectedTarget, recursive]);

  const plannedText = planned.map((p) => p.command).join("\n");

  const columns: Column<QueuedTarget>[] = [
    {
      key: "path",
      header: "Target bundle",
      sortable: true,
      sortValue: (t) => baseName(t.path).toLowerCase(),
      render: (t) => {
        const glyph = targetIcon(t);
        return (
          <div className="flex min-w-0 items-center gap-2 py-0.5">
            <span
              className={clsx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.04]",
                glyph.tone,
              )}
            >
              {glyph.icon}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="max-w-[240px] truncate text-[12px] font-medium text-on-surface" title={t.path}>
                  {baseName(t.path)}
                </span>
                {t.inspection?.hasQuarantine && <Badge tone="warning" className="h-4 px-1.5 text-[9px]">xattr</Badge>}
              </div>
              <div className="max-w-[320px] truncate font-mono text-[9.5px] text-outline/80" title={t.path}>
                {parentDir(t.path)}
              </div>
              {!t.inspection && !t.inspectError && t.inspecting && (
                <div className="mt-0.5 font-mono text-[9.5px] text-outline/70">reading extended attributes…</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "attributes",
      header: "xattr state",
      hideBelow: "lg",
      width: 180,
      render: (t) => {
        if (!t.inspection) {
          return <span className="font-mono text-[10px] text-outline/70">{t.inspecting ? "scanning" : "—"}</span>;
        }
        return (
          <div className="leading-tight">
            <div className="truncate font-mono text-[10px] text-primary-soft">
              {t.inspection.hasQuarantine ? "com.apple.quarantine" : "quarantine absent"}
            </div>
            <div className="font-mono text-[9.5px] text-outline">
              {plural(t.inspection.attributes.length, "key")}
            </div>
          </div>
        );
      },
    },
    {
      key: "sizeBytes",
      header: "Size",
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (t) => t.inspection?.sizeBytes ?? 0,
      width: 78,
      render: (t) => (
        <span className="text-on-variant">{t.inspection ? bytes(t.inspection.sizeBytes) : "—"}</span>
      ),
    },
    {
      key: "state",
      header: "Status",
      width: 112,
      render: (t) => {
        const state = targetState(t);
        return (
          <Badge
            tone={state.tone}
            dot
            mono={state.label === "Quarantined"}
            title={t.inspectError ?? (t.result?.status === "error" ? t.result.message : undefined)}
          >
            {state.label}
          </Badge>
        );
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 62,
      render: (t) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconButton
            size="sm"
            label={`Reveal ${baseName(t.path)} in Finder`}
            icon={<FolderOpen size={12} />}
            onClick={() => void revealTarget(t.path)}
          />
          <IconButton
            size="sm"
            tone="danger"
            label={`Remove ${baseName(t.path)} from queue`}
            icon={<X size={12} />}
            onClick={() => removeTarget(t.path)}
          />
        </div>
      ),
    },
  ];

  const diff = useMemo(() => {
    const result = selectedTarget?.result;
    if (!result) return null;
    const after = new Set(result.attributesAfter);
    const removed = result.attributesBefore.filter((a) => !after.has(a));
    const kept = result.attributesBefore.filter((a) => after.has(a));
    return { result, removed, kept, added: result.attributesAfter.filter((a) => !result.attributesBefore.includes(a)) };
  }, [selectedTarget]);

  return (
    <>
      <ToolView
        eyebrow="GATEKEEPER BYPASS"
        eyebrowTone={!isTauri ? "neutral" : quarantinedCount > 0 ? "warning" : "success"}
        eyebrowHint={
          !isTauri ? "PREVIEW · NO IPC" : pendingCount > 0 ? `${pendingCount} INSPECTING` : "XATTR ENGINE READY"
        }
        title="Quarantine Remover"
        description="Strip com.apple.quarantine and extended attributes from apps, disk images, and installers."
        telemetry={[
          {
            label: "Queued",
            value: String(targets.length),
            tone: "primary",
            icon: <ScanLine size={14} />,
          },
          {
            label: "Quarantined",
            value: String(quarantinedCount),
            tone: quarantinedCount > 0 ? "warning" : "success",
            icon: <ShieldAlert size={14} />,
          },
          {
            label: "xattr keys",
            value: String(attributeCount),
            tone: "neutral",
            icon: <FileCode2 size={14} />,
          },
          {
            label: "Cleared",
            value: String(clearedCount),
            tone: "success",
            icon: <ShieldCheck size={14} />,
          },
        ]}
        toolbar={
          <>
            <Button
              variant="primary"
              icon={<FolderOpen size={13} />}
              onClick={() => void browse()}
              trailing={<Kbd>⌘O</Kbd>}
            >
              Choose bundle
            </Button>
            <Button
              variant="destructive"
              icon={<ShieldOff size={13} />}
              onClick={() => selectedTarget && setConfirmPath(selectedTarget.path)}
              disabled={!canClear}
            >
              Clear quarantine
            </Button>
            <Button
              icon={<RefreshCw size={13} />}
              onClick={refreshAll}
              disabled={targets.length === 0 || pendingCount > 0}
            >
              Re-inspect all
            </Button>
          </>
        }
        status={
          <>
            <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
              Recursive strip
              <Switch checked={recursive} onChange={setRecursive} label="Toggle recursive attribute strip" size="sm" />
            </span>
            <span className="hidden font-mono text-[9.5px] uppercase tracking-[0.08em] text-outline sm:inline">
              {recursive ? "xattr -cr" : "xattr -d only"}
            </span>
            <IconButton
              label="Re-inspect every queued target"
              icon={<RefreshCw size={13} />}
              onClick={refreshAll}
              disabled={targets.length === 0 || pendingCount > 0}
            />
          </>
        }
      >
        {!isTauri && (
          <ErrorNotice
            title="Native backend required"
            message="Extended attributes can only be read and cleared from the Rust core. Launch the desktop build with npm run app."
          />
        )}
        {actionError && (
          <ErrorNotice
            title="Quarantine clear failed"
            message={actionError}
            onRetry={selectedTarget ? () => setConfirmPath(selectedTarget.path) : undefined}
            retryLabel="Try again"
          />
        )}
        {isTauri && firstInspectError && (
          <ErrorNotice
            title="One or more inspections failed"
            message={firstInspectError}
            onRetry={() => {
              for (const t of targets.filter((x) => x.inspectError)) void inspectTarget(t.path);
            }}
            retryLabel="Re-inspect"
          />
        )}

        <Card className="p-2.5">
          <div className="relative">
            <DropZone
              accept={ACCEPTED}
              multiple
              onPaths={addPaths}
              title="Drop .app, .dmg or .pkg bundles"
              description="Each target is inspected before any attribute is touched. Bare binaries can be added by path below."
              icon={<ShieldOff size={18} />}
            >
              <div className="flex flex-col items-center gap-2 px-6 py-5 text-center">
                <div className="relative flex items-center justify-center">
                  <span aria-hidden className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
                  <span className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-primary-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                    <ShieldOff size={20} />
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-[12.5px] font-medium text-on-surface">
                    Drop{" "}
                    <span className="font-mono text-primary-soft">.app</span>,{" "}
                    <span className="font-mono text-primary-soft">.dmg</span> or{" "}
                    <span className="font-mono text-primary-soft">.pkg</span> bundles
                  </p>
                  <p className="text-[11px] text-outline">
                    Extended attributes are read through the Rust core first; file contents and signatures are never
                    modified.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5">
                  {ACCEPTED.map((ext) => (
                    <span
                      key={ext}
                      className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9.5px] text-on-variant"
                    >
                      {ext}
                    </span>
                  ))}
                  <span className="font-mono text-[9.5px] text-outline">· multiple targets allowed</span>
                </div>
              </div>
            </DropZone>
            {nativeDragOver && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-primary/60 bg-primary/[0.08]">
                <span className="rounded-full border border-primary/40 bg-[#0a0a0f]/90 px-3 py-1 font-mono text-[11px] text-primary-soft">
                  Release to inspect
                </span>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <div className="min-w-0 flex-1 sm:max-w-xl">
              <Input
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    inspectTypedPath();
                  }
                }}
                placeholder="/Applications/MyApp.app"
                aria-label="Bundle path to inspect"
                mono
                sizeVariant="sm"
                leading={<Plus size={11} />}
              />
            </div>
            <Button size="sm" icon={<ScanLine size={12} />} onClick={inspectTypedPath} disabled={!pathInput.trim()}>
              Inspect path
            </Button>
            <span className="text-[10.5px] text-outline">
              Drop targets anywhere in the window or paste an absolute path.
            </span>
          </div>
        </Card>

        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="flex min-h-[280px] min-w-0 flex-col overflow-hidden">
            <CardHeader
              title="Target queue"
              hint={`${plural(targets.length, "target")} · ${plural(quarantinedCount, "flag")} present`}
              icon={<ScanLine size={13} />}
              actions={
                <>
                  <span aria-live="polite" className="flex items-center gap-1.5">
                    <Badge tone={quarantinedCount > 0 ? "warning" : "neutral"} mono dot>
                      {quarantinedCount} quarantine
                    </Badge>
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<Trash2 size={12} />}
                    onClick={clearQueue}
                    disabled={targets.length === 0}
                  >
                    Clear queue
                  </Button>
                </>
              }
            />
            <div className="min-h-0 flex-1 overflow-auto">
              <DataTable
                ariaLabel="Queued bundles and their quarantine state"
                columns={columns}
                rows={targets}
                rowKey={(t) => t.path}
                activeKey={selected}
                onRowClick={(t) => setSelected(t.path)}
                rowTone={(t) => (t.inspectError ? "error" : null)}
                initialSort={{ key: "path", dir: "asc" }}
                empty={
                  <EmptyState
                    icon={pendingCount > 0 ? <RefreshCw size={16} className="animate-spin" /> : <ShieldOff size={16} />}
                    title={pendingCount > 0 ? "Reading extended attributes…" : "No targets queued"}
                    description="Quarantine is the com.apple.quarantine extended attribute macOS attaches to downloaded files — Gatekeeper uses it to block unsigned apps. Drop a bundle above to inspect it."
                  />
                }
                footer={
                  <tr>
                    <td colSpan={columns.length} className="h-7 px-2">
                      <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                        <span>
                          {plural(targets.length, "row")} · {plural(attributeCount, "xattr key")} ·{" "}
                          {pendingCount > 0 ? `${pendingCount} reading` : errorCount > 0 ? plural(errorCount, "error") : "idle"}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="flex items-center gap-1">
                            <Kbd>⌘O</Kbd> browse
                          </span>
                          <span className="hidden items-center gap-1 lg:flex">
                            <Kbd>↵</Kbd> inspect path
                          </span>
                        </span>
                      </div>
                    </td>
                  </tr>
                }
              />
            </div>
          </Card>

          <Card className="flex min-w-0 flex-col overflow-hidden">
            <CardHeader
              title="Attribute inspector"
              hint={selectedTarget ? baseName(selectedTarget.path) : "Nothing selected"}
              icon={<ShieldAlert size={13} />}
              actions={
                selectedTarget && (
                  <Badge tone={targetState(selectedTarget).tone} dot>
                    {targetState(selectedTarget).label}
                  </Badge>
                )
              }
            />
            {!selectedTarget ? (
              <EmptyState
                compact
                icon={<ShieldAlert size={16} />}
                title="Select a target"
                description="Raw extended attributes and the exact xattr commands appear here."
              />
            ) : (
              <div className="space-y-3 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-on-surface" title={selectedTarget.path}>
                      {baseName(selectedTarget.path)}
                    </div>
                    <div className="break-all font-mono text-[10px] text-outline">{selectedTarget.path}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <CopyButton text={selectedTarget.path} label="Copy path" />
                    <IconButton
                      size="sm"
                      label={`Reveal ${baseName(selectedTarget.path)} in Finder`}
                      icon={<FolderOpen size={12} />}
                      onClick={() => void revealTarget(selectedTarget.path)}
                    />
                    <IconButton
                      size="sm"
                      tone="primary"
                      label={`Re-inspect ${baseName(selectedTarget.path)}`}
                      icon={<RefreshCw size={12} />}
                      onClick={() => void inspectTarget(selectedTarget.path)}
                    />
                  </div>
                </div>

                {selectedTarget.inspectError && (
                  <ErrorNotice
                    title="Inspection failed"
                    message={selectedTarget.inspectError}
                    onRetry={() => void inspectTarget(selectedTarget.path)}
                  />
                )}

                <div className="grid grid-cols-2 gap-1.5">
                  <MiniStat label="Kind" value={selectedTarget.inspection?.kind ?? "—"} />
                  <MiniStat label="Size" value={selectedTarget.inspection ? bytes(selectedTarget.inspection.sizeBytes) : "—"} />
                  <MiniStat
                    label="Attributes"
                    value={selectedTarget.inspection ? String(selectedTarget.inspection.attributes.length) : "—"}
                    tone={selectedTarget.inspection?.hasQuarantine ? "text-warning" : undefined}
                  />
                  <MiniStat
                    label="Quarantine"
                    value={
                      selectedTarget.inspection
                        ? selectedTarget.inspection.hasQuarantine
                          ? "present"
                          : "absent"
                        : "—"
                    }
                    tone={
                      selectedTarget.inspection?.hasQuarantine
                        ? "text-warning"
                        : selectedTarget.inspection
                          ? "text-secondary"
                          : "text-outline"
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <SectionLabel
                    trailing={
                      <span className="font-mono text-[9.5px] text-outline">
                        {selectedTarget.inspecting ? "reading…" : selectedTarget.inspection ? "live" : "unavailable"}
                      </span>
                    }
                  >
                    Raw extended attributes
                  </SectionLabel>
                  <div className="max-h-[132px] min-h-[56px] overflow-auto rounded-lg border border-white/[0.07] bg-black/40 px-2 py-1.5">
                    {selectedTarget.inspection && selectedTarget.inspection.attributes.length > 0 ? (
                      <div className="space-y-0.5">
                        {selectedTarget.inspection.attributes.map((attribute) => (
                          <AttributeRow key={attribute} attribute={attribute} />
                        ))}
                      </div>
                    ) : (
                      <p className="py-2 font-mono text-[10.5px] text-outline">
                        {selectedTarget.inspecting
                          ? "xattr -l …"
                          : selectedTarget.inspection
                            ? "No extended attributes on this target."
                            : "Not inspected yet."}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <SectionLabel trailing={<CopyButton text={plannedText} label="Copy" />}>
                    Planned commands
                  </SectionLabel>
                  <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-black/45">
                    {planned.map((item, index) => (
                      <div
                        key={item.command}
                        className={clsx(
                          "flex items-start gap-2 px-2 py-1.5 font-mono text-[10.5px] leading-[16px]",
                          index > 0 && "border-t border-white/[0.05]",
                          !item.active && "opacity-45",
                        )}
                      >
                        <span className="shrink-0 text-primary-soft">$</span>
                        <div className="min-w-0">
                          <div className="break-all text-on-surface">{item.command}</div>
                          <div className="text-[9.5px] text-outline">{item.note}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <InfoNotice icon={<AlertTriangle size={12} />} tone="warning">
                  {recursive
                    ? "xattr -cr also drops Finder metadata such as kMDItemWhereFroms. Only metadata is removed — the bundle, its signature and its contents stay byte-identical."
                    : "Recursive strip is off: only com.apple.quarantine is removed, nested files keep their own attributes."}
                </InfoNotice>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="destructive"
                    block
                    icon={<ShieldOff size={13} />}
                    onClick={() => setConfirmPath(selectedTarget.path)}
                    disabled={!canClear}
                  >
                    {selectedTarget.inspection
                      ? selectedTarget.inspection.hasQuarantine
                        ? "Clear quarantine"
                        : "No quarantine flag"
                      : selectedTarget.inspecting
                        ? "Inspecting…"
                        : "Inspect first"}
                  </Button>
                  <Button
                    block
                    icon={<FolderOpen size={13} />}
                    onClick={() => void revealTarget(selectedTarget.path)}
                  >
                    Finder
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Card className="flex min-w-0 flex-col overflow-hidden">
            <CardHeader
              title="Before / after xattr diff"
              hint={
                diff && selectedTarget
                  ? `${baseName(diff.result.path)} · ${selectedTarget.clearedAt ? clockTime(selectedTarget.clearedAt) : "just now"}`
                  : "Populated after a confirmed clear"
              }
              icon={<ArrowRightLeft size={13} />}
              actions={
                diff && (
                  <Badge
                    tone={diff.result.status === "cleaned" ? "success" : diff.result.status === "error" ? "error" : "neutral"}
                    dot
                    mono
                  >
                    {diff.result.status.replace("_", " ")}
                  </Badge>
                )
              }
            />
            {!diff ? (
              <EmptyState
                compact
                icon={<ShieldCheck size={16} />}
                title="No clear executed yet"
                description="Select a quarantined target, confirm the strip, and its attribute diff lands here."
              />
            ) : (
              <div className="space-y-2 p-3">
                <p className="text-[11px] leading-relaxed text-on-variant/85">{diff.result.message}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="min-w-0 rounded-lg border border-white/[0.07] bg-black/35">
                    <div className="flex items-center justify-between border-b border-white/[0.055] px-2 py-1">
                      <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">Before</span>
                      <span className="font-mono text-[9.5px] text-outline tnum">
                        {plural(diff.result.attributesBefore.length, "key")}
                      </span>
                    </div>
                    <div className="max-h-[150px] space-y-0.5 overflow-auto px-2 py-1.5">
                      {diff.result.attributesBefore.length === 0 ? (
                        <p className="py-1 font-mono text-[10px] text-outline">No attributes recorded.</p>
                      ) : (
                        diff.result.attributesBefore.map((attribute) => (
                          <AttributeRow
                            key={attribute}
                            attribute={attribute}
                            variant={diff.kept.includes(attribute) ? "plain" : "removed"}
                          />
                        ))
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-lg border border-secondary/20 bg-secondary/[0.04]">
                    <div className="flex items-center justify-between border-b border-white/[0.055] px-2 py-1">
                      <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">After</span>
                      <span className="font-mono text-[9.5px] text-outline tnum">
                        {plural(diff.result.attributesAfter.length, "key")}
                      </span>
                    </div>
                    <div className="max-h-[150px] space-y-0.5 overflow-auto px-2 py-1.5">
                      {diff.result.attributesAfter.length === 0 ? (
                        <p className="flex items-center gap-1.5 py-1 font-mono text-[10px] text-secondary">
                          <Check size={10} /> no extended attributes remain
                        </p>
                      ) : (
                        <>
                          {diff.kept.map((attribute) => (
                            <AttributeRow key={attribute} attribute={attribute} variant="kept" />
                          ))}
                          {diff.added.map((attribute) => (
                            <AttributeRow key={attribute} attribute={attribute} variant="plain" />
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-outline">
                    {plural(diff.removed.length, "attribute")} removed · {plural(diff.kept.length, "attribute")} retained
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Dot tone={diff.result.status === "cleaned" ? "success" : "warning"} />
                    <span className="font-mono text-[10px] text-outline">
                      {plural(diff.result.commands.length, "command")} executed
                    </span>
                    <CopyButton text={diff.result.commands.join("\n")} label="Copy commands" />
                  </span>
                </div>
              </div>
            )}
          </Card>

          <Card className="min-w-0 p-2">
            <LogViewer
              title="Executed commands"
              logs={logs}
              onClear={() => setLogs([])}
              height={196}
              emptyLabel="No commands executed"
            />
          </Card>
        </div>
      </ToolView>

      <ConfirmDialog
        open={confirmPath !== null}
        busy={busy}
        destructive
        title={`Clear quarantine on ${confirmPath ? baseName(confirmPath) : "target"}?`}
        message={
          confirmPath
            ? `${confirmPath} — shift-tools removes extended attributes from this exact path. Files, code signature and bundle contents are not modified.`
            : ""
        }
        confirmLabel="Clear attributes"
        onConfirm={() => void executeClear()}
        onCancel={() => setConfirmPath(null)}
        detail={
          confirmTarget && (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-black/40">
                {planned.map((item, index) => (
                  <div
                    key={item.command}
                    className={clsx(
                      "break-all px-2 py-1.5 font-mono text-[10.5px] leading-[16px]",
                      index > 0 && "border-t border-white/[0.05]",
                      item.active ? "text-on-surface" : "text-outline line-through",
                    )}
                  >
                    <span className="mr-1.5 text-primary-soft">$</span>
                    {item.command}
                  </div>
                ))}
              </div>
              {confirmTarget.inspection && confirmTarget.inspection.attributes.length > 0 && (
                <div className="max-h-28 overflow-auto rounded-lg border border-white/[0.07] bg-black/30 px-2 py-1.5">
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
                    {plural(confirmTarget.inspection.attributes.length, "attribute")} on target
                  </div>
                  <div className="space-y-0.5">
                    {confirmTarget.inspection.attributes.map((attribute) => (
                      <AttributeRow key={attribute} attribute={attribute} />
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10.5px] text-outline">
                {recursive
                  ? "Recursive strip is enabled for this run."
                  : "Recursive strip is disabled — only the top-level quarantine flag is removed."}
              </p>
            </div>
          )
        }
      />
    </>
  );
}
