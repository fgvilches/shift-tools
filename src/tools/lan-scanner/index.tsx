import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  Building2,
  Copy,
  Download,
  FileJson,
  Filter,
  Network,
  Plug,
  Radar,
  RefreshCw,
  ScanLine,
  Search,
  Server,
  ShieldAlert,
  Timer,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input, SegmentedControl, Switch } from "@/components/ui/Form";
import { EmptyState, ErrorNotice, InfoNotice, Progress } from "@/components/ui/Feedback";
import { LogViewer, type LogEntry } from "@/components/ui/LogViewer";
import { toast } from "@/components/ui/Toast";
import { network } from "@/lib/api";
import { errorMessage } from "@/lib/ipc";
import { ms, plural } from "@/lib/format";
import type { LanHost } from "@/lib/types";
import { HostInspector } from "./components/HostInspector";
import { downloadFile, fileStamp, hostsToCsv, hostsToJson } from "./lib/export";
import {
  DEFAULT_PORTS,
  PORT_PRESETS,
  insecureLabel,
  ipValue,
  parseCustomPorts,
  portTone,
  presetPorts,
  type PortSet,
} from "./lib/ports";

const CHIP_TONE: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/[0.05] text-on-variant",
  primary: "border-primary/25 bg-primary/10 text-primary-soft",
  success: "border-secondary/25 bg-secondary/10 text-[#8ff0a4]",
  warning: "border-warning/25 bg-warning/10 text-[#ffe066]",
  error: "border-error/30 bg-error/12 text-[#ff8b81]",
  tertiary: "border-tertiary/25 bg-tertiary/10 text-[#dda6ff]",
};

function latencyTone(value: number | null): string {
  if (value === null) return "text-outline";
  if (value < 5) return "text-secondary";
  if (value < 40) return "text-on-variant";
  if (value < 150) return "text-warning";
  return "text-error";
}

function PortChip({ port, service }: { port: number; service: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 h-[17px] px-1 rounded border font-mono text-[9.5px] tnum whitespace-nowrap",
        CHIP_TONE[portTone(port)],
      )}
      title={`${service} on TCP ${port}`}
    >
      {port}
      <span className="opacity-65">/{service}</span>
    </span>
  );
}

export default function LanScannerView() {
  const [cidr, setCidr] = useState("");
  const [portSet, setPortSet] = useState<PortSet>("common");
  const [customRaw, setCustomRaw] = useState("");
  const [hosts, setHosts] = useState<LanHost[]>([]);
  const [scanned, setScanned] = useState(0);
  const [total, setTotal] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [query, setQuery] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const activeRef = useRef(0);
  const startedRef = useRef<number | null>(null);
  const logSeq = useRef(0);
  const lastEventRef = useRef("");

  const pushLog = useCallback((level: LogEntry["level"], message: string, detail?: string) => {
    logSeq.current += 1;
    setLogs((prev) => [
      ...prev.slice(-240),
      {
        id: `${Date.now().toString(36)}-${logSeq.current}`,
        level,
        message,
        detail,
        timestamp: new Date().toLocaleTimeString("en-GB", { hour12: false }),
      },
    ]);
  }, []);

  const customParse = useMemo(() => parseCustomPorts(customRaw), [customRaw]);
  const resolvedPorts = useMemo(() => {
    if (portSet !== "custom") return presetPorts(portSet);
    return customParse.ports.length > 0 ? customParse.ports : DEFAULT_PORTS;
  }, [portSet, customParse]);

  /* Live progress stream. The backend emits globally, so events are gated by activeRef
     and only a dispatched sweep is allowed to mutate state. */
  useEffect(() => {
    const unsubscribe = network.onLanProgress((payload) => {
      if (activeRef.current === 0) return;
      // The backend repeats the accumulated list on every event; a replayed or
      // duplicated delivery must not double-log or double-toast.
      const signature = `${payload.scanned}/${payload.total}/${payload.hosts.length}/${payload.done}/${payload.error ?? ""}`;
      if (signature === lastEventRef.current) return;
      lastEventRef.current = signature;
      setScanned(payload.scanned);
      setTotal(payload.total);
      setHosts(payload.hosts);

      if (payload.error) {
        activeRef.current = 0;
        setScanning(false);
        setError(payload.error);
        pushLog("error", "Sweep aborted by backend", payload.error);
        toast.error("Sweep failed", payload.error);
        return;
      }

      if (payload.done) {
        activeRef.current = 0;
        const finish = startedRef.current ? Date.now() - startedRef.current : 0;
        setElapsedMs(finish);
        setScanning(false);
        setDone(true);
        pushLog(
          "success",
          `Sweep complete — ${plural(payload.hosts.length, "responder")}`,
          `${payload.scanned}/${payload.total} addresses probed in ${(finish / 1000).toFixed(1)}s`,
        );
        toast.success(
          `${plural(payload.hosts.length, "host")} responding`,
          `${payload.scanned} addresses probed in ${(finish / 1000).toFixed(1)}s`,
        );
        return;
      }

      pushLog("debug", `Probed ${payload.scanned}/${payload.total}`, `${plural(payload.hosts.length, "responder")} so far`);
    });
    return unsubscribe;
  }, [pushLog]);

  /* Elapsed clock only ticks while a sweep is live. */
  useEffect(() => {
    if (!scanning) return;
    const timer = window.setInterval(() => {
      if (startedRef.current) setElapsedMs(Date.now() - startedRef.current);
    }, 200);
    return () => window.clearInterval(timer);
  }, [scanning]);

  const runScan = useCallback(async () => {
    if (scanning) return;
    const target = cidr.trim();
    activeRef.current += 1;
    startedRef.current = Date.now();
    lastEventRef.current = "";
    setScanning(true);
    setDone(false);
    setError(null);
    setHosts([]);
    setScanned(0);
    setTotal(0);
    setElapsedMs(0);
    setSelectedIp(null);
    pushLog("info", `Sweep dispatched — ${target || "auto-detected subnet"}`, `ports ${resolvedPorts.join(",")}`);

    try {
      await network.lanScan(target, resolvedPorts);
    } catch (err) {
      activeRef.current = 0;
      const message = errorMessage(err);
      setScanning(false);
      setError(message);
      pushLog("error", "Sweep rejected", message);
      toast.error("Scan could not start", message);
    }
  }, [cidr, resolvedPorts, scanning, pushLog]);

  const clearResults = useCallback(() => {
    if (scanning) return;
    activeRef.current = 0;
    startedRef.current = null;
    setHosts([]);
    setScanned(0);
    setTotal(0);
    setDone(false);
    setError(null);
    setSelectedIp(null);
    setElapsedMs(0);
    pushLog("info", "Results cleared");
  }, [scanning, pushLog]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void runScan();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runScan]);

  const alive = useMemo(() => hosts.filter((host) => host.alive), [hosts]);
  const orderedAlive = useMemo(() => [...alive].sort((a, b) => ipValue(a.ip) - ipValue(b.ip)), [alive]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orderedAlive.filter((host) => {
      if (onlyOpen && host.openPorts.length === 0) return false;
      if (!needle) return true;
      const haystack = [
        host.ip,
        host.hostname ?? "",
        host.mac ?? "",
        host.vendor ?? "",
        ...host.openPorts.flatMap((entry) => [String(entry.port), entry.service]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [orderedAlive, onlyOpen, query]);

  const openPortCount = useMemo(() => alive.reduce((sum, host) => sum + host.openPorts.length, 0), [alive]);
  const filteredPortCount = useMemo(() => filtered.reduce((sum, host) => sum + host.openPorts.length, 0), [filtered]);
  const vendorCount = useMemo(() => new Set(alive.map((host) => host.vendor).filter(Boolean)).size, [alive]);
  const avgLatency = useMemo(() => {
    const samples = alive.map((host) => host.latencyMs).filter((value): value is number => value !== null);
    if (samples.length === 0) return null;
    return samples.reduce((sum, value) => sum + value, 0) / samples.length;
  }, [alive]);
  const flaggedCount = useMemo(() => alive.filter((host) => insecureLabel(host) !== null).length, [alive]);
  const selectedHost = useMemo(() => alive.find((host) => host.ip === selectedIp) ?? null, [alive, selectedIp]);

  useEffect(() => {
    if (alive.length === 0) {
      if (selectedIp !== null) setSelectedIp(null);
      return;
    }
    if (selectedIp && alive.some((host) => host.ip === selectedIp)) return;
    if (done && orderedAlive.length > 0) setSelectedIp(orderedAlive[0].ip);
  }, [alive, selectedIp, done, orderedAlive]);

  const copyValue = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`, value);
    } catch {
      toast.error("Clipboard unavailable", "The WebView refused clipboard access.");
    }
  }, []);

  const exportHosts = useCallback(
    (format: "csv" | "json") => {
      if (filtered.length === 0) {
        toast.warning("Nothing to export", "Run a sweep that returns at least one host.");
        return;
      }
      const stamp = fileStamp();
      const filename = `lan-scan-${stamp}.${format}`;
      const meta = {
        cidr: cidr.trim() || "auto-detected",
        ports: resolvedPorts,
        exportedAt: new Date().toISOString(),
      };
      if (format === "csv") {
        downloadFile(filename, "text/csv;charset=utf-8", `${hostsToCsv(filtered)}\n`);
      } else {
        downloadFile(filename, "application/json;charset=utf-8", `${hostsToJson(filtered, meta)}\n`);
      }
      toast.success(`Exported ${plural(filtered.length, "host")}`, `${format.toUpperCase()} · ${filename}`);
    },
    [filtered, cidr, resolvedPorts],
  );

  const phase: "idle" | "scanning" | "done" | "error" = scanning ? "scanning" : error ? "error" : done ? "done" : "idle";
  const progressPct = total > 0 ? (scanned / total) * 100 : 0;
  const elapsedLabel = `${(elapsedMs / 1000).toFixed(1)}s`;
  const targetLabel = cidr.trim() || "auto-detected";
  const portSummary = resolvedPorts.length > 4 ? `${resolvedPorts.slice(0, 4).join(",")} +${resolvedPorts.length - 4}` : resolvedPorts.join(",");

  const columns: Column<LanHost>[] = [
    {
      key: "ip",
      header: "Status · host / IP",
      sortable: true,
      sortValue: (host) => ipValue(host.ip),
      render: (host) => {
        const flagged = insecureLabel(host) !== null;
        return (
          <div className="flex items-center gap-2 min-w-0 py-0.5">
            <span title={flagged ? "Cleartext service exposed" : host.alive ? "Responding" : "Silent"}>
              <Dot tone={flagged ? "error" : host.alive ? "success" : "neutral"} />
              <span className="sr-only">{flagged ? "Flagged host" : host.alive ? "Responding host" : "Silent host"}</span>
            </span>
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={clsx("font-mono text-[12px] font-medium tnum", flagged ? "text-error" : "text-on-surface")}>
                  {host.ip}
                </span>
                {flagged && <ShieldAlert size={11} className="text-error shrink-0" aria-hidden />}
              </div>
              <div className="font-mono text-[9.5px] text-outline/85 truncate max-w-[190px]" title={host.hostname ?? "No reverse DNS"}>
                {host.hostname ?? "no reverse DNS"}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: "mac",
      header: "MAC",
      mono: true,
      hideBelow: "md",
      width: 128,
      render: (host) => (
        <span className="text-[10.5px] text-on-variant" title={host.mac ? "Resolved from the ARP table" : "Not present in the ARP table"}>
          {host.mac ?? "—"}
        </span>
      ),
    },
    {
      key: "vendor",
      header: "Vendor",
      hideBelow: "lg",
      sortable: true,
      sortValue: (host) => host.vendor ?? "",
      width: 128,
      render: (host) =>
        host.vendor ? (
          <span className="inline-flex items-center h-[17px] px-1.5 rounded bg-white/[0.05] border border-white/[0.06] text-[10px] text-on-variant truncate max-w-[118px]" title={host.vendor}>
            {host.vendor}
          </span>
        ) : (
          <span className="font-mono text-[10.5px] text-outline">—</span>
        ),
    },
    {
      key: "openPorts",
      header: "Open ports",
      sortable: true,
      sortValue: (host) => host.openPorts.length,
      render: (host) =>
        host.openPorts.length === 0 ? (
          <span className="font-mono text-[10px] text-outline">no probe answered</span>
        ) : (
          <div className="flex items-center gap-1 flex-wrap max-w-[300px]">
            {host.openPorts.slice(0, 5).map((entry) => (
              <PortChip key={entry.port} port={entry.port} service={entry.service} />
            ))}
            {host.openPorts.length > 5 && (
              <span className="font-mono text-[9.5px] text-outline tnum" title={host.openPorts.slice(5).map((entry) => `${entry.port}/${entry.service}`).join(", ")}>
                +{host.openPorts.length - 5}
              </span>
            )}
          </div>
        ),
    },
    {
      key: "latencyMs",
      header: "RTT",
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (host) => host.latencyMs,
      width: 74,
      render: (host) => <span className={latencyTone(host.latencyMs)}>{ms(host.latencyMs, 2)}</span>,
    },
    {
      key: "copy",
      header: "",
      align: "right",
      width: 36,
      render: (host) => (
        <IconButton
          size="sm"
          label={`Copy IP address ${host.ip}`}
          icon={<Copy size={11} />}
          onClick={(event) => {
            event.stopPropagation();
            void copyValue(host.ip, "IP address");
          }}
        />
      ),
    },
  ];

  const tableEmpty =
    alive.length === 0 && scanning ? (
      <EmptyState
        compact
        icon={<Radar size={16} className="animate-pulse text-primary" />}
        title={`Probing ${total > 0 ? total : "…"} addresses`}
        description="Responders appear here as ARP and TCP probes return."
      />
    ) : alive.length === 0 && error ? (
      <EmptyState
        compact
        icon={<ShieldAlert size={16} className="text-error" />}
        title="Sweep failed"
        description={error}
      />
    ) : alive.length === 0 && done ? (
      <EmptyState
        compact
        icon={<Network size={16} />}
        title="No responding hosts"
        description={`All ${scanned} addresses in ${targetLabel} stayed silent on the selected ports.`}
      />
    ) : alive.length === 0 ? (
      <EmptyState
        icon={<ScanLine size={18} />}
        title="No sweep yet"
        description="Leave the CIDR empty to auto-detect this machine's subnet, or type a range such as 192.168.1.0/24, then start a scan."
        action={
          <Button variant="primary" size="sm" icon={<Radar size={13} />} onClick={() => void runScan()}>
            Start scan
          </Button>
        }
      />
    ) : (
      <EmptyState
        compact
        icon={<Filter size={16} />}
        title="No hosts match the filter"
        description="Clear the text filter or turn off the open-ports requirement."
      />
    );

  return (
    <ToolView
      eyebrow={phase === "scanning" ? "SWEEPING SUBNET" : phase === "done" ? "SWEEP COMPLETE" : "SUBNET DISCOVERY"}
      eyebrowTone={phase === "error" ? "error" : phase === "done" ? "success" : "primary"}
      eyebrowHint="ARP + TCP PROBE"
      eyebrowPulse={phase !== "idle"}
      title="LAN Scanner"
      description="Discover hosts on the local subnet with ARP, reverse DNS, vendor lookup, and TCP port probing."
      telemetry={[
        {
          label: "Hosts found",
          value: total > 0 ? `${alive.length}` : "—",
          tone: alive.length > 0 ? "primary" : "neutral",
          icon: <Network size={14} />,
        },
        { label: "Open ports", value: String(openPortCount), tone: openPortCount > 0 ? "tertiary" : "neutral", icon: <Plug size={14} /> },
        { label: "Vendors", value: vendorCount > 0 ? String(vendorCount) : "—", tone: "success", icon: <Building2 size={14} /> },
        { label: "Avg RTT", value: avgLatency === null ? "—" : ms(avgLatency, 2), tone: "neutral", icon: <Timer size={14} /> },
      ]}
      headerExtra={
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
            <span className="flex items-center gap-1.5 min-w-0 truncate" aria-live="polite">
              <span className="text-outline uppercase tracking-[0.08em]">Sweep</span>
              <span className="text-on-surface tnum">{scanned}</span>
              <span className="text-outline">/</span>
              <span className="text-on-surface tnum">{total > 0 ? total : "—"}</span>
              <span className="text-outline">addresses probed</span>
              <span className="text-primary-soft tnum">{total > 0 ? `${progressPct.toFixed(0)}%` : ""}</span>
            </span>
            <span className="text-outline shrink-0">
              {scanning ? `running · ${elapsedLabel}` : done ? `completed in ${elapsedLabel}` : phase === "error" ? "failed" : "idle"}
            </span>
          </div>
          <Progress
            value={progressPct}
            tone={phase === "error" ? "error" : done ? "success" : "primary"}
            label="Subnet sweep progress"
            height={5}
          />
          <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-outline">
            <span className="truncate">
              {alive.length} responders · {openPortCount} open ports
              {flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ""}
            </span>
            <span className="shrink-0">elapsed {elapsedLabel}</span>
          </div>
        </div>
      }
      toolbar={
        <>
          <div className="w-[176px]">
            <Input
              mono
              sizeVariant="sm"
              value={cidr}
              onChange={(event) => setCidr(event.target.value)}
              placeholder="192.168.1.0/24"
              aria-label="Target CIDR range, empty to auto-detect"
              leading={<Network size={11} />}
              invalid={Boolean(error) && cidr.trim().length > 0}
            />
          </div>
          <SegmentedControl
            value={portSet}
            onChange={setPortSet}
            ariaLabel="Port set to probe"
            options={[...PORT_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })), { value: "custom" as PortSet, label: "Custom" }]}
          />
          {portSet === "custom" && (
            <div className="flex items-center gap-1.5">
              <div className="w-[152px]">
                <Input
                  mono
                  sizeVariant="sm"
                  value={customRaw}
                  onChange={(event) => setCustomRaw(event.target.value)}
                  placeholder="22,80,443,8000"
                  aria-label="Custom port list, comma separated"
                  invalid={customParse.rejected.length > 0}
                />
              </div>
              <span className={clsx("font-mono text-[9.5px]", customParse.rejected.length > 0 ? "text-error" : "text-outline")}>
                {customParse.rejected.length > 0
                  ? `ignored ${customParse.rejected.slice(0, 3).join(",")}`
                  : customParse.ports.length === 0
                    ? "empty → Common 8"
                    : `${customParse.ports.length} ports`}
              </span>
            </div>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={<Radar size={13} />}
            loading={scanning}
            onClick={() => void runScan()}
            trailing={<Kbd>⌘↵</Kbd>}
          >
            {scanning ? "Sweeping…" : "Start scan"}
          </Button>
          {cidr.trim().length === 0 && <span className="font-mono text-[9.5px] text-outline">empty CIDR → auto-detect</span>}
        </>
      }
      status={
        <>
          <Badge tone={phase === "error" ? "error" : phase === "done" ? "success" : phase === "scanning" ? "primary" : "neutral"} dot pulse={scanning} mono>
            {phase === "scanning" ? "Live" : phase === "done" ? "Complete" : phase === "error" ? "Failed" : "Idle"}
          </Badge>
          <Button
            size="xs"
            icon={<Download size={11} />}
            onClick={() => exportHosts("csv")}
            disabled={filtered.length === 0}
            aria-label="Export filtered hosts as CSV"
          >
            CSV
          </Button>
          <Button
            size="xs"
            icon={<FileJson size={11} />}
            onClick={() => exportHosts("json")}
            disabled={filtered.length === 0}
            aria-label="Export filtered hosts as JSON"
          >
            JSON
          </Button>
          <IconButton
            label="Clear scan results"
            icon={<RefreshCw size={13} />}
            onClick={clearResults}
            disabled={scanning || (alive.length === 0 && !done && !error)}
          />
        </>
      }
    >
      {error && (
        <ErrorNotice
          title="Sweep failed"
          message={error}
          retryLabel="Run again"
          onRetry={() => void runScan()}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_312px] gap-3 items-start min-w-0">
        <div className="flex flex-col gap-3 min-w-0">
          <Card className="overflow-hidden">
            <CardHeader
              title="Discovered hosts"
              hint={`${filtered.length} of ${alive.length} · ${targetLabel} · MAC and vendor enrich on the final event`}
              icon={<Server size={13} />}
              actions={
                <>
                  <div className="w-[188px]">
                    <Input
                      sizeVariant="sm"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filter IP, host, vendor, port…"
                      aria-label="Filter discovered hosts"
                      leading={<Search size={11} />}
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-[10.5px] text-outline whitespace-nowrap">
                    Open ports only
                    <Switch checked={onlyOpen} onChange={setOnlyOpen} label="Show only hosts with open ports" size="sm" />
                  </label>
                </>
              }
            />
            <DataTable
              ariaLabel="Discovered LAN hosts"
              columns={columns}
              rows={filtered}
              rowKey={(host) => host.ip}
              activeKey={selectedIp}
              onRowClick={(host) => setSelectedIp(host.ip)}
              rowTone={(host) => (insecureLabel(host) ? "error" : null)}
              initialSort={{ key: "ip", dir: "asc" }}
              maxHeight="min(52vh, 440px)"
              empty={tableEmpty}
              footer={
                <tr>
                  <td colSpan={columns.length} className="px-2 h-7">
                    <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-outline">
                      <span className="truncate">
                        {plural(filtered.length, "row")} · {filteredPortCount} ports · {flaggedCount} flagged
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1">
                          <Kbd>⌘↵</Kbd> rescan
                        </span>
                        <span className="hidden md:inline">click a row to inspect</span>
                      </span>
                    </div>
                  </td>
                </tr>
              }
            />
            {alive.length > 0 && (
              <div className="px-3 py-2 border-t border-white/[0.055] space-y-1.5">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-outline">
                  <span className="truncate">Responder map · {targetLabel} · address order</span>
                  <span className="text-primary-soft shrink-0">
                    {alive.length} alive{flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ""}
                  </span>
                </div>
                <div
                  className="flex flex-wrap gap-1"
                  role="img"
                  aria-label={`${alive.length} responding hosts shown in address order`}
                >
                  {orderedAlive.slice(0, 96).map((host) => (
                    <span
                      key={host.ip}
                      title={`${host.ip}${host.hostname ? ` · ${host.hostname}` : ""} · ${host.openPorts.length} open`}
                      className={clsx(
                        "h-3 w-1.5 rounded-[2px]",
                        insecureLabel(host)
                          ? "bg-error"
                          : host.openPorts.length > 0
                            ? "bg-primary"
                            : "bg-white/20",
                      )}
                    />
                  ))}
                  {orderedAlive.length > 96 && (
                    <span className="font-mono text-[9.5px] text-outline tnum self-center">+{orderedAlive.length - 96}</span>
                  )}
                </div>
              </div>
            )}
          </Card>

          <LogViewer
            title="Sweep event log"
            logs={logs}
            height={116}
            emptyLabel="No sweep dispatched yet"
            onClear={() => setLogs([])}
          />
        </div>

        <aside className="flex flex-col gap-3 min-w-0">
          <HostInspector host={selectedHost} scanning={scanning} />

          <Card className="p-3 space-y-2">
            <SectionLabel
              trailing={
                <span className="font-mono text-[9.5px] text-outline uppercase tracking-[0.06em]">
                  {phase === "scanning" ? "in flight" : phase}
                </span>
              }
            >
              Sweep configuration
            </SectionLabel>
            <dl className="rounded-lg border border-white/[0.055] bg-black/30 px-2 py-1.5 space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[10px] uppercase tracking-[0.07em] text-outline">Target</dt>
                <dd className="font-mono text-[11px] text-on-surface tnum truncate">{targetLabel}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[10px] uppercase tracking-[0.07em] text-outline">Ports</dt>
                <dd className="font-mono text-[11px] text-on-surface tnum truncate" title={resolvedPorts.join(", ")}>
                  {portSummary}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[10px] uppercase tracking-[0.07em] text-outline">Probed</dt>
                <dd className="font-mono text-[11px] text-on-surface tnum">
                  {scanned}
                  {total > 0 ? ` / ${total}` : ""}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[10px] uppercase tracking-[0.07em] text-outline">Elapsed</dt>
                <dd className="font-mono text-[11px] text-on-surface tnum">{elapsedLabel}</dd>
              </div>
            </dl>
            <InfoNotice tone="warning" icon={<AlertTriangle size={12} />}>
              A sweep cannot be aborted once dispatched — every address runs to completion. A /24 with 8 ports takes
              roughly 10–20 s.
            </InfoNotice>
          </Card>
        </aside>
      </div>
    </ToolView>
  );
}
