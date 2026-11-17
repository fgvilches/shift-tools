import { useCallback, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CornerDownRight,
  Gauge,
  Info,
  Link2,
  ListChecks,
  ScanLine,
  ShieldCheck,
  ShieldQuestion,
  Timer,
  XCircle,
} from "lucide-react";
import { clsx } from "clsx";
import { ToolView } from "@/components/layout/ToolView";
import { Badge } from "@/components/ui/Badge";
import { Button, Kbd } from "@/components/ui/Button";
import { Card, SectionLabel, StatTile } from "@/components/ui/Card";
import { Input, Switch } from "@/components/ui/Form";
import { ErrorNotice, Progress, Skeleton, Spinner } from "@/components/ui/Feedback";
import { ScoreRing } from "@/components/ui/Charts";
import { security } from "@/lib/api";
import { errorMessage } from "@/lib/ipc";
import { ms, plural, relative } from "@/lib/format";
import type { HeaderAnalysis } from "@/lib/types";
import {
  GROUP_HINT,
  GROUP_ORDER,
  cookieIssues,
  gradeDescriptor,
  gradeTone,
  statusText,
  statusTone,
  summarize,
  type GradeTone,
} from "./lib/analysis";
import { FindingsMatrix } from "./components/FindingsMatrix";
import { CookieAudit } from "./components/CookieAudit";
import { RawHeaders } from "./components/RawHeaders";

const TONE_TEXT: Record<GradeTone, string> = {
  success: "text-secondary",
  warning: "text-warning",
  error: "text-error",
  neutral: "text-on-surface",
};

const TONE_HALO: Record<GradeTone, string> = {
  success: "bg-secondary/10",
  warning: "bg-warning/10",
  error: "bg-error/10",
  neutral: "bg-primary/[0.07]",
};

const EXAMPLE_URL = "https://api.github.com";

export default function HeaderAnalyzerView() {
  const [url, setUrl] = useState("");
  const [followRedirects, setFollowRedirects] = useState(true);
  const [analysis, setAnalysis] = useState<HeaderAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<{ target: string; follow: boolean } | null>(null);

  const runAnalysis = useCallback(async (target: string, follow: boolean) => {
    const trimmed = target.trim();
    if (!trimmed) {
      setError("Enter a URL to analyze — for example https://api.github.com.");
      return;
    }
    setLastRequest({ target: trimmed, follow });
    setLoading(true);
    setError(null);
    try {
      const result = await security.headers(trimmed, follow);
      setAnalysis(result);
      setUrl(result.url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAnalysis(url, followRedirects);
  };

  const summary = useMemo(() => summarize(analysis?.findings ?? []), [analysis]);
  const weakCookies = useMemo(() => cookieIssues(analysis?.cookies ?? []), [analysis]);
  const tone: GradeTone = analysis ? gradeTone(analysis.grade) : "neutral";

  const summarySentence = useMemo(() => {
    if (!analysis) return "";
    const parts = [
      `${summary.pass} of ${summary.total} checks fully hardened`,
      summary.warn > 0 ? `${summary.warn} partial` : "",
      summary.fail > 0 ? `${summary.fail} missing` : "",
    ].filter(Boolean);
    let sentence = `${parts.join(", ")}.`;
    if (analysis.cookies.length === 0) {
      sentence += " No Set-Cookie headers were sent.";
    } else if (weakCookies > 0) {
      sentence += ` ${weakCookies} of ${plural(analysis.cookies.length, "cookie")} ${
        weakCookies === 1 ? "carries" : "carry"
      } weak flags.`;
    } else {
      sentence += ` All ${plural(analysis.cookies.length, "cookie")} look clean.`;
    }
    return sentence;
  }, [analysis, summary, weakCookies]);

  return (
    <ToolView
      eyebrow="SECURITY POSTURE"
      eyebrowTone="warning"
      eyebrowHint="HTTP RESPONSE HARDENING"
      title="Header Analyzer"
      description="Grade HTTP security headers, CSP, CORS, and cookie flags with concrete recommendations."
      telemetry={[
        {
          label: "Grade",
          value: analysis ? analysis.grade : "—",
          tone: analysis ? tone : "neutral",
          icon: <ShieldCheck size={14} />,
        },
        {
          label: "Score",
          value: analysis ? `${analysis.score}/100` : "—",
          tone: analysis ? tone : "neutral",
          icon: <Gauge size={14} />,
        },
        {
          label: "Checks",
          value: analysis ? `${summary.pass}/${summary.total}` : "—",
          tone: analysis ? (summary.fail > 0 ? "error" : summary.warn > 0 ? "warning" : "success") : "neutral",
          icon: <ListChecks size={14} />,
        },
        {
          label: "Latency",
          value: analysis ? ms(analysis.durationMs) : "—",
          tone: "neutral",
          icon: <Timer size={14} />,
        },
      ]}
      toolbar={
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="w-[300px] sm:w-[360px] xl:w-[420px]">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://domain.com/path"
              aria-label="Target URL"
              leading={<Link2 size={11} />}
              sizeVariant="sm"
              mono
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-on-variant whitespace-nowrap">
            Follow redirects
            <Switch checked={followRedirects} onChange={setFollowRedirects} label="Follow redirects" size="sm" />
          </span>
          <Button
            type="submit"
            variant="primary"
            icon={<ScanLine size={13} />}
            loading={loading}
            disabled={!url.trim()}
            trailing={<Kbd>↵</Kbd>}
          >
            Analyze headers
          </Button>
        </form>
      }
      status={
        <>
          {analysis && (
            <Badge tone={tone} mono>
              {analysis.grade} · {analysis.score}/100
            </Badge>
          )}
          {analysis && (
            <span className="hidden sm:inline font-mono text-[10px] text-outline">{relative(analysis.fetchedAt)}</span>
          )}
          {loading && (
            <Badge tone="primary" dot pulse>
              Analyzing
            </Badge>
          )}
          {!analysis && !loading && !error && (
            <Badge tone="neutral" dot>
              idle
            </Badge>
          )}
        </>
      }
    >
      {error && (
        <ErrorNotice
          title={analysis ? "Analysis failed — showing the previous result" : "Header analysis failed"}
          message={error}
          onRetry={lastRequest ? () => void runAnalysis(lastRequest.target, lastRequest.follow) : undefined}
          retryLabel="Retry"
        />
      )}

      {!analysis && loading && (
        <Card className="p-4 space-y-3" aria-busy>
          <div className="flex items-center gap-2 min-w-0 text-[12px] text-on-variant">
            <Spinner size={14} />
            <span className="truncate">
              Requesting <span className="font-mono text-on-surface">{url.trim() || lastRequest?.target}</span> — grading
              transport, CSP, cookies…
            </span>
          </div>
          <Progress indeterminate label="Analyzing response headers" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-10" />
        </Card>
      )}

      {!analysis && !loading && (
        <Card className="p-4">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-5 items-center">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-primary-soft shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <ShieldQuestion size={18} />
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="text-[13px] font-medium text-on-surface">No target analyzed yet</div>
                <p className="text-[11.5px] leading-relaxed text-outline max-w-sm">
                  Point the analyzer at an HTTPS endpoint. Every grade is computed from the live response — headers,
                  redirects and Set-Cookie flags, never from a template.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    icon={<ScanLine size={13} />}
                    onClick={() => {
                      setUrl(EXAMPLE_URL);
                      void runAnalysis(EXAMPLE_URL, followRedirects);
                    }}
                  >
                    Analyze {EXAMPLE_URL}
                  </Button>
                  <span className="font-mono text-[9.5px] text-outline">GET only · TLS verified · 15s timeout</span>
                </div>
              </div>
            </div>
            <div>
              <SectionLabel className="mb-1.5" trailing={<span className="font-mono text-[9px] text-outline">8 groups</span>}>
                Checks applied to every response
              </SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {GROUP_ORDER.map((group) => (
                  <div key={group} className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-on-variant">{group}</div>
                    <div className="text-[10px] text-outline leading-snug mt-0.5">{GROUP_HINT[group]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {analysis && (
        <>
          <Card className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2">
            <Badge tone={statusTone(analysis.status)} mono dot>
              HTTP {analysis.status}
              {statusText(analysis.status) ? ` ${statusText(analysis.status)}` : ""}
            </Badge>
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <CornerDownRight size={11} className="shrink-0 text-outline" aria-hidden />
              <span className="font-mono text-[11px] text-on-surface truncate" title={analysis.finalUrl}>
                {analysis.finalUrl}
              </span>
              {analysis.finalUrl.replace(/\/$/, "") !== analysis.url.replace(/\/$/, "") && (
                <Badge tone="primary" className="shrink-0">
                  redirected
                </Badge>
              )}
            </div>
            <span className="shrink-0 font-mono text-[10px] text-outline" title={analysis.fetchedAt}>
              {ms(analysis.durationMs)} · fetched {relative(analysis.fetchedAt)}
            </span>
          </Card>

          <Card className="relative overflow-hidden p-4">
            <div
              aria-hidden
              className={clsx(
                "pointer-events-none absolute -right-16 -top-20 w-56 h-56 rounded-full blur-3xl",
                TONE_HALO[tone],
              )}
            />
            <div className="relative flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex items-center gap-4 min-w-0 lg:flex-1">
                <div role="img" aria-label={`Security score ${analysis.score} out of 100`} className="shrink-0">
                  <ScoreRing
                    value={analysis.score}
                    tone={tone}
                    size={92}
                    label={String(analysis.score)}
                    sublabel="/ 100"
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <SectionLabel
                    trailing={<span className="font-mono text-[9.5px] text-outline">{plural(summary.total, "check")}</span>}
                  >
                    Overall security grade
                  </SectionLabel>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span
                      className={clsx(
                        "font-mono text-[26px] leading-8 font-semibold tracking-tight",
                        TONE_TEXT[tone],
                      )}
                    >
                      {analysis.grade}
                    </span>
                    <Badge tone={tone}>{gradeDescriptor(analysis.score)}</Badge>
                  </div>
                  <p className="text-[11.5px] leading-snug text-on-variant/85 max-w-lg">{summarySentence}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 shrink-0 lg:w-[420px]">
                <StatTile label="Passed" value={summary.pass} tone="success" icon={<CheckCircle2 size={14} />} />
                <StatTile label="Warnings" value={summary.warn} tone="warning" icon={<AlertTriangle size={14} />} />
                <StatTile label="Missing" value={summary.fail} tone="error" icon={<XCircle size={14} />} />
                <StatTile label="Info" value={summary.info} tone="primary" icon={<Info size={14} />} />
              </div>
            </div>
          </Card>

          <FindingsMatrix analysis={analysis} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            <CookieAudit cookies={analysis.cookies} />
            <RawHeaders headers={analysis.rawHeaders} />
          </div>
        </>
      )}
    </ToolView>
  );
}
