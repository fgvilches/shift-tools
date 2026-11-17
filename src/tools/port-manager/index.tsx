import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Crosshair,
  Globe,
  Network,
  Plug,
  Radio,
  RefreshCw,
  Search,
  Skull,
  User,
  X,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input, SegmentedControl, Switch } from "@/components/ui/Form";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorNotice, InfoNotice, Meter } from "@/components/ui/Feedback";
import { toast } from "@/components/ui/Toast";
import { system } from "@/lib/api";
import { errorMessage, isTauri } from "@/lib/ipc";
import { plural, truncateMiddle } from "@/lib/format";
import type { PortInfo } from "@/lib/types";

type ProtocolFilter = "all" | "tcp" | "udp";

const PROTOCOLS: { value: ProtocolFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

const POLL_MS = 5000;

function isListening(socket: PortInfo): boolean {
  return socket.state.toUpperCase().startsWith("LISTEN");
}

function stateTone(state: string): Tone {
  const normalized = state.toUpperCase();
  if (normalized.startsWith("LISTEN")) return "success";
  if (normalized.startsWith("ESTAB")) return "primary";
  return "neutral";
}

function socketKey(socket: PortInfo): string {
  return `${socket.protocol}:${socket.port}:${socket.pid ?? "na"}:${socket.localAddr}:${socket.remoteAddr}`;
}

function ownerLabel(socket: PortInfo): string {
  return socket.pid === null ? socket.process : `${socket.process} · ${socket.pid}`;
}

export default function PortManagerView() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [portQuery, setPortQuery] = useState("");
  const [protocol, setProtocol] = useState<ProtocolFilter>("all");
  const [listenOnly, setListenOnly] = useState(true);
  const [auto, setAuto] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sweptAt, setSweptAt] = useState<string | null>(null);
  const [pendingKill, setPendingKill] = useState<PortInfo | null>(null);
  const [forceTarget, setForceTarget] = useState<{ socket: PortInfo; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (!isTauri) {
      setLoading(false);
      setError("This tool needs the native app. Launch it with `npm run app`.");
      return;
    }
    if (inFlight.current && !force) return;
    inFlight.current = true;
    try {
      const list = await system.ports();
      setPorts(list);
      setError(null);
      setSweptAt(new Date().toLocaleTimeString("en-GB", { hour12: false }));
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
    if (!auto) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [auto, refresh]);

  useEffect(() => {
    setSelectedKey((prev) => (prev && ports.some((p) => socketKey(p) === prev) ? prev : null));
  }, [ports]);

  const listeningCount = useMemo(() => ports.filter(isListening).length, [ports]);
  const tcpCount = useMemo(() => ports.filter((p) => p.protocol === "tcp").length, [ports]);
  const udpCount = useMemo(() => ports.filter((p) => p.protocol === "udp").length, [ports]);
  const establishedCount = useMemo(
    () => ports.filter((p) => p.state.toUpperCase().startsWith("ESTAB")).length,
    [ports],
  );
  const processCount = useMemo(() => {
    const owners = new Set<string>();
    for (const socket of ports) owners.add(socket.pid === null ? `name:${socket.process}` : `pid:${socket.pid}`);
    return owners.size;
  }, [ports]);

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    const port = portQuery;
    return ports.filter((socket) => {
      if (protocol !== "all" && socket.protocol !== protocol) return false;
      if (listenOnly && !isListening(socket)) return false;
      if (port && !String(socket.port).startsWith(port)) return false;
      if (!text) return true;
      return socket.process.toLowerCase().includes(text) || socket.user.toLowerCase().includes(text);
    });
  }, [ports, protocol, listenOnly, portQuery, query]);

  const lookupRows = useMemo(
    () => (portQuery ? ports.filter((socket) => String(socket.port) === portQuery) : []),
    [ports, portQuery],
  );

  const selected = useMemo(
    () => (selectedKey ? ports.find((socket) => socketKey(socket) === selectedKey) ?? null : null),
    [ports, selectedKey],
  );

  const owners = useMemo(() => {
    const map = new Map<string, { name: string; pid: number | null; total: number; listening: number }>();
    for (const socket of ports) {
      const key = socket.pid === null ? `name:${socket.process}` : `pid:${socket.pid}`;
      const entry = map.get(key) ?? { name: socket.process, pid: socket.pid, total: 0, listening: 0 };
      entry.total += 1;
      if (isListening(socket)) entry.listening += 1;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 7);
  }, [ports]);

  const shownListening = rows.filter(isListening).length;
  const shownEstablished = rows.filter((p) => p.state.toUpperCase().startsWith("ESTAB")).length;
  const shownProcesses = new Set(rows.map((p) => (p.pid === null ? `name:${p.process}` : `pid:${p.pid}`))).size;

  const clearLookup = useCallback(() => setPortQuery(""), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (portQuery) clearLookup();
      else if (query) setQuery("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearLookup, portQuery, query]);

  const runKill = async (socket: PortInfo, force: boolean) => {
    setBusy(true);
    try {
      const results = await system.killPort(socket.port, socket.protocol, force);
      const succeeded = results.filter((result) => result.ok);
      if (succeeded.length > 0) {
        const signals = [...new Set(succeeded.map((result) => result.signal))].join(" → ");
        toast.success(
          `Port ${socket.port} released`,
          `${plural(succeeded.length, "process", "processes")} terminated via ${signals} · ${socket.protocol.toUpperCase()} ${socket.localAddr}`,
        );
        setPendingKill(null);
        setForceTarget(null);
        await refresh(true);
        return;
      }
      const reason =
        results.find((result) => result.error !== null)?.error ?? "The owning process refused the signal.";
      if (force) {
        setForceTarget(null);
        toast.error(`Port ${socket.port} is still bound`, reason);
      } else {
        setPendingKill(null);
        setForceTarget({ socket, reason });
      }
    } catch (err) {
      const message = errorMessage(err);
      setPendingKill(null);
      setForceTarget(null);
      toast.error(`Could not release port ${socket.port}`, message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<PortInfo>[] = [
    {
      key: "port",
      header: "Port",
      width: 68,
      sortable: true,
      sortValue: (socket) => socket.port,
      render: (socket) => {
        const hit = portQuery !== "" && String(socket.port) === portQuery;
        return (
          <span
            className={clsx(
              "inline-flex items-center rounded px-1.5 h-5 font-mono text-[12px] font-semibold tnum",
              hit ? "bg-primary/25 text-primary-soft ring-1 ring-primary/50" : "text-primary-soft",
            )}
          >
            {socket.port}
          </span>
        );
      },
    },
    {
      key: "protocol",
      header: "Proto",
      width: 72,
      sortable: true,
      sortValue: (socket) => socket.protocol,
      render: (socket) => (
        <Badge tone={socket.protocol === "tcp" ? "primary" : "tertiary"} mono>
          {socket.protocol.toUpperCase()}
        </Badge>
      ),
    },
    {
      key: "state",
      header: "State",
      width: 110,
      sortable: true,
      sortValue: (socket) => socket.state,
      render: (socket) => (
        <Badge tone={stateTone(socket.state)} mono dot>
          {socket.state.toUpperCase() || "UNKNOWN"}
        </Badge>
      ),
    },
    {
      key: "process",
      header: "Process · PID",
      sortable: true,
      sortValue: (socket) => socket.process.toLowerCase(),
      render: (socket) => (
        <div className="flex items-baseline gap-1.5 min-w-0 py-0.5">
          <Plug size={11} className="text-outline shrink-0 self-center" aria-hidden />
          <span className="text-[12px] text-on-surface truncate max-w-[190px]" title={socket.process}>
            {socket.process}
          </span>
          <span className="font-mono text-[10px] text-outline tnum shrink-0">
            {socket.pid === null ? "—" : `#${socket.pid}`}
          </span>
        </div>
      ),
    },
    {
      key: "user",
      header: "User",
      width: 96,
      hideBelow: "md",
      sortable: true,
      sortValue: (socket) => socket.user.toLowerCase(),
      render: (socket) => (
        <span className="text-[11.5px] text-on-variant truncate block max-w-[92px]" title={socket.user}>
          {socket.user || "—"}
        </span>
      ),
    },
    {
      key: "localAddr",
      header: "Local address",
      width: 158,
      mono: true,
      sortable: true,
      sortValue: (socket) => socket.localAddr,
      render: (socket) => (
        <span className="text-[11px] text-on-variant block truncate max-w-[150px]" title={socket.localAddr}>
          {socket.localAddr}
        </span>
      ),
    },
    {
      key: "remoteAddr",
      header: "Remote address",
      width: 158,
      mono: true,
      hideBelow: "xl",
      sortable: true,
      sortValue: (socket) => socket.remoteAddr,
      render: (socket) => (
        <span
          className={clsx(
            "text-[11px] block truncate max-w-[150px]",
            socket.remoteAddr && socket.remoteAddr !== "*" ? "text-outline" : "text-outline/50",
          )}
          title={socket.remoteAddr || "no peer"}
        >
          {socket.remoteAddr || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      width: 46,
      align: "right",
      render: (socket) => (
        <span className="inline-flex justify-end" onClick={(event) => event.stopPropagation()}>
          <IconButton
            size="sm"
            tone="danger"
            label={`Kill process on port ${socket.port} (${socket.protocol.toUpperCase()})`}
            icon={<Skull size={12} />}
            onClick={() => setPendingKill(socket)}
            disabled={busy}
          />
        </span>
      ),
    },
  ];

  const lookupSummary = useMemo(() => {
    if (lookupRows.length === 0) return null;
    const unique = new Map<string, PortInfo>();
    for (const socket of lookupRows) unique.set(ownerLabel(socket), socket);
    return [...unique.values()];
  }, [lookupRows]);

  return (
    <>
      <ToolView
        eyebrow="SOCKET INSPECTOR"
        eyebrowTone="primary"
        eyebrowHint="lsof · netstat"
        title="Port Manager"
        description="See every listening and established socket, who owns it, and reclaim a port in one click."
        telemetry={[
          {
            label: "Open sockets",
            value: loading && ports.length === 0 ? "—" : String(ports.length),
            tone: "primary",
            icon: <Network size={14} />,
          },
          {
            label: "Listening",
            value: loading && ports.length === 0 ? "—" : String(listeningCount),
            tone: "success",
            icon: <Radio size={14} />,
          },
          {
            label: "Processes",
            value: loading && ports.length === 0 ? "—" : String(processCount),
            tone: "tertiary",
            icon: <Boxes size={14} />,
          },
          {
            label: "Poll",
            value: auto ? "5s" : "paused",
            tone: auto ? "success" : "warning",
            icon: <Dot tone={auto ? "success" : "warning"} pulse={auto} />,
          },
        ]}
        headerExtra={
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] gap-2 items-center">
            <div className="space-y-1">
              <div className="flex items-center justify-between font-mono text-[10px] gap-3">
                <span className="text-outline truncate">
                  <span className="text-primary-soft font-semibold">{tcpCount}</span> TCP
                  <span className="px-1 text-outline/60">·</span>
                  <span className="text-tertiary font-semibold">{udpCount}</span> UDP
                  <span className="px-1 text-outline/60">·</span>
                  {listeningCount} listening
                </span>
                <span className="text-outline shrink-0">
                  {establishedCount} established · {processCount} owners
                </span>
              </div>
              <Meter
                ariaLabel="Share of TCP and UDP sockets in the current snapshot"
                height={6}
                segments={[
                  { label: "TCP", value: tcpCount, tone: "primary" },
                  { label: "UDP", value: udpCount, tone: "tertiary" },
                ]}
              />
            </div>
            <div
              aria-live="polite"
              className={clsx(
                "flex items-center gap-2 h-8 px-2.5 rounded-lg border min-w-0",
                portQuery
                  ? lookupRows.length > 0
                    ? "border-secondary/30 bg-secondary/[0.06]"
                    : "border-error/30 bg-error/[0.06]"
                  : "border-white/[0.06] bg-black/20",
              )}
            >
              {portQuery ? (
                <>
                  <Dot tone={lookupRows.length > 0 ? "success" : "error"} pulse={lookupRows.length > 0} />
                  <span className="font-mono text-[11px] text-on-surface shrink-0">Port {portQuery}</span>
                  {lookupSummary ? (
                    <span className="font-mono text-[10.5px] text-on-variant truncate">
                      {lookupSummary
                        .slice(0, 2)
                        .map((socket) => ownerLabel(socket))
                        .join(" + ")}
                      {lookupSummary.length > 2 ? ` +${lookupSummary.length - 2}` : ""}
                    </span>
                  ) : (
                    <span className="text-[10.5px] text-outline truncate">no socket bound</span>
                  )}
                  <IconButton
                    label="Clear port lookup"
                    size="sm"
                    icon={<X size={11} />}
                    onClick={clearLookup}
                    className="ml-auto"
                  />
                </>
              ) : (
                <>
                  <Crosshair size={12} className="text-outline shrink-0" aria-hidden />
                  <span className="text-[10.5px] text-outline truncate">
                    Type a port to isolate its owner across every interface.
                  </span>
                </>
              )}
            </div>
          </div>
        }
        toolbar={
          <>
            <div
              className={clsx(
                "flex items-center gap-1.5 h-8 pl-2.5 pr-1 rounded-lg border bg-black/40 transition-colors",
                portQuery
                  ? "border-primary/45 shadow-[0_0_0_3px_rgba(10,132,255,0.10)]"
                  : "border-white/[0.075]",
              )}
            >
              <Search size={12} className="text-primary shrink-0" aria-hidden />
              <label htmlFor="port-lookup" className="text-[11px] text-on-variant whitespace-nowrap">
                Who is using port
              </label>
              <input
                id="port-lookup"
                value={portQuery}
                onChange={(event) => setPortQuery(event.target.value.replace(/\D/g, "").slice(0, 5))}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder="3000"
                aria-label="Filter by port number"
                className="w-14 bg-transparent font-mono text-[13px] font-semibold text-primary placeholder:text-outline/60 focus:outline-none tnum"
              />
              {portQuery !== "" && (
                <IconButton label="Clear port lookup" size="sm" icon={<X size={11} />} onClick={clearLookup} />
              )}
            </div>
            <SegmentedControl
              value={protocol}
              onChange={setProtocol}
              ariaLabel="Filter sockets by protocol"
              options={[
                { ...PROTOCOLS[0]!, count: ports.length },
                { ...PROTOCOLS[1]!, count: tcpCount },
                { ...PROTOCOLS[2]!, count: udpCount },
              ]}
            />
            <div className="w-52">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter process or user…"
                aria-label="Filter sockets by process or user"
                sizeVariant="sm"
                leading={<Search size={11} />}
                trailingSlot={
                  query !== "" ? (
                    <IconButton
                      label="Clear text filter"
                      size="sm"
                      icon={<X size={10} />}
                      onClick={() => setQuery("")}
                    />
                  ) : undefined
                }
              />
            </div>
            <span className="flex items-center gap-1.5 h-8 px-2 rounded-lg border border-white/[0.06] bg-black/20 text-[10.5px] text-outline">
              Listening only
              <Switch
                checked={listenOnly}
                onChange={setListenOnly}
                label="Show only listening sockets"
                size="sm"
              />
            </span>
          </>
        }
        status={
          <>
            <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
              Poll 5s
              <Switch checked={auto} onChange={setAuto} label="Toggle 5 second socket polling" size="sm" />
            </span>
            <span className="font-mono text-[10px] text-outline hidden sm:inline" aria-live="polite">
              {sweptAt ? `swept ${sweptAt}` : "awaiting first sweep"}
            </span>
            <IconButton
              label="Refresh socket table"
              icon={<RefreshCw size={13} className={loading ? "animate-spin" : undefined} />}
              onClick={() => void refresh()}
              disabled={loading}
            />
          </>
        }
      >
        {error && (
          <ErrorNotice
            title="Socket table unavailable"
            message={error}
            onRetry={() => {
              setLoading(true);
              void refresh();
            }}
          />
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_296px] gap-3">
          <Card className="min-w-0 flex flex-col overflow-hidden min-h-[240px] 2xl:min-h-0">
            <CardHeader
              title="Socket table"
              icon={<Activity size={13} />}
              hint={`${plural(rows.length, "socket")} shown · sort by port`}
              actions={
                <>
                  <Badge tone="success" mono dot>
                    {shownListening} listen
                  </Badge>
                  <Badge tone="primary" mono>
                    {shownEstablished} estab
                  </Badge>
                  <Badge tone="neutral" mono>
                    {shownProcesses} proc
                  </Badge>
                </>
              }
            />
            <div className="flex-1 min-h-0 overflow-auto">
              <DataTable
                ariaLabel="Network sockets with owning process"
                columns={columns}
                rows={rows}
                rowKey={socketKey}
                activeKey={selectedKey}
                onRowClick={(socket) => setSelectedKey(socketKey(socket))}
                initialSort={{ key: "port", dir: "asc" }}
                empty={
                  <EmptyState
                    compact
                    icon={
                      loading ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : portQuery ? (
                        <Crosshair size={16} />
                      ) : (
                        <Network size={16} />
                      )
                    }
                    title={
                      loading && ports.length === 0
                        ? "Reading the socket table…"
                        : portQuery && lookupRows.length > 0
                          ? `Port ${portQuery} is masked by filters`
                          : portQuery
                            ? `Nothing is bound to port ${portQuery}`
                            : "No sockets match the current filters"
                    }
                    description={
                      loading && ports.length === 0
                        ? "Asking the native core for every TCP and UDP endpoint."
                        : portQuery && lookupRows.length > 0
                          ? "The port has live sockets. Clear the listening-only, protocol or text filter to see them."
                          : portQuery
                            ? "No TCP or UDP socket on this host is using that port right now."
                            : "Relax the protocol, listening-only or text filter to see more sockets."
                    }
                  />
                }
                footer={
                  <tr>
                    <td colSpan={columns.length} className="px-2 h-7">
                      <div
                        aria-live="polite"
                        className="flex items-center justify-between gap-3 font-mono text-[10px] text-outline"
                      >
                        <span className="truncate">
                          {plural(rows.length, "socket")} · {shownListening} listening · {shownEstablished} established ·{" "}
                          {shownProcesses} processes
                        </span>
                        <span className="shrink-0">
                          {ports.length} total · {tcpCount} TCP / {udpCount} UDP
                        </span>
                      </div>
                    </td>
                  </tr>
                }
              />
            </div>
          </Card>

          <Card className="min-w-0 p-3 flex flex-col gap-2.5 2xl:sticky 2xl:top-3 2xl:self-start">
            <SectionLabel
              trailing={
                selected ? (
                  <Badge tone="primary" mono>
                    {selected.protocol.toUpperCase()}
                  </Badge>
                ) : (
                  <Badge tone="neutral" mono>
                    {rows.length} rows
                  </Badge>
                )
              }
            >
              Socket inspector
            </SectionLabel>

            {selected ? (
              <>
                <div className="rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="font-mono text-[22px] leading-none font-semibold text-primary-soft tnum">
                        {selected.port}
                      </span>
                      <span className="font-mono text-[10px] text-outline">/{selected.protocol}</span>
                    </div>
                    <Badge tone={stateTone(selected.state)} mono dot>
                      {selected.state.toUpperCase() || "UNKNOWN"}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
                    <Plug size={11} className="text-outline shrink-0" aria-hidden />
                    <span className="text-[12px] text-on-surface truncate" title={selected.process}>
                      {selected.process}
                    </span>
                    <span className="font-mono text-[10px] text-outline tnum shrink-0">
                      PID {selected.pid === null ? "—" : selected.pid}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-lg bg-black/25 border border-white/[0.05] px-2 py-1.5 min-w-0">
                    <div className="text-[9px] uppercase tracking-[0.08em] text-outline">User</div>
                    <div className="flex items-center gap-1 text-[11px] text-on-surface truncate">
                      <User size={10} className="text-outline shrink-0" aria-hidden />
                      <span className="truncate" title={selected.user}>
                        {selected.user || "—"}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-black/25 border border-white/[0.05] px-2 py-1.5 min-w-0">
                    <div className="text-[9px] uppercase tracking-[0.08em] text-outline">Family</div>
                    <div className="flex items-center gap-1 font-mono text-[11px] text-on-surface">
                      <Globe size={10} className="text-outline shrink-0" aria-hidden />
                      {selected.family}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="rounded-lg bg-black/25 border border-white/[0.05] px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-[0.08em] text-outline">Local address</div>
                    <div className="font-mono text-[11px] text-on-surface break-all">{selected.localAddr}</div>
                  </div>
                  <div className="rounded-lg bg-black/25 border border-white/[0.05] px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-[0.08em] text-outline">Remote address</div>
                    <div className="font-mono text-[11px] text-on-variant break-all">{selected.remoteAddr || "—"}</div>
                  </div>
                </div>

                <div className="space-y-1.5 pt-0.5">
                  <Button
                    block
                    variant="destructive"
                    icon={<Skull size={13} />}
                    onClick={() => setPendingKill(selected)}
                    disabled={busy}
                  >
                    Release port {selected.port}
                  </Button>
                  <p className="font-mono text-[9.5px] leading-relaxed text-outline text-center">
                    SIGTERM now · auto-escalates to SIGKILL after 3s
                  </p>
                </div>
              </>
            ) : (
              <>
                <EmptyState
                  compact
                  icon={<Crosshair size={16} />}
                  title="No socket selected"
                  description="Pick a row to inspect the owning process and release the port."
                />
                <SectionLabel trailing={<span className="font-mono text-[9.5px] text-outline">sockets</span>}>
                  Top owners
                </SectionLabel>
                <div className="space-y-1">
                  {owners.length === 0 && (
                    <p className="text-[10.5px] text-outline px-2 py-1.5">
                      {loading ? "Loading socket owners…" : "No owners visible in this snapshot."}
                    </p>
                  )}
                  {owners.map((owner) => (
                    <div key={`${owner.name}-${owner.pid ?? "na"}`} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2 text-[10.5px]">
                        <span className="text-on-variant truncate" title={owner.name}>
                          {truncateMiddle(owner.name, 22)}
                        </span>
                        <span
                          className="font-mono text-outline shrink-0 tnum"
                          title={`${plural(owner.total, "socket")} · ${owner.listening} listening`}
                        >
                          {owner.total}
                          {owner.listening > 0 ? ` · ${owner.listening}L` : ""}
                        </span>
                      </div>
                      <div className="h-[3px] rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${Math.round((owner.total / (owners[0]?.total ?? 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <InfoNotice icon={<AlertTriangle size={12} />} tone="neutral">
                  Kill is refused for PID &lt; 100, for this app, and when the listener belongs to another user.
                  Ports below 1024 usually need elevated rights.
                </InfoNotice>
              </>
            )}
          </Card>
        </div>
      </ToolView>

      <ConfirmDialog
        open={pendingKill !== null}
        busy={busy}
        destructive
        title={pendingKill ? `Terminate ${pendingKill.process} on port ${pendingKill.port}?` : "Terminate listener?"}
        message={
          pendingKill
            ? pendingKill.pid === null
              ? `SIGTERM (15) goes to every process bound to ${pendingKill.protocol.toUpperCase()} ${pendingKill.localAddr}. No owning PID is visible for this socket, so the target cannot be named in advance. The native core escalates to SIGKILL after 3 seconds; unsaved work in those processes is lost.`
              : `SIGTERM (15) goes to every process bound to ${pendingKill.protocol.toUpperCase()} ${pendingKill.localAddr}, starting with ${pendingKill.process} (PID ${pendingKill.pid}). The native core escalates to SIGKILL after 3 seconds if they ignore it; unsaved work in those processes is lost.`
            : ""
        }
        confirmLabel="Send SIGTERM"
        onConfirm={() => {
          if (pendingKill) void runKill(pendingKill, false);
        }}
        onCancel={() => setPendingKill(null)}
        detail={
          pendingKill && (
            <div className="rounded-lg border border-white/[0.07] bg-black/35 divide-y divide-white/[0.05] font-mono text-[10.5px]">
              <div className="flex items-center justify-between px-2 py-1.5 gap-3">
                <span className="text-outline">Socket</span>
                <span className="text-on-surface truncate">
                  {pendingKill.protocol.toUpperCase()} {pendingKill.localAddr}
                </span>
              </div>
              <div className="flex items-center justify-between px-2 py-1.5 gap-3">
                <span className="text-outline">Owner</span>
                <span className="text-on-surface truncate">
                  {pendingKill.process}
                  {pendingKill.pid === null ? "" : ` · ${pendingKill.pid}`}
                </span>
              </div>
              <div className="flex items-center justify-between px-2 py-1.5 gap-3">
                <span className="text-outline">User</span>
                <span className="text-on-surface truncate">{pendingKill.user || "—"}</span>
              </div>
            </div>
          )
        }
      />

      <ConfirmDialog
        open={forceTarget !== null}
        busy={busy}
        destructive
        title={forceTarget ? `Force kill the listener on port ${forceTarget.socket.port}?` : "Force kill?"}
        message={
          forceTarget
            ? `SIGTERM did not release ${forceTarget.socket.protocol.toUpperCase()} ${forceTarget.socket.localAddr}: ${forceTarget.reason.replace(/\.+$/, "")}. SIGKILL (9) cannot be ignored by a user process — ${forceTarget.socket.process}${
                forceTarget.socket.pid === null ? "" : ` (PID ${forceTarget.socket.pid})`
              } is terminated immediately with no cleanup. A process owned by another user or a system PID is still refused.`
            : ""
        }
        confirmLabel="Force kill (-9)"
        onConfirm={() => {
          if (forceTarget) void runKill(forceTarget.socket, true);
        }}
        onCancel={() => setForceTarget(null)}
      />
    </>
  );
}
