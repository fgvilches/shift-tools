import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Crosshair,
  Gauge,
  Network,
  Play,
  Route,
  Square,
  Timer,
  Trash2,
  Waves,
} from "lucide-react";
import { ToolView, type Telemetry } from "@/components/layout/ToolView";
import { Badge, Dot } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CodeArea";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState, ErrorNotice, InfoNotice, Progress, Spinner } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Form";
import { Tabs } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { network } from "@/lib/api";
import { clockTime, ms, percent, plural } from "@/lib/format";
import { errorMessage } from "@/lib/ipc";
import type { PingSample, TracerouteHop } from "@/lib/types";
import { RttTimeline } from "./components/RttTimeline";

type Mode = "ping" | "traceroute";
type RunState = "idle" | "running" | "done" | "stopped" | "error";
type Tone = "neutral" | "primary" | "success" | "warning" | "error" | "tertiary";

const DEFAULT_HOST = "1.1.1.1";
const COUNTS = [5, 10, 20, 50] as const;
const HOP_LIMITS = [8, 16, 24, 30, 48, 64] as const;
const HOST_INPUT_ID = "ping-target-input";
const SAMPLE_CAP = 400;
const CHART_WINDOW = 120;
/** Messages the backend emits when the whole run is unrecoverable. */
const FATAL_ERROR = /100\.0% packet loss|could not run ping|unknown host|no route to host/i;

const RUN_META: Record<RunState, { label: string; tone: Tone }> = {
  idle: { label: "Idle", tone: "neutral" },
  running: { label: "Streaming", tone: "success" },
  done: { label: "Complete", tone: "primary" },
  stopped: { label: "Stopped", tone: "warning" },
  error: { label: "Failed", tone: "error" },
};

interface PingStats {
  attempts: number;
  received: number;
  lost: number;
  lossPct: number;
  last: number | null;
  min: number | null;
  avg: number | null;
  max: number | null;
  jitter: number | null;
}

interface TraceStats {
  total: number;
  responders: number;
  unresolved: number;
  maxRtt: number | null;
  meanRtt: number | null;
  reached: boolean;
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latencyClass(value: number): string {
  if (value < 30) return "text-secondary";
  if (value < 100) return "text-primary-soft";
  if (value < 250) return "text-warning";
  return "text-error";
}

function jitterGrade(value: number | null): { label: string; tone: Tone } {
  if (value === null) return { label: "No samples", tone: "neutral" };
  if (value < 1) return { label: "Grade A", tone: "success" };
  if (value < 5) return { label: "Grade B", tone: "success" };
  if (value < 15) return { label: "Grade C", tone: "warning" };
  return { label: "Grade D", tone: "error" };
}

function probeValue(value: number | undefined): ReactNode {
  if (value === undefined) return <span className="text-outline/70">*</span>;
  return <span className={latencyClass(value)}>{value.toFixed(2)}</span>;
}

function MiniStat({ label, value, tone = "text-on-surface" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-black/30 px-2 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</div>
      <div className={`font-mono text-[12px] leading-tight tnum ${tone}`}>{value}</div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</dt>
      <dd className="min-w-0 break-all text-right font-mono text-[10.5px] text-on-variant tnum">{children}</dd>
    </div>
  );
}

export default function PingTracerouteView() {
  const [mode, setMode] = useState<Mode>("ping");
  const [host, setHost] = useState(DEFAULT_HOST);
  const [count, setCount] = useState<number>(10);
  const [maxHops, setMaxHops] = useState<number>(30);

  const [samples, setSamples] = useState<PingSample[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [pingTarget, setPingTarget] = useState(DEFAULT_HOST);
  const [pingCount, setPingCount] = useState<number>(10);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  const [hops, setHops] = useState<TracerouteHop[] | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceTarget, setTraceTarget] = useState<string | null>(null);
  const [traceStartedAt, setTraceStartedAt] = useState<string | null>(null);

  const pingToken = useRef(0);
  const pingUnsub = useRef<(() => void) | null>(null);
  const pingGuard = useRef<number | null>(null);
  const pingAttempts = useRef(0);
  const pingRunning = useRef(false);
  const traceToken = useRef(0);

  const clearPingListeners = useCallback(() => {
    pingUnsub.current?.();
    pingUnsub.current = null;
    if (pingGuard.current !== null) {
      window.clearTimeout(pingGuard.current);
      pingGuard.current = null;
    }
  }, []);

  const endPing = useCallback(
    (state: RunState, message: string | null = null) => {
      pingToken.current += 1;
      clearPingListeners();
      pingRunning.current = false;
      setRunState(state);
      setRunError(message);
    },
    [clearPingListeners],
  );

  const startPing = useCallback(() => {
    const target = host.trim();
    if (!target) {
      toast.warning("Enter a target", "A hostname or IP address is required.");
      document.getElementById(HOST_INPUT_ID)?.focus();
      return;
    }
    if (/\s/.test(target)) {
      toast.warning("Invalid target", "Hostnames cannot contain spaces.");
      return;
    }

    clearPingListeners();
    pingToken.current += 1;
    const token = pingToken.current;
    const requested = count;

    pingAttempts.current = 0;
    pingRunning.current = true;
    setSamples([]);
    setRunError(null);
    setRunState("running");
    setPingTarget(target);
    setPingCount(requested);
    setStartedAt(new Date().toISOString());
    setTaskId(null);

    pingUnsub.current = network.onPing((sample) => {
      if (token !== pingToken.current) return;
      pingAttempts.current += 1;
      setSamples((prev) => [...prev, sample].slice(-SAMPLE_CAP));

      const fatal = sample.error !== null && FATAL_ERROR.test(sample.error);
      if (pingAttempts.current >= requested || fatal) {
        endPing(fatal ? "error" : "done", fatal ? sample.error : null);
      }
    });

    const guardMs = requested * 1500 + 8000;
    pingGuard.current = window.setTimeout(() => {
      if (token !== pingToken.current) return;
      endPing(
        "stopped",
        `The reply stream stayed silent for ${Math.round(guardMs / 1000)}s. The host may be filtering ICMP.`,
      );
    }, guardMs);

    void network
      .ping(target, requested)
      .then((id) => {
        if (token === pingToken.current) setTaskId(id);
      })
      .catch((err: unknown) => {
        if (token !== pingToken.current) return;
        endPing("error", errorMessage(err));
      });
  }, [host, count, clearPingListeners, endPing]);

  const stopPing = useCallback(() => {
    if (!pingRunning.current) return;
    endPing("stopped");
  }, [endPing]);

  const runTraceroute = useCallback(() => {
    const target = host.trim();
    if (!target) {
      toast.warning("Enter a target", "A hostname or IP address is required.");
      document.getElementById(HOST_INPUT_ID)?.focus();
      return;
    }
    if (/\s/.test(target)) {
      toast.warning("Invalid target", "Hostnames cannot contain spaces.");
      return;
    }

    traceToken.current += 1;
    const token = traceToken.current;
    setTraceLoading(true);
    setTraceError(null);
    setHops(null);
    setTraceTarget(target);
    setTraceStartedAt(new Date().toISOString());

    network
      .traceroute(target, maxHops)
      .then((result) => {
        if (token !== traceToken.current) return;
        setHops(result);
      })
      .catch((err: unknown) => {
        if (token !== traceToken.current) return;
        setTraceError(errorMessage(err));
        setHops(null);
      })
      .finally(() => {
        if (token === traceToken.current) setTraceLoading(false);
      });
  }, [host, maxHops]);

  const changeMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      if (pingRunning.current) endPing("stopped");
      setMode(next);
    },
    [mode, endPing],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pingRunning.current) endPing("stopped");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [endPing]);

  useEffect(() => {
    return () => {
      pingToken.current += 1;
      pingUnsub.current?.();
      if (pingGuard.current !== null) window.clearTimeout(pingGuard.current);
      traceToken.current += 1;
    };
  }, []);

  const pingStats = useMemo<PingStats>(() => {
    const rtts = samples.flatMap<number>((sample) => (sample.rttMs === null ? [] : [sample.rttMs]));
    const attempts = samples.length;
    const received = rtts.length;
    const lost = attempts - received;
    const sum = rtts.reduce((acc, value) => acc + value, 0);

    let jitter: number | null = null;
    if (rtts.length > 1) {
      let delta = 0;
      for (let index = 1; index < rtts.length; index += 1) {
        delta += Math.abs(rtts[index] - rtts[index - 1]);
      }
      jitter = delta / (rtts.length - 1);
    }

    return {
      attempts,
      received,
      lost,
      lossPct: attempts === 0 ? 0 : (lost / attempts) * 100,
      last: rtts.length > 0 ? rtts[rtts.length - 1] : null,
      min: rtts.length > 0 ? Math.min(...rtts) : null,
      avg: rtts.length > 0 ? sum / rtts.length : null,
      max: rtts.length > 0 ? Math.max(...rtts) : null,
      jitter,
    };
  }, [samples]);

  const chartValues = useMemo(
    () => samples.flatMap<number>((sample) => (sample.rttMs === null ? [] : [sample.rttMs])).slice(-CHART_WINDOW),
    [samples],
  );

  const traceStats = useMemo<TraceStats>(() => {
    const list = hops ?? [];
    const responders = list.filter((hop) => hop.ip !== null);
    const allRtts = list.flatMap<number>((hop) => hop.rttMs);
    const lastHop = list.length > 0 ? list[list.length - 1] : null;
    return {
      total: list.length,
      responders: responders.length,
      unresolved: list.length - responders.length,
      maxRtt: allRtts.length > 0 ? Math.max(...allRtts) : null,
      meanRtt: meanOf(allRtts),
      reached: lastHop !== null && lastHop.ip !== null,
    };
  }, [hops]);

  const routeText = useMemo(() => {
    if (!hops || hops.length === 0) return "";
    const target = traceTarget ?? host.trim();
    const lines = hops.map((hop) => {
      const probes = hop.rttMs.length > 0 ? hop.rttMs.map((value) => `${value.toFixed(2)} ms`).join("  ") : "* * *";
      return `${String(hop.hop).padStart(2, " ")}  ${hop.ip ?? "*"}  ${probes}`;
    });
    return [`traceroute to ${target} · max ${maxHops} hops · 3 probes`, ...lines].join("\n");
  }, [hops, traceTarget, host, maxHops]);

  const traceCommand = `traceroute -n -w 2 -q 3 -m ${maxHops} ${traceTarget ?? (host.trim() || "host")}`;

  const meta = RUN_META[runState];
  const running = runState === "running";
  const grade = jitterGrade(pingStats.jitter);
  const destinationKey =
    hops && hops.length > 0 && hops[hops.length - 1].ip !== null ? hops[hops.length - 1].hop : null;

  const telemetry: Telemetry[] =
    mode === "ping"
      ? [
          {
            label: "State",
            value: meta.label.toUpperCase(),
            tone: meta.tone,
            icon: <Dot tone={meta.tone} pulse={running} />,
          },
          {
            label: "Last RTT",
            value: pingStats.last === null ? "—" : ms(pingStats.last, 2),
            tone: "primary",
            icon: <Activity size={14} />,
          },
          {
            label: "Average",
            value: pingStats.avg === null ? "—" : ms(pingStats.avg, 2),
            tone: "success",
            icon: <Gauge size={14} />,
          },
          {
            label: "Loss",
            value: pingStats.attempts === 0 ? "—" : percent(pingStats.lossPct, 1),
            tone: pingStats.lossPct > 0 ? "error" : "success",
            icon: <Waves size={14} />,
          },
        ]
      : [
          {
            label: "State",
            value: traceLoading ? "TRACING" : traceStats.total > 0 ? "CAPTURED" : "IDLE",
            tone: traceLoading ? "primary" : traceStats.total > 0 ? "success" : "neutral",
            icon: <Route size={14} />,
          },
          {
            label: "Hops",
            value: hops ? String(traceStats.total) : "—",
            tone: "primary",
            icon: <Network size={14} />,
          },
          {
            label: "Responders",
            value: hops ? `${traceStats.responders}/${traceStats.total}` : "—",
            tone: "success",
            icon: <Dot tone={traceStats.unresolved > 0 ? "warning" : "success"} />,
          },
          {
            label: "Max RTT",
            value: traceStats.maxRtt === null ? "—" : ms(traceStats.maxRtt, 2),
            tone: "tertiary",
            icon: <Timer size={14} />,
          },
        ];

  const sampleColumns: Column<PingSample>[] = [
    {
      key: "seq",
      header: "Seq",
      width: 64,
      mono: true,
      render: (sample) => (
        <span className="text-outline">{sample.error !== null ? "—" : `#${sample.seq}`}</span>
      ),
    },
    {
      key: "rtt",
      header: "RTT",
      width: 92,
      align: "right",
      mono: true,
      render: (sample) =>
        sample.rttMs === null ? (
          <span className="text-error/80">—</span>
        ) : (
          <span className={latencyClass(sample.rttMs)}>{ms(sample.rttMs, 2)}</span>
        ),
    },
    {
      key: "ttl",
      header: "TTL",
      width: 60,
      align: "right",
      mono: true,
      render: (sample) => <span className="text-on-variant">{sample.ttl ?? "—"}</span>,
    },
    {
      key: "status",
      header: "Result",
      width: 86,
      render: (sample) =>
        sample.error !== null ? (
          <Badge tone="error" mono>
            lost
          </Badge>
        ) : (
          <Badge tone="success" mono>
            reply
          </Badge>
        ),
    },
    {
      key: "detail",
      header: "Detail",
      render: (sample) => (
        <span
          className={
            sample.error !== null
              ? "block max-w-[420px] truncate font-mono text-[10.5px] text-error/85"
              : "font-mono text-[10.5px] text-outline"
          }
          title={sample.error ?? "ICMP echo reply"}
        >
          {sample.error ?? "ICMP echo reply received"}
        </span>
      ),
    },
  ];

  const hopColumns: Column<TracerouteHop>[] = [
    {
      key: "hop",
      header: "Hop",
      width: 54,
      mono: true,
      render: (hop) => <span className="text-outline">{String(hop.hop).padStart(2, "0")}</span>,
    },
    {
      key: "node",
      header: "Node / IP",
      render: (hop) => (
        <div className="flex min-w-0 items-center gap-1.5 py-0.5">
          <Dot tone={hop.ip === null ? "warning" : "success"} />
          <span
            className={
              hop.ip === null
                ? "font-mono text-[11.5px] text-warning"
                : "font-mono text-[11.5px] text-on-surface"
            }
          >
            {hop.ip ?? "*"}
          </span>
          {hop.host !== null && hop.host !== hop.ip && (
            <span className="max-w-[220px] truncate font-mono text-[10px] text-outline">{hop.host}</span>
          )}
          {destinationKey !== null && hop.hop === destinationKey && (
            <Badge tone="primary" mono className="h-4 px-1.5 text-[9px]">
              target
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "probe1",
      header: "Probe 1",
      width: 78,
      align: "right",
      mono: true,
      render: (hop) => probeValue(hop.rttMs[0]),
    },
    {
      key: "probe2",
      header: "Probe 2",
      width: 78,
      align: "right",
      mono: true,
      render: (hop) => probeValue(hop.rttMs[1]),
    },
    {
      key: "probe3",
      header: "Probe 3",
      width: 78,
      align: "right",
      mono: true,
      render: (hop) => probeValue(hop.rttMs[2]),
    },
    {
      key: "loss",
      header: "Loss",
      width: 58,
      align: "right",
      mono: true,
      render: (hop) => {
        const missing = Math.max(0, 3 - Math.min(3, hop.rttMs.length));
        const value = Math.round((missing / 3) * 100);
        return <span className={value === 0 ? "text-secondary" : value === 100 ? "text-error" : "text-warning"}>{value}%</span>;
      },
    },
    {
      key: "trend",
      header: "Latency",
      width: 146,
      render: (hop) => {
        const hopMean = meanOf(hop.rttMs);
        const width =
          hopMean === null || traceStats.maxRtt === null || traceStats.maxRtt <= 0
            ? 0
            : Math.max(3, Math.min(100, (hopMean / traceStats.maxRtt) * 100));
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-[88px] overflow-hidden rounded-full border border-white/[0.05] bg-black/45">
              <div
                className={width === 100 ? "h-full rounded-full bg-secondary/80" : "h-full rounded-full bg-primary/80"}
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="w-10 text-right font-mono text-[9.5px] text-outline tnum">
              {hopMean === null ? "—" : hopMean.toFixed(1)}
            </span>
          </div>
        );
      },
    },
  ];

  const pingEmpty = running ? (
    <EmptyState
      compact
      icon={<Spinner size={16} />}
      title="Waiting for replies…"
      description={`${pingTarget} is being probed ${pingCount} times, one echo per second.`}
    />
  ) : runState === "error" ? (
    <EmptyState
      compact
      icon={<AlertTriangle size={16} />}
      title="Probe failed"
      description={runError ?? "The backend could not start the ping."}
    />
  ) : (
    <EmptyState
      compact
      icon={<Activity size={16} />}
      title="No echo samples"
      description="Enter a target and press Enter — every reply, timeout and TTL lands here."
      action={
        <Button size="sm" variant="primary" icon={<Play size={12} />} onClick={startPing}>
          Start ping
        </Button>
      }
    />
  );

  const traceEmpty = traceLoading ? (
    <EmptyState
      compact
      icon={<Spinner size={16} />}
      title={`Tracing route to ${traceTarget ?? host.trim()}…`}
      description={`Walking up to ${maxHops} hops with three probes each. This can take 10–30 seconds.`}
    />
  ) : traceError !== null ? (
    <EmptyState
      compact
      icon={<AlertTriangle size={16} />}
      title="No path captured"
      description="The trace failed before a hop was returned. The error is shown above."
    />
  ) : hops !== null ? (
    <EmptyState
      compact
      icon={<Route size={16} />}
      title="No hops returned"
      description="traceroute exited without a parseable hop. The target may be unreachable."
    />
  ) : (
    <EmptyState
      compact
      icon={<Route size={16} />}
      title="No route captured"
      description="Walk the path hop by hop with three RTT probes per hop, then copy it as text."
      action={
        <Button size="sm" variant="primary" icon={<Play size={12} />} onClick={runTraceroute}>
          Run traceroute
        </Button>
      }
    />
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "ping") startPing();
    else runTraceroute();
  };

  return (
    <ToolView
      eyebrow="LATENCY PROBE"
      eyebrowTone="primary"
      eyebrowHint="ICMP ECHO · TTL WALK"
      title="Ping / Traceroute"
      description="Live latency samples and the actual path packets take to a host."
      telemetry={telemetry}
      toolbar={
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-1.5">
          <div className="w-full sm:w-[264px]">
            <Input
              id={HOST_INPUT_ID}
              mono
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="IPv4, IPv6 or hostname"
              aria-label="Target host or IP"
              spellCheck={false}
              autoComplete="off"
              leading={<Crosshair size={12} />}
            />
          </div>
          {mode === "ping" ? (
            <>
              <span className="hidden pl-1 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline md:inline">
                Count
              </span>
              <div className="w-[68px]">
                <Select
                  value={String(count)}
                  onChange={(event) => setCount(Number(event.target.value))}
                  options={COUNTS.map((value) => ({ value: String(value), label: String(value) }))}
                  aria-label="Echo request count"
                  title="Echo requests to send"
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                size="md"
                icon={<Play size={13} />}
                disabled={running}
                trailing={<Kbd>↵</Kbd>}
              >
                Start ping
              </Button>
              <Button
                variant="destructive"
                size="md"
                icon={<Square size={11} />}
                onClick={stopPing}
                disabled={!running}
              >
                Stop
              </Button>
            </>
          ) : (
            <>
              <span className="hidden pl-1 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline md:inline">
                Hop cap
              </span>
              <div className="w-[76px]">
                <Select
                  value={String(maxHops)}
                  onChange={(event) => setMaxHops(Number(event.target.value))}
                  options={HOP_LIMITS.map((value) => ({ value: String(value), label: String(value) }))}
                  aria-label="Maximum hops"
                  title="Maximum hops to walk"
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={traceLoading}
                icon={<Route size={13} />}
                trailing={<Kbd>↵</Kbd>}
              >
                Run traceroute
              </Button>
            </>
          )}
        </form>
      }
      status={
        <>
          <span aria-live="polite">
            <Badge tone={meta.tone} mono dot pulse={running}>
              {meta.label}
            </Badge>
          </span>
          <Badge tone="neutral" mono>
            {mode === "ping" ? `${pingCount} echoes` : `${maxHops} hop cap`}
          </Badge>
        </>
      }
    >
      <Card className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5">
        <Tabs<Mode>
          value={mode}
          onChange={changeMode}
          ariaLabel="Probe mode"
          items={[
            {
              value: "ping",
              label: "Ping",
              icon: <Activity size={11} />,
              count: samples.length > 0 ? samples.length : undefined,
            },
            {
              value: "traceroute",
              label: "Traceroute",
              icon: <Route size={11} />,
              count: hops !== null ? hops.length : undefined,
            },
          ]}
        />
        <div className="flex items-center gap-1.5 pr-0.5 text-[10px] text-outline">
          {mode === "ping" ? (
            <>
              <span>Enter starts</span>
              <Kbd>Esc</Kbd>
              <span>stops</span>
            </>
          ) : (
            <>
              <span>3 probes per hop</span>
              <span className="text-outline/50">·</span>
              <span className="font-mono">traceroute</span>
            </>
          )}
        </div>
      </Card>

      {mode === "ping" ? (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_304px]">
          <div className="flex min-w-0 flex-col gap-3">
            <Card className="overflow-hidden">
              <CardHeader
                title="Round-trip timeline"
                hint={`${pingTarget} · last ${CHART_WINDOW} replies plotted`}
                icon={<Activity size={13} />}
                actions={
                  <>
                    <Badge tone={pingStats.last === null ? "neutral" : "primary"} mono>
                      {pingStats.last === null ? "no reply" : ms(pingStats.last, 2)}
                    </Badge>
                    <Badge tone="neutral" mono>
                      {plural(samples.length, "event")}
                    </Badge>
                  </>
                }
              />
              {runError !== null && (
                <div className="px-3 pt-2.5">
                  <ErrorNotice title="Ping failed" message={runError} onRetry={startPing} />
                </div>
              )}
              <div className="p-3">
                <RttTimeline
                  values={chartValues}
                  height={148}
                  ariaLabel={`Round-trip latency samples for ${pingTarget}`}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-outline">
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1.5">
                      <span className="h-[2px] w-4 rounded bg-primary" />
                      RTT
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-4 border-t border-dashed border-secondary/70" />
                      Mean
                    </span>
                    <span>Loss events are not plotted</span>
                  </span>
                  <span className="font-mono tnum">
                    {pingStats.min === null || pingStats.max === null
                      ? "awaiting samples"
                      : `min ${pingStats.min.toFixed(2)} · max ${pingStats.max.toFixed(2)} ms`}
                  </span>
                </div>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader
                title="Echo sample log"
                hint="Newest first · one row per reply or timeout"
                icon={<Waves size={13} />}
                actions={
                  <>
                    <Badge tone="neutral" mono>
                      {plural(samples.length, "row")}
                    </Badge>
                    <IconButton
                      label="Clear echo samples"
                      icon={<Trash2 size={12} />}
                      onClick={() => setSamples([])}
                      disabled={samples.length === 0 || running}
                    />
                  </>
                }
              />
              <DataTable
                ariaLabel="Ping echo samples"
                columns={sampleColumns}
                rows={[...samples].reverse()}
                rowKey={(sample, index) => `${sample.seq}-${sample.error === null ? "r" : "e"}-${index}`}
                maxHeight="262px"
                empty={pingEmpty}
                footer={
                  samples.length > 0 ? (
                    <tr>
                      <td colSpan={sampleColumns.length} className="h-7 px-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-outline">
                          <span aria-live="polite">
                            {pingStats.attempts} events · {pingStats.received} replies ·{" "}
                            {percent(pingStats.lossPct, 1)} loss
                          </span>
                          <span className="flex items-center gap-1">
                            <Kbd>↵</Kbd> start
                            <span className="px-1 text-outline/50">·</span>
                            <Kbd>Esc</Kbd> stop
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : undefined
                }
              />
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <Card className="overflow-hidden">
              <CardHeader
                title="Probe statistics"
                hint={pingTarget}
                icon={<Gauge size={13} />}
                actions={
                  <Badge tone={meta.tone} mono dot pulse={running}>
                    {meta.label}
                  </Badge>
                }
              />
              <div className="space-y-2.5 p-3">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
                      Latest RTT
                    </div>
                    <div className="font-mono text-[26px] leading-none text-on-surface tnum">
                      {pingStats.last === null ? "—" : pingStats.last.toFixed(2)}
                      <span className="ml-1 text-[11px] text-outline">ms</span>
                    </div>
                  </div>
                  <Badge tone={grade.tone} mono>
                    {grade.label}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <MiniStat
                    label="Min"
                    value={pingStats.min === null ? "—" : pingStats.min.toFixed(2)}
                    tone="text-secondary"
                  />
                  <MiniStat
                    label="Avg"
                    value={pingStats.avg === null ? "—" : pingStats.avg.toFixed(2)}
                    tone="text-primary-soft"
                  />
                  <MiniStat
                    label="Max"
                    value={pingStats.max === null ? "—" : pingStats.max.toFixed(2)}
                    tone="text-tertiary"
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-outline">
                  <span>Replies</span>
                  <span aria-live="polite" className="font-mono text-on-variant tnum">
                    {pingStats.received}/{pingStats.attempts || pingCount} ack · {pingStats.lost} lost
                  </span>
                </div>
                <Progress
                  value={pingStats.attempts === 0 ? 0 : 100 - pingStats.lossPct}
                  tone={pingStats.lossPct === 0 ? "success" : pingStats.lossPct < 10 ? "warning" : "error"}
                  height={4}
                  label="Echo reply rate"
                />

                <dl className="space-y-1">
                  <DetailRow label="Jitter">
                    {pingStats.jitter === null ? "—" : `${pingStats.jitter.toFixed(2)} ms`}
                  </DetailRow>
                  <DetailRow label="Requested">{pingCount} echoes</DetailRow>
                  <DetailRow label="Started">{startedAt === null ? "—" : clockTime(startedAt)}</DetailRow>
                  <DetailRow label="Task">{taskId === null ? "—" : taskId.slice(0, 8)}</DetailRow>
                </dl>

                <InfoNotice tone="neutral" icon={<Square size={11} />}>
                  Stop detaches this view; the system ping still finishes the requested count on its own.
                </InfoNotice>
              </div>
            </Card>

            <Card className="p-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-outline">
                  <span className="font-semibold uppercase tracking-[0.08em]">Sample window</span>
                  <span className="font-mono tnum">
                    {chartValues.length}/{CHART_WINDOW}
                  </span>
                </div>
                <Progress
                  value={Math.min(100, (chartValues.length / CHART_WINDOW) * 100)}
                  tone="primary"
                  height={3}
                  label="Samples held in the timeline window"
                />
                <p className="text-[10.5px] leading-relaxed text-outline">
                  {plural(samples.length, "event")} kept in the log ({SAMPLE_CAP} cap) · {plural(pingStats.lost, "timeout")} counted
                  as loss.
                </p>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_304px]">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader
              title="Route vector"
              hint={traceTarget === null ? "No target traced yet" : `${traceTarget} · 3 probes per hop`}
              icon={<Route size={13} />}
              actions={
                <>
                  {hops !== null && hops.length > 0 && (
                    <Badge tone={traceStats.reached ? "success" : "warning"} mono dot>
                      {traceStats.reached ? "destination" : "max hops"}
                    </Badge>
                  )}
                  <CopyButton text={routeText} label="Copy path" size="sm" disabled={routeText.length === 0} />
                </>
              }
            />
            {traceLoading && <Progress indeterminate height={2} label="Traceroute in progress" />}
            {traceError !== null && (
              <div className="px-3 pt-2.5">
                <ErrorNotice title="Traceroute failed" message={traceError} onRetry={runTraceroute} />
              </div>
            )}
            <DataTable
              ariaLabel="Traceroute hop path"
              columns={hopColumns}
              rows={hops ?? []}
              rowKey={(hop) => hop.hop}
              activeKey={destinationKey}
              empty={traceEmpty}
              footer={
                hops !== null && hops.length > 0 ? (
                  <tr>
                    <td colSpan={hopColumns.length} className="h-7 px-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-outline">
                        <span>
                          {plural(traceStats.total, "hop")} · {traceStats.responders} responded ·{" "}
                          {traceStats.unresolved} silent
                        </span>
                        <span>
                          {traceStats.maxRtt === null ? "no RTT" : `max ${traceStats.maxRtt.toFixed(2)} ms`}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : undefined
              }
            />
          </Card>

          <div className="flex min-w-0 flex-col gap-3">
            <Card className="overflow-hidden">
              <CardHeader
                title="Path summary"
                hint={traceTarget ?? "No target traced yet"}
                icon={<Network size={13} />}
                actions={
                  <Badge tone={traceLoading ? "primary" : hops === null ? "neutral" : "success"} mono>
                    {traceLoading ? "tracing" : hops === null ? "idle" : `${hops.length} hops`}
                  </Badge>
                }
              />
              <div className="space-y-2.5 p-3">
                <div className="grid grid-cols-3 gap-1.5">
                  <MiniStat label="Hops" value={hops === null ? "—" : traceStats.total} tone="text-primary-soft" />
                  <MiniStat label="Replied" value={hops === null ? "—" : traceStats.responders} tone="text-secondary" />
                  <MiniStat label="Silent" value={hops === null ? "—" : traceStats.unresolved} tone="text-warning" />
                </div>
                <dl className="space-y-1">
                  <DetailRow label="Max RTT">
                    {traceStats.maxRtt === null ? "—" : `${traceStats.maxRtt.toFixed(2)} ms`}
                  </DetailRow>
                  <DetailRow label="Mean RTT">
                    {traceStats.meanRtt === null ? "—" : `${traceStats.meanRtt.toFixed(2)} ms`}
                  </DetailRow>
                  <DetailRow label="Hop cap">{maxHops}</DetailRow>
                  <DetailRow label="Started">
                    {traceStartedAt === null ? "—" : clockTime(traceStartedAt)}
                  </DetailRow>
                </dl>
                <InfoNotice tone="neutral" icon={<AlertTriangle size={11} />}>
                  A hop shown as * did not answer the TTL probe. Routers often rate-limit or drop ICMP replies.
                </InfoNotice>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader
                title="Trace command"
                hint="Executed by the Rust core"
                icon={<Timer size={13} />}
                actions={<CopyButton text={traceCommand} label="Copy" size="xs" />}
              />
              <pre className="whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-on-variant">
                {traceCommand}
              </pre>
            </Card>
          </div>
        </div>
      )}
    </ToolView>
  );
}
