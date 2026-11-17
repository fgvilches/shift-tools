import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  Download,
  Radio,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { clsx } from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CodeArea, CopyButton } from "@/components/ui/CodeArea";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { EmptyState, ErrorNotice, InfoNotice, Progress, Skeleton } from "@/components/ui/Feedback";
import { toast } from "@/components/ui/Toast";
import type { ApiRequestSpec, ApiResponseData } from "@/lib/types";
import { bytes, ms } from "@/lib/format";
import { bodyExtension, displayBody, isJsonResponse, statusText, statusTone } from "../lib/request";

type ResponseTab = "body" | "headers" | "raw";

function saveBodyToFile(response: ApiResponseData, text: string) {
  const name = `response-${response.status}-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.${bodyExtension(response)}`;
  const blob = new Blob([text], { type: response.contentType ?? "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast.info("Download started", name);
}

function Metric({ label, value, tone, title }: { label: string; value: string; tone?: string; title?: string }) {
  return (
    <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2 py-1.5 min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</div>
      <div className={clsx("font-mono text-[12px] font-semibold tnum truncate", tone ?? "text-on-surface")} title={title}>
        {value}
      </div>
    </div>
  );
}

export function ResponsePanel({
  response,
  loading,
  error,
  spec,
  onSend,
}: {
  response: ApiResponseData | null;
  loading: boolean;
  error: string | null;
  spec: ApiRequestSpec;
  onSend: () => void;
}) {
  const [tab, setTab] = useState<ResponseTab>("body");

  useEffect(() => {
    if (response) setTab("body");
  }, [response]);

  const pretty = useMemo(() => (response ? displayBody(response) : ""), [response]);
  const json = response ? isJsonResponse(response) : false;

  const tabs: TabItem<ResponseTab>[] = [
    { value: "body", label: "Body" },
    { value: "headers", label: "Headers", count: response?.headers.length },
    { value: "raw", label: "Raw" },
  ];

  const tone = statusTone(response?.status ?? null);
  const toneClass = {
    neutral: "text-on-variant",
    primary: "text-primary-soft",
    success: "text-secondary",
    warning: "text-warning",
    error: "text-error",
    tertiary: "text-tertiary",
  }[tone];

  return (
    <Card className="flex flex-col overflow-hidden min-h-[460px]">
      <CardHeader
        title="Response"
        hint={response ? statusText(response.status, response.statusText) : loading ? "dispatching…" : "no response yet"}
        icon={<Activity size={13} />}
        actions={
          <>
            <CopyButton text={pretty} label="Copy body" disabled={!response} />
            <IconButton
              size="sm"
              label="Save response body as file"
              icon={<Download size={13} />}
              disabled={!response}
              onClick={() => {
                if (response) saveBodyToFile(response, pretty);
              }}
            />
            <IconButton
              size="sm"
              label="Send the request again"
              icon={<RefreshCw size={13} />}
              disabled={loading}
              onClick={onSend}
            />
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 px-2.5 py-2 border-b border-white/[0.055] bg-white/[0.015]">
        <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2 py-1.5 min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Status</div>
          {response ? (
            <Badge
              tone={tone}
              mono
              title={statusText(response.status, response.statusText)}
              className="mt-0.5 max-w-full"
            >
              {response.status}
            </Badge>
          ) : (
            <div className="font-mono text-[12px] text-outline">—</div>
          )}
        </div>
        <Metric label="Latency" value={response ? ms(response.durationMs, 0) : "—"} tone="text-primary-soft" />
        <Metric label="Payload" value={response ? bytes(response.bodyBytes) : "—"} />
        <Metric
          label="Content type"
          value={response?.contentType ?? "—"}
          title={response?.contentType ?? undefined}
          tone="text-tertiary"
        />
      </div>

      {response && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-white/[0.055] font-mono text-[10px] text-outline">
          {response.redirected ? (
            <Badge tone="primary" mono dot>
              redirected
            </Badge>
          ) : (
            <Badge tone="neutral" mono>
              direct
            </Badge>
          )}
          <span className="truncate min-w-0 flex-1" title={response.finalUrl}>
            {response.redirected ? "final: " : "url: "}
            <span className="text-on-variant">{response.finalUrl}</span>
          </span>
          {response.truncated && (
            <Badge tone="warning" mono>
              truncated
            </Badge>
          )}
        </div>
      )}

      <Tabs value={tab} onChange={setTab} items={tabs} ariaLabel="Response inspector" className="px-2" />

      <div className="flex-1 min-h-0 flex flex-col p-2.5">
        {loading && (
          <div className="flex-1 flex flex-col gap-2" aria-busy="true">
            <div className="flex items-center gap-2 text-[11px] text-on-variant">
              <RefreshCw size={12} className="animate-spin" aria-hidden />
              <span className="font-mono text-[10.5px] text-outline truncate">
                {spec.method} {spec.url || "—"}
              </span>
            </div>
            <Progress indeterminate label="Waiting for the response" />
            <div className="mt-1 space-y-1.5">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="flex-1 flex flex-col justify-center">
            <ErrorNotice title="Request failed" message={error} onRetry={onSend} retryLabel="Send again" />
            <p className="mt-2 text-[10.5px] leading-relaxed text-outline">
              The Rust core reported the failure verbatim. Check DNS, TLS, the timeout budget, or whether the host is
              reachable from this machine.
            </p>
          </div>
        )}

        {!loading && !error && !response && (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<Radio size={16} />}
              title="No response yet"
              description="Send the request to inspect status, timing, headers and the payload that actually came back."
              action={
                <Button variant="primary" size="sm" icon={<ArrowRightLeft size={12} />} onClick={onSend}>
                  Send request
                </Button>
              }
            />
          </div>
        )}

        {!loading && !error && response && tab === "body" && (
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            {response.truncated && (
              <InfoNotice tone="warning" icon={<ScrollText size={12} />}>
                Body exceeded the 2.5 MB capture limit — the tail is not shown. {bytes(response.bodyBytes)} arrived.
              </InfoNotice>
            )}
            <CodeArea
              key={`body-${response.status}-${response.durationMs}`}
              value={pretty}
              readOnly
              minHeight={240}
              ariaLabel="Response body"
              className="flex-1"
              toolbar={
                <>
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-outline">
                    {json ? (
                      <>
                        <CheckCircle2 size={10} className="text-secondary" aria-hidden /> application/json · pretty
                      </>
                    ) : (
                      <>raw text · not JSON</>
                    )}
                  </span>
                  <span className="font-mono text-[10px] text-outline tnum">{bytes(response.bodyBytes)}</span>
                </>
              }
            />
            {!json && response.body.length === 0 && (
              <p className="text-[10.5px] text-outline">Empty body — the server returned no payload for this request.</p>
            )}
          </div>
        )}

        {!loading && !error && response && tab === "raw" && (
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            <CodeArea
              key={`raw-${response.status}-${response.bodyBytes}`}
              value={response.body}
              readOnly
              minHeight={240}
              ariaLabel="Raw response body"
              className="flex-1"
              toolbar={
                <>
                  <span className="font-mono text-[10px] text-outline">unmodified bytes</span>
                  <span className="font-mono text-[10px] text-outline tnum">
                    {response.body.split("\n").length} lines · {bytes(response.bodyBytes)}
                  </span>
                </>
              }
            />
          </div>
        )}

        {!loading && !error && response && tab === "headers" && (
          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/25">
            {response.headers.length === 0 ? (
              <EmptyState compact title="No response headers" description="The server answered without headers." />
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {response.headers.map(([name, value], index) => (
                  <div
                    key={`${name}-${index}`}
                    className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-3 px-2.5 py-1.5 hover:bg-white/[0.03]"
                  >
                    <span className="font-mono text-[10.5px] text-primary-soft truncate" title={name}>
                      {name}
                    </span>
                    <span className="font-mono text-[10.5px] text-on-variant break-all">{value || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={clsx("flex items-center justify-between gap-3 pt-2 font-mono text-[9.5px] text-outline", !response && "hidden")}>
          <span className="truncate">
            {response ? `${response.headers.length} headers · ${response.contentType ?? "unknown content type"}` : ""}
          </span>
          <span className={clsx("shrink-0", toneClass)}>
            {response ? `${response.truncated ? "partial" : "full"} capture · UTF-8` : ""}
          </span>
        </div>
      </div>
    </Card>
  );
}
