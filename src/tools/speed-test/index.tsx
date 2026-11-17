import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cloud,
  Play,
  RotateCcw,
  Server,
  Timer,
  Waves,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge } from "@/components/ui/Badge";
import { Button, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { EmptyState, ErrorNotice, InfoNotice, Spinner } from "@/components/ui/Feedback";
import { SegmentedControl } from "@/components/ui/Form";
import { toast } from "@/components/ui/Toast";
import { network } from "@/lib/api";
import { bytes, ms } from "@/lib/format";
import { errorMessage } from "@/lib/ipc";
import type { SpeedSample, SpeedTestResult } from "@/lib/types";
import { ThroughputChart } from "./components/ThroughputChart";
import { ThroughputGauge } from "./components/ThroughputGauge";
import { RATE_UNIT_LABEL, niceCeiling, rateParts, secondsLabel, toRateUnit, type RateUnit } from "./lib/units";

type Phase = "idle" | "running" | "done" | "error";

const TARGET_HOST = "speed.cloudflare.com";
const SAMPLE_CAP = 600;
const UNIT_OPTIONS: { value: RateUnit; label: string }[] = [
  { value: "mbps", label: "Mbps" },
  { value: "mbytes", label: "MB/s" },
];

const PHASE_META: Record<Phase, { label: string; tone: "neutral" | "primary" | "success" | "error" }> = {
  idle: { label: "idle", tone: "neutral" },
  running: { label: "running", tone: "primary" },
  done: { label: "complete", tone: "success" },
  error: { label: "failed", tone: "error" },
};

function KpiTile({
  label,
  value,
  icon,
  tone = "text-on-surface",
  className = "",
  title,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: string;
  className?: string;
  title?: string;
}) {
  return (
    <div className={`rounded-lg border border-white/[0.055] bg-black/[0.28] px-2.5 py-1.5 ${className}`} title={title}>
      <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
        <span className="text-outline/80">{icon}</span>
        {label}
      </div>
      <div className={`mt-0.5 truncate font-mono text-[13px] font-semibold leading-tight tnum ${tone}`}>{value}</div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-[10.5px] text-on-variant tnum">{children}</dd>
    </div>
  );
}

export default function SpeedTestView() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [samples, setSamples] = useState<SpeedSample[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<RateUnit>("mbps");
  const [elapsed, setElapsed] = useState(0);

  const tokenRef = useRef(0);
  const runningRef = useRef(false);
  const startedAtRef = useRef(0);
  const unsubRef = useRef<(() => void) | null>(null);

  const running = phase === "running";

  const stopStream = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    tokenRef.current += 1;
    const token = tokenRef.current;

    stopStream();
    startedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    setPhase("running");
    setResult(null);
    setSamples([]);
    setError(null);
    setElapsed(0);

    unsubRef.current = network.onSpeed((sample) => {
      if (token !== tokenRef.current) return;
      setSamples((prev) => (prev.length >= SAMPLE_CAP ? [...prev.slice(1), sample] : [...prev, sample]));
    });

    network
      .speedTest()
      .then((next) => {
        if (token !== tokenRef.current) return;
        setResult(next);
        setElapsed(next.durationMs);
        setPhase("done");
        toast.success(
          "Speed test complete",
          `${next.downloadMbps.toFixed(1)} Mbps down · ${next.latencyMs === null ? "latency unknown" : ms(next.latencyMs)}`,
        );
      })
      .catch((err: unknown) => {
        if (token !== tokenRef.current) return;
        const message = errorMessage(err);
        setError(message);
        setPhase("error");
        toast.error("Speed test failed", message);
      })
      .finally(() => {
        if (token !== tokenRef.current) return;
        runningRef.current = false;
        stopStream();
      });
  }, [stopStream]);

  const reset = useCallback(() => {
    if (runningRef.current) return;
    tokenRef.current += 1;
    stopStream();
    setPhase("idle");
    setResult(null);
    setSamples([]);
    setError(null);
    setElapsed(0);
  }, [stopStream]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, performance.now() - startedAtRef.current));
    }, 100);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    return () => {
      tokenRef.current += 1;
      runningRef.current = false;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start]);

  const latest = samples.length > 0 ? samples[samples.length - 1] : null;
  const currentMbps = phase === "done" && result ? result.downloadMbps : running ? (latest?.mbps ?? null) : null;
  const current = rateParts(currentMbps, unit);

  const peakMbps = useMemo(() => {
    const values = samples.map((sample) => sample.mbps);
    if (phase === "done" && result) values.push(result.downloadMbps);
    return values.length > 0 ? Math.max(...values) : 0;
  }, [samples, result, phase]);

  const averageMbps = useMemo(() => {
    if (samples.length === 0) return null;
    return samples.reduce((sum, sample) => sum + sample.mbps, 0) / samples.length;
  }, [samples]);

  const series = useMemo(() => samples.map((sample) => toRateUnit(sample.mbps, unit)), [samples, unit]);
  const displayPeak = toRateUnit(peakMbps, unit);
  const hasSeries = samples.length > 0 || (phase === "done" && result !== null);
  const chartMax = hasSeries ? niceCeiling(Math.max(displayPeak, 0.1) * 1.08) : 10;
  const gaugeValue = Math.max(0, toRateUnit(currentMbps ?? 0, unit));

  const downloadedBytes =
    phase === "done" && result ? result.bytesTransferred : running ? (latest?.bytes ?? null) : null;
  const elapsedMs = phase === "done" && result ? result.durationMs : elapsed;
  const serverName = result && result.server.trim() !== "" ? result.server : null;
  const upload = result?.uploadMbps ?? null;
  const uploadText = upload === null ? null : `${rateParts(upload, unit).value} ${RATE_UNIT_LABEL[unit]}`;

  const summary =
    phase === "done" && result
      ? `You downloaded ${bytes(result.bytesTransferred)} in ${secondsLabel(result.durationMs)} from ${TARGET_HOST} at ${rateParts(result.downloadMbps, unit).value} ${RATE_UNIT_LABEL[unit]}.`
      : null;

  const headlineNote =
    phase === "running"
      ? "Live sample while the payload streams from speed.cloudflare.com."
      : phase === "error"
        ? "No result from the last attempt. The backend message is shown above."
        : summary ?? "No transfer yet. Start a test to measure this connection.";

  const meta = PHASE_META[phase];

  return (
    <ToolView
      eyebrow="THROUGHPUT"
      eyebrowTone="success"
      eyebrowHint="speed.cloudflare.com · real transfer"
      title="Speed Test"
      description="Measure download throughput and latency with a real transfer, sampled live as it runs."
      telemetry={[
        {
          label: "Download",
          value: `${current.value} ${current.unit}`,
          tone: "primary",
          icon: <ArrowDownToLine size={14} />,
        },
        {
          label: "Latency",
          value: result && result.latencyMs !== null ? ms(result.latencyMs) : "—",
          tone: "success",
          icon: <Timer size={14} />,
        },
        {
          label: "Upload",
          value: uploadText ?? "not measured",
          tone: uploadText === null ? "neutral" : "tertiary",
          icon: <ArrowUpFromLine size={14} />,
        },
      ]}
      toolbar={
        <>
          <Button
            variant="primary"
            size="md"
            icon={<Play size={13} />}
            loading={running}
            disabled={running}
            onClick={() => start()}
            aria-label={running ? "Speed test in progress" : "Start download speed test"}
            trailing={running ? undefined : <Kbd>⌘↵</Kbd>}
          >
            {running ? `Measuring… ${(elapsed / 1000).toFixed(1)}s` : result ? "Run again" : "Start speed test"}
          </Button>
          <SegmentedControl
            value={unit}
            onChange={setUnit}
            options={UNIT_OPTIONS}
            ariaLabel="Throughput display unit"
          />
          {phase !== "idle" && (
            <Button variant="ghost" icon={<RotateCcw size={12} />} onClick={reset} disabled={running}>
              Reset
            </Button>
          )}
        </>
      }
      status={
        <>
          {running && <span className="font-mono text-[10px] text-outline">cannot be cancelled</span>}
          <Badge tone={meta.tone} dot pulse={running} mono>
            {meta.label}
          </Badge>
        </>
      }
    >
      <p role="status" aria-live="polite" className="sr-only">
        {phase === "running"
          ? "Speed test running"
          : phase === "done" && result
            ? `Speed test complete: ${result.downloadMbps.toFixed(1)} megabits per second down`
            : phase === "error"
              ? "Speed test failed"
              : "Speed test idle"}
      </p>

      {error && (
        <ErrorNotice title="Speed test failed" message={error} onRetry={() => start()} retryLabel="Run again" />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <Card
          aria-label="Download throughput result"
          className="lg:col-span-7 relative overflow-hidden p-3.5 flex flex-col justify-between gap-3"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 w-60 h-60 rounded-full bg-primary/[0.09] blur-3xl"
          />
          <div className="relative flex items-center justify-between gap-2">
            <SectionLabel>Download throughput</SectionLabel>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-outline">
              {TARGET_HOST}
            </span>
          </div>

          <div className="relative flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[54px] xl:text-[58px] leading-[0.95] font-semibold tracking-tight text-on-surface tnum">
                  {current.value}
                </span>
                <span className="font-mono text-[14px] font-semibold text-primary-soft">{current.unit}</span>
              </div>
              <p className="mt-1.5 max-w-[36ch] text-[11.5px] leading-relaxed text-outline">{headlineNote}</p>
            </div>
            <ThroughputGauge
              value={gaugeValue}
              max={chartMax}
              unitLabel={RATE_UNIT_LABEL[unit]}
              caption={phase === "done" ? "final" : running ? "live" : phase === "error" ? "no run" : "idle"}
            />
          </div>

          <dl className="relative grid grid-cols-3 gap-2 rounded-lg border border-white/[0.05] bg-black/25 px-2.5 py-2">
            <div className="min-w-0">
              <dt className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Transferred</dt>
              <dd className="font-mono text-[11.5px] text-on-surface tnum">{bytes(downloadedBytes)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Duration</dt>
              <dd className="font-mono text-[11.5px] text-on-surface tnum">
                {secondsLabel(phase === "running" || phase === "done" ? elapsedMs : null)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Peak</dt>
              <dd className="font-mono text-[11.5px] text-primary-soft tnum">
                {samples.length > 0 ? `${rateParts(peakMbps, unit).value} ${RATE_UNIT_LABEL[unit]}` : "—"}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="lg:col-span-5 flex flex-col gap-2 p-3">
          <SectionLabel
            trailing={
              <Badge tone="neutral" mono>
                {samples.length} samples
              </Badge>
            }
          >
            Run metrics
          </SectionLabel>

          <div className="grid grid-cols-2 gap-2">
            <KpiTile
              label="Latency"
              icon={<Timer size={11} />}
              value={result && result.latencyMs !== null ? ms(result.latencyMs) : "—"}
              tone={result && result.latencyMs !== null ? "text-secondary" : "text-outline"}
              title="Measured on the Cloudflare endpoint when the transfer completes"
            />
            <KpiTile
              label="Jitter"
              icon={<Activity size={11} />}
              value={result && result.jitterMs !== null ? `${result.jitterMs.toFixed(2)} ms` : "—"}
              tone={result && result.jitterMs !== null ? "text-tertiary" : "text-outline"}
              title="Latency variation reported by the backend"
            />
            <KpiTile label="Downloaded" icon={<ArrowDownToLine size={11} />} value={bytes(downloadedBytes)} />
            <KpiTile
              label="Duration"
              icon={<Timer size={11} />}
              value={secondsLabel(phase === "running" || phase === "done" ? elapsedMs : null)}
            />
            <KpiTile
              label="Server"
              icon={<Server size={11} />}
              value={serverName ?? "—"}
              tone={serverName ? "text-on-surface" : "text-outline"}
              className="col-span-2"
              title={serverName ?? undefined}
            />
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">
                <ArrowUpFromLine size={11} />
                Upload throughput
              </span>
              {uploadText === null ? (
                <Badge tone="neutral" mono>
                  not measured
                </Badge>
              ) : (
                <span className="font-mono text-[12px] font-semibold text-tertiary tnum">{uploadText}</span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-outline">
              {uploadText === null
                ? "The backend runs a download transfer only, so upload is reported as not measured — never as 0."
                : "Upload throughput as reported by the backend."}
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <Card className="lg:col-span-7 flex flex-col overflow-hidden">
          <CardHeader
            title="Live throughput"
            hint="Samples arrive roughly every 250 ms while the download runs"
            icon={<Activity size={13} />}
            actions={
              <>
                <Badge tone="primary" mono>
                  {current.value} {current.unit}
                </Badge>
                <Badge tone="neutral" mono>
                  {samples.length} pts
                </Badge>
              </>
            }
          />
          <div className="flex-1 p-3">
            {series.length === 0 ? (
              <div className="flex h-[168px] items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-black/20">
                <EmptyState
                  compact
                  icon={running ? <Spinner /> : <Waves size={16} />}
                  title={running ? "Waiting for the first sample" : "No throughput samples yet"}
                  description={
                    running
                      ? "The payload is streaming; the first 250 ms bucket lands shortly."
                      : "Start a test to plot the download curve from real samples."
                  }
                  action={
                    running ? undefined : (
                      <Button size="sm" icon={<Play size={12} />} onClick={() => start()} disabled={running}>
                        Start speed test
                      </Button>
                    )
                  }
                />
              </div>
            ) : (
              <ThroughputChart
                values={series}
                max={chartMax}
                unitLabel={RATE_UNIT_LABEL[unit]}
                height={168}
                ariaLabel={`Download throughput over time, ${samples.length} samples, peak ${rateParts(peakMbps, unit).value} ${RATE_UNIT_LABEL[unit]}`}
              />
            )}
            <div className="mt-1.5 flex items-center justify-between font-mono text-[9.5px] text-outline/80 tnum">
              <span>0.0s</span>
              <span className="flex items-center gap-1.5">
                {running && <span className="h-1.5 w-1.5 rounded-full bg-primary beacon" aria-hidden />}
                {samples.length > 0 && averageMbps !== null
                  ? `avg ${rateParts(averageMbps, unit).value} ${RATE_UNIT_LABEL[unit]}`
                  : "no series"}
              </span>
              <span>{secondsLabel(phase === "running" || phase === "done" ? elapsedMs : null)} elapsed</span>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-5 flex flex-col gap-2.5 p-3">
          <SectionLabel
            trailing={
              <Badge tone="success" mono>
                anycast
              </Badge>
            }
          >
            Target endpoint
          </SectionLabel>

          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.05] text-primary-soft">
              <Cloud size={16} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium text-on-surface">{TARGET_HOST}</div>
              <div className="truncate font-mono text-[10px] text-outline">
                {serverName ?? "edge node reported after the run"}
              </div>
            </div>
          </div>

          <dl className="space-y-1">
            <DetailRow label="Transfer">HTTPS download</DetailRow>
            <DetailRow label="Sampling">~250 ms live</DetailRow>
            <DetailRow label="Expected">10–15 s</DetailRow>
            <DetailRow label="Upload">not measured</DetailRow>
          </dl>

          <InfoNotice icon={<AlertTriangle size={12} />} tone="warning" className="mt-auto">
            A run cannot be cancelled once it starts. The backend either finishes the transfer or fails, so the Start
            button stays disabled until it returns.
          </InfoNotice>
        </Card>
      </div>
    </ToolView>
  );
}
