import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bookmark,
  Download,
  Globe,
  Plus,
  Send,
  ShieldAlert,
  Terminal,
  Zap,
} from "lucide-react";
import { clsx } from "clsx";
import { ToolView, Workbench } from "@/components/layout/ToolView";
import { Badge, Dot } from "@/components/ui/Badge";
import { Button, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { Field, Input, Switch } from "@/components/ui/Form";
import { InfoNotice } from "@/components/ui/Feedback";
import { ConfirmDialog } from "@/components/ui/Modal";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { testing } from "@/lib/api";
import { errorMessage, isTauri } from "@/lib/ipc";
import { bytes, ms } from "@/lib/format";
import type { ApiHistoryEntry, ApiRequestSpec, ApiResponseData } from "@/lib/types";
import { MethodSelect } from "./components/MethodSelect";
import { HeadersEditor } from "./components/HeadersEditor";
import { BodyEditor } from "./components/BodyEditor";
import { AuthEditor } from "./components/AuthEditor";
import { HistoryRail } from "./components/HistoryRail";
import { ResponsePanel } from "./components/ResponsePanel";
import {
  blankSpec,
  clampTimeout,
  curlCommand,
  draftFromSpec,
  formatJson,
  sameRequest,
  sanitizeSpec,
  specFromDraft,
  statusTone,
  statusText,
  urlName,
  validateJson,
  type Draft,
} from "./lib/request";
import { loadDraft, loadHistory, newEntryId, saveDraft, saveHistory } from "./lib/storage";

type RequestTab = "headers" | "body" | "auth" | "options";

type PendingDelete = { kind: "one"; entry: ApiHistoryEntry } | { kind: "all" } | null;

export default function ApiTesterView() {
  const [form, setForm] = useState<Draft>(() => draftFromSpec(loadDraft() ?? blankSpec()));
  const formRef = useRef(form);
  formRef.current = form;

  const [history, setHistory] = useState<ApiHistoryEntry[]>(() => loadHistory());
  const historyRef = useRef(history);
  historyRef.current = history;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [requestTab, setRequestTab] = useState<RequestTab>("headers");
  const [urlInvalid, setUrlInvalid] = useState(false);
  const [revealSecret, setRevealSecret] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  const spec = useMemo(() => specFromDraft(form), [form]);
  const activeHeaders = spec.headers.length;
  const bodyBytes = useMemo(() => (form.body.length === 0 ? 0 : new TextEncoder().encode(form.body).length), [form.body]);
  const jsonIssue = useMemo(
    () => (form.bodyKind === "json" ? validateJson(form.body) : null),
    [form.bodyKind, form.body],
  );

  /* Restore-on-reopen: the draft is written on every edit, minus the secrets. */
  useEffect(() => {
    saveDraft(sanitizeSpec(spec));
  }, [spec]);

  const patch = useCallback((next: Partial<Draft>) => {
    setForm((prev) => ({ ...prev, ...next }));
  }, []);

  const patchAuth = useCallback((next: Partial<Draft["auth"]>) => {
    setForm((prev) => ({ ...prev, auth: { ...prev.auth, ...next } }));
  }, []);

  const upsertHistory = useCallback((nextSpec: ApiRequestSpec, status?: number | null) => {
    if (!nextSpec.url) return;
    const existing = historyRef.current.find((entry) => sameRequest(entry.spec, nextSpec));
    const entry: ApiHistoryEntry = {
      id: existing?.id ?? newEntryId(),
      name: urlName(nextSpec.url),
      spec: sanitizeSpec(nextSpec),
      createdAt: new Date().toISOString(),
      lastStatus: status === undefined ? (existing?.lastStatus ?? null) : status,
    };
    const next = [entry, ...historyRef.current.filter((item) => item.id !== entry.id)].slice(0, 50);
    historyRef.current = next;
    setHistory(next);
    saveHistory(next);
    setActiveId(entry.id);
  }, []);

  const send = useCallback(async () => {
    if (loadingRef.current) return;
    const target = specFromDraft(formRef.current);
    if (!target.url) {
      setUrlInvalid(true);
      toast.warning("URL required", "Enter an absolute URL, e.g. https://httpbin.org/get");
      return;
    }
    setUrlInvalid(false);
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setResponse(null);
    setAnnounce(`Dispatching ${target.method} ${target.url}`);
    try {
      const data = await testing.send(target);
      setResponse(data);
      setAnnounce(`Response ${statusText(data.status, data.statusText)} in ${ms(data.durationMs, 0)}`);
      upsertHistory(target, data.status);
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      setResponse(null);
      setAnnounce(`Request failed: ${message}`);
      toast.error("Request failed", message);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [upsertHistory]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void send();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  const newRequest = () => {
    setForm(draftFromSpec(blankSpec()));
    setResponse(null);
    setError(null);
    setUrlInvalid(false);
    setRevealSecret(false);
    setActiveId(null);
    setRequestTab("headers");
    setAnnounce("New blank request");
  };

  const saveCurrent = () => {
    if (!spec.url) {
      setUrlInvalid(true);
      toast.warning("Nothing to save", "Give the request a URL first.");
      return;
    }
    upsertHistory(spec);
    toast.success("Request saved", `${spec.method} ${urlName(spec.url)}`);
  };

  const copyCurl = () => {
    if (!spec.url) return;
    void navigator.clipboard
      .writeText(curlCommand(spec))
      .then(() => toast.success("cURL copied", `${spec.method} ${urlName(spec.url)}`))
      .catch(() => toast.error("Clipboard unavailable", "The system refused write access."));
  };

  const formatBody = () => {
    const result = formatJson(form.body);
    if (!result.ok) {
      toast.error("Cannot format invalid JSON", result.message);
      return;
    }
    patch({ body: result.value });
    toast.success("JSON formatted", "Indentation normalised to two spaces.");
  };

  const loadEntry = (entry: ApiHistoryEntry) => {
    setForm(draftFromSpec(entry.spec));
    setActiveId(entry.id);
    setResponse(null);
    setError(null);
    setUrlInvalid(false);
    setRevealSecret(false);
    setAnnounce(`Loaded ${entry.spec.method} ${entry.name}`);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "all") {
      historyRef.current = [];
      setHistory([]);
      saveHistory([]);
      setActiveId(null);
      toast.success("History cleared", "Draft stays in the composer.");
    } else {
      const next = historyRef.current.filter((entry) => entry.id !== pendingDelete.entry.id);
      historyRef.current = next;
      setHistory(next);
      saveHistory(next);
      if (activeId === pendingDelete.entry.id) setActiveId(null);
      toast.success("Removed from history", pendingDelete.entry.name);
    }
    setPendingDelete(null);
  };

  const requestTabs: TabItem<RequestTab>[] = [
    { value: "headers", label: "Headers", count: activeHeaders },
    {
      value: "body",
      label: "Body",
      icon: form.bodyKind !== "none" ? <Dot tone="primary" /> : undefined,
    },
    {
      value: "auth",
      label: "Auth",
      icon: form.auth.kind !== "none" ? <Dot tone="success" /> : undefined,
    },
    { value: "options", label: "Options" },
  ];

  return (
    <ToolView
      eyebrow="HTTP CLIENT"
      eyebrowTone="primary"
      eyebrowHint="REQWEST CORE · LOCAL"
      title="API Tester"
      description="Compose HTTP requests with headers, auth, and body, then inspect status, timing, and payload."
      telemetry={[
        {
          label: "Last status",
          value: response ? response.statusText || String(response.status) : "—",
          tone: statusTone(response?.status ?? null),
          icon: <Activity size={14} />,
        },
        {
          label: "Latency",
          value: response ? ms(response.durationMs, 0) : "—",
          tone: "primary",
          icon: <Zap size={14} />,
        },
        {
          label: "Payload",
          value: response ? bytes(response.bodyBytes) : "—",
          tone: "neutral",
          icon: <Download size={14} />,
        },
        {
          label: "History",
          value: `${history.length}`,
          tone: "neutral",
          icon: <Bookmark size={14} />,
        },
      ]}
      toolbar={
        <>
          <Button icon={<Plus size={13} />} onClick={newRequest}>
            New request
          </Button>
          <Button icon={<Bookmark size={13} />} onClick={saveCurrent} disabled={!spec.url}>
            Save request
          </Button>
          <Button icon={<Terminal size={13} />} onClick={copyCurl} disabled={!spec.url}>
            Copy cURL
          </Button>
        </>
      }
      status={
        <>
          <Badge tone={isTauri ? "success" : "warning"} dot>
            {isTauri ? "Native core" : "Browser preview"}
          </Badge>
          <Badge tone={form.insecure ? "warning" : "neutral"} mono>
            {form.insecure ? "TLS verify off" : "TLS verify on"}
          </Badge>
        </>
      }
    >
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      <Workbench
        sidebarWidth={260}
        sidebar={
          <>
            <HistoryRail
              entries={history}
              activeId={activeId}
              onLoad={loadEntry}
              onDelete={(entry) => setPendingDelete({ kind: "one", entry })}
              onClear={() => setPendingDelete({ kind: "all" })}
            />

            <Card className="shrink-0 p-2.5 space-y-2">
              <SectionLabel
                trailing={
                  <span className="font-mono text-[10px] text-outline">
                    {form.method}
                  </span>
                }
              >
                Draft
              </SectionLabel>
              <div className="space-y-1 font-mono text-[10px] text-outline">
                <div className="flex items-baseline justify-between gap-2">
                  <span>host</span>
                  <span className="truncate text-on-variant">{hostOf(form.url)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span>headers</span>
                  <span className="text-on-variant tnum">{activeHeaders}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span>body</span>
                  <span className="text-on-variant">
                    {form.bodyKind} · {bytes(bodyBytes)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span>auth</span>
                  <span className={clsx("text-on-variant", form.auth.kind !== "none" && "text-secondary")}>
                    {form.auth.kind}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span>timeout</span>
                  <span className="text-on-variant tnum">{form.timeoutMs} ms</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="xs" variant="ghost" block icon={<Bookmark size={11} />} onClick={saveCurrent} disabled={!spec.url}>
                  Save to history
                </Button>
              </div>
            </Card>
          </>
        }
      >
        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
          <div className="grid grid-cols-1 xl:grid-cols-2 items-start gap-3">
            {/* ---------------------------- Request builder ---------------------------- */}
            <Card className="flex flex-col overflow-hidden min-h-[440px]">
              <CardHeader
                title="Request"
                hint={`${form.method} ${form.url ? urlName(form.url) : "untitled request"}`}
                icon={<Terminal size={13} />}
                actions={
                  <>
                    <Badge tone="neutral" mono>
                      {activeHeaders} hdr
                    </Badge>
                    <Badge tone={jsonIssue?.ok === false ? "error" : "neutral"} mono>
                      {form.bodyKind}
                    </Badge>
                  </>
                }
              />

              <div className="px-2.5 py-2 space-y-1.5 border-b border-white/[0.055] bg-white/[0.015]">
                <div className="flex items-center gap-1.5">
                  <MethodSelect
                    value={form.method}
                    onChange={(method) => patch({ method })}
                    disabled={loading}
                    className="w-[100px]"
                  />
                  <div className="flex-1 min-w-0">
                    <Input
                      mono
                      value={form.url}
                      onChange={(e) => {
                        setUrlInvalid(false);
                        patch({ url: e.target.value });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      placeholder="https://api.example.com/v1/resource"
                      aria-label="Request URL"
                      invalid={urlInvalid}
                      leading={<Globe size={11} />}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="md"
                    icon={<Send size={13} />}
                    loading={loading}
                    onClick={() => void send()}
                    trailing={<Kbd>⌘↵</Kbd>}
                    aria-label="Send request"
                  >
                    Send
                  </Button>
                </div>
                {urlInvalid && (
                  <p role="alert" className="text-[10.5px] text-error">
                    A URL is required before dispatch. Absolute URLs only — the core normalises a missing scheme.
                  </p>
                )}
              </div>

              <div className="px-2">
                <Tabs
                  value={requestTab}
                  onChange={setRequestTab}
                  items={requestTabs}
                  ariaLabel="Request configuration"
                />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
                {requestTab === "headers" && (
                  <HeadersEditor rows={form.headers} onChange={(headers) => patch({ headers })} />
                )}

                {requestTab === "body" && (
                  <BodyEditor
                    kind={form.bodyKind}
                    body={form.body}
                    issue={jsonIssue}
                    onKindChange={(bodyKind) => patch({ bodyKind })}
                    onBodyChange={(body) => patch({ body })}
                    onFormat={formatBody}
                    onClear={() => patch({ body: "" })}
                  />
                )}

                {requestTab === "auth" && (
                  <AuthEditor
                    auth={form.auth}
                    reveal={revealSecret}
                    onPatch={patchAuth}
                    onRevealChange={setRevealSecret}
                  />
                )}

                {requestTab === "options" && (
                  <div className="space-y-2.5">
                    <SectionLabel
                      trailing={
                        <span className="font-mono text-[10px] text-outline tnum">{form.timeoutMs} ms</span>
                      }
                    >
                      Dispatch options
                    </SectionLabel>

                    <Field label="Timeout (ms)" hint="Clamped to 1 000 – 600 000 ms by the Rust core.">
                      <Input
                        mono
                        sizeVariant="sm"
                        type="number"
                        min={1000}
                        max={600000}
                        step={1000}
                        value={form.timeoutMs}
                        aria-label="Request timeout in milliseconds"
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          patch({ timeoutMs: Number.isFinite(next) ? next : 0 });
                        }}
                        onBlur={() => patch({ timeoutMs: clampTimeout(form.timeoutMs) })}
                      />
                    </Field>

                    <div className="rounded-lg bg-black/25 border border-white/[0.055] divide-y divide-white/[0.045]">
                      <div className="flex items-start justify-between gap-3 px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="text-[11.5px] text-on-surface">Follow redirects</p>
                          <p className="text-[10px] leading-tight text-outline">
                            A 3xx is followed and the final URL is reported back.
                          </p>
                        </div>
                        <Switch
                          checked={form.followRedirects}
                          onChange={(followRedirects) => patch({ followRedirects })}
                          label="Follow redirects"
                          size="sm"
                        />
                      </div>
                      <div className="flex items-start justify-between gap-3 px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="text-[11.5px] text-on-surface">Allow insecure TLS</p>
                          <p className="text-[10px] leading-tight text-outline">
                            Skips certificate verification for this request only.
                          </p>
                        </div>
                        <Switch
                          checked={form.insecure}
                          onChange={(insecure) => patch({ insecure })}
                          label="Allow insecure TLS"
                          size="sm"
                        />
                      </div>
                    </div>

                    {form.insecure && (
                      <InfoNotice icon={<ShieldAlert size={12} />} tone="warning">
                        Certificate verification is off. Only use this against localhost or a host you control.
                      </InfoNotice>
                    )}

                    <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2 font-mono text-[10px] text-outline space-y-1">
                      <div className="flex justify-between gap-3">
                        <span>method</span>
                        <span className="text-on-variant">{form.method}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>body</span>
                        <span className="text-on-variant">
                          {form.bodyKind} · {bodyBytes} B
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>auth</span>
                        <span className="text-on-variant">{form.auth.kind}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>content-type</span>
                        <span className="text-on-variant truncate">{inferredContentType(form.bodyKind)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* ------------------------------- Inspector ------------------------------- */}
            <ResponsePanel response={response} loading={loading} error={error} spec={spec} onSend={() => void send()} />
          </div>
        </div>
      </Workbench>

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        title={pendingDelete?.kind === "all" ? "Clear the entire request history?" : "Delete this request?"}
        message={
          pendingDelete?.kind === "all"
            ? `All ${history.length} saved requests are removed from this machine's localStorage. The current draft in the composer is kept.`
            : "The entry is removed from the local history list. The request currently in the composer is untouched."
        }
        confirmLabel={pendingDelete?.kind === "all" ? "Clear history" : "Delete entry"}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        detail={
          pendingDelete?.kind === "one" ? (
            <div className="rounded-lg border border-white/[0.07] bg-black/35 px-2.5 py-2 font-mono text-[10.5px]">
              <div className="text-on-surface">
                <span className="font-bold">{pendingDelete.entry.spec.method}</span> {pendingDelete.entry.name}
              </div>
              <div className="mt-0.5 text-outline truncate">{pendingDelete.entry.spec.url}</div>
            </div>
          ) : undefined
        }
      />
    </ToolView>
  );
}

/** Host only, for the draft summary card. */
function hostOf(url: string): string {
  const raw = url.trim();
  if (!raw) return "—";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).host || "—";
  } catch {
    return "—";
  }
}

function inferredContentType(kind: string): string {
  switch (kind) {
    case "json":
      return "application/json";
    case "urlencoded":
      return "application/x-www-form-urlencoded";
    case "form":
      return "multipart/form-data";
    case "text":
      return "text/plain";
    default:
      return "none";
  }
}
