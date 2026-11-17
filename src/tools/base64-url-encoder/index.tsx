import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Binary,
  Braces,
  CircleAlert,
  Code,
  Copy,
  Eraser,
  FileJson,
  Fingerprint,
  KeyRound,
  Link2,
  MoveHorizontal,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Button, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { CodeArea } from "@/components/ui/CodeArea";
import { EmptyState, ErrorNotice, InfoNotice } from "@/components/ui/Feedback";
import { Switch } from "@/components/ui/Form";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { bytes, percent, plural } from "@/lib/format";
import {
  countLines,
  detectFormat,
  IDLE_OUTCOME,
  type DetectedFormat,
  type Operation,
  type TextMode,
  transformText,
  type TransformOutcome,
  utf8Length,
} from "./lib/codec";
import {
  evaluateExpiry,
  formatClaimDate,
  numericClaim,
  parseJwt,
  SAMPLE_JWT,
  type ExpiryState,
  type JwtResult,
} from "./lib/jwt";

type Mode = TextMode | "jwt";

const MODE_TABS: TabItem<Mode>[] = [
  { value: "base64", label: "Base64", icon: <Binary size={12} /> },
  { value: "url", label: "URL component", icon: <Link2 size={12} /> },
  { value: "html", label: "HTML entities", icon: <Code size={12} /> },
  { value: "jwt", label: "JWT", icon: <KeyRound size={12} /> },
];

const MODE_TITLES: Record<Mode, string> = {
  base64: "Base64",
  url: "URL component",
  html: "HTML entities",
  jwt: "JWT inspector",
};

const DETECTED: Record<DetectedFormat, { label: string; tone: Tone }> = {
  jwt: { label: "JWT token", tone: "tertiary" },
  base64: { label: "Base64", tone: "primary" },
  base64url: { label: "Base64url", tone: "primary" },
  url: { label: "Percent-encoded", tone: "success" },
  entities: { label: "HTML entities", tone: "warning" },
  text: { label: "Plain text", tone: "neutral" },
};

function transformHint(mode: TextMode, direction: Operation, urlSafe: boolean): string {
  if (mode === "base64") {
    const alphabet = urlSafe ? "base64url" : "base64";
    return direction === "encode" ? `utf-8 → ${alphabet}` : `${alphabet} → utf-8`;
  }
  if (mode === "url") return direction === "encode" ? "text → %XX" : "%XX → text";
  return direction === "encode" ? "text → &entity;" : "&entity; → text";
}

const INPUT_HINTS: Record<Mode, string> = {
  base64: "Both directions share this buffer · whitespace is ignored on decode",
  url: "encodeURIComponent / decodeURIComponent · '+' never becomes a space",
  html: "Escapes & < > \" ' · decodes named and numeric references",
  jwt: "Bearer prefix stripped · signature is never verified",
};

const PLACEHOLDERS: Record<Mode, string> = {
  base64: "Paste text to encode, or a Base64 string to decode…",
  url: "https://api.shift.tools/search?q=café au lait&tags=a,b",
  html: '<a href="/docs?x=1&y=2">Docs & guides</a>',
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzQyIn0.signature",
};

const SAMPLE_TEXT = "Shift-Tools · café — 100% local & offline\nNo network round-trip, no telemetry.";
const SAMPLE_URL = "https://api.shift.tools/v1/search?q=café au lait&tags=a,b&redirect=/home";
const SAMPLE_HTML = `<a href="/docs?x=1&y=2" title='Docs & guides'>Shift-Tools <docs></a>`;

const REGISTERED_CLAIMS = ["iss", "sub", "aud", "exp", "iat", "nbf"] as const;

const CLAIM_ROWS: { key: (typeof REGISTERED_CLAIMS)[number]; label: string; time: boolean }[] = [
  { key: "iss", label: "Issuer", time: false },
  { key: "sub", label: "Subject", time: false },
  { key: "aud", label: "Audience", time: false },
  { key: "exp", label: "Expires", time: true },
  { key: "iat", label: "Issued at", time: true },
  { key: "nbf", label: "Not before", time: true },
];

interface FrozenRun {
  mode: TextMode;
  input: string;
  result: TransformOutcome;
}

type OkJwt = Extract<JwtResult, { ok: true }>;

export default function Base64UrlEncoderView() {
  const [mode, setMode] = useState<Mode>("base64");
  const [input, setInput] = useState("");
  const [direction, setDirection] = useState<Operation>("encode");
  const [urlSafe, setUrlSafe] = useState(false);
  const [live, setLive] = useState(true);
  const [frozen, setFrozen] = useState<FrozenRun | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [wrapOutput, setWrapOutput] = useState(true);

  const textMode: TextMode | null = mode === "jwt" ? null : mode;

  const computed = useMemo(
    () => (textMode === null ? IDLE_OUTCOME : transformText(textMode, input, direction, urlSafe)),
    [textMode, input, direction, urlSafe],
  );

  const result: TransformOutcome =
    mode === "jwt" ? IDLE_OUTCOME : live ? computed : frozen && frozen.mode === mode ? frozen.result : IDLE_OUTCOME;

  const stale = !live && mode !== "jwt" && frozen !== null && frozen.mode === mode && frozen.input !== input;

  const inputBytes = utf8Length(input);
  const detected = DETECTED[detectFormat(input)];

  const jwt = useMemo(() => (mode === "jwt" ? parseJwt(input) : null), [mode, input]);
  const expiry = useMemo<ExpiryState | null>(
    () => (jwt?.ok ? evaluateExpiry(jwt.payload.value, now) : null),
    [jwt, now],
  );

  useEffect(() => {
    if (mode !== "jwt") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [mode]);

  const changeLive = (next: boolean) => {
    setLive(next);
    if (next) {
      setFrozen(null);
      return;
    }
    if (mode !== "jwt") {
      setFrozen({ mode, input, result: transformText(mode, input, direction, urlSafe) });
    }
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    setFrozen(null);
  };

  const run = useCallback(
    (next: Operation) => {
      setDirection(next);
      if (mode === "jwt") {
        setNow(Date.now());
        return;
      }
      if (!live) {
        setFrozen({ mode, input, result: transformText(mode, input, next, urlSafe) });
      }
    },
    [input, live, mode, urlSafe],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      if (mode === "jwt") {
        setNow(Date.now());
        return;
      }
      run(direction);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [direction, mode, run]);

  const swap = () => {
    if (mode === "jwt" || result.status !== "ok" || result.text.length === 0) return;
    const nextDirection: Operation = direction === "encode" ? "decode" : "encode";
    const nextInput = result.text;
    setInput(nextInput);
    setDirection(nextDirection);
    if (!live) {
      setFrozen({ mode, input: nextInput, result: transformText(mode, nextInput, nextDirection, urlSafe) });
    }
  };

  const clear = () => {
    setInput("");
    setFrozen(null);
  };

  const loadSample = () => {
    const sample =
      mode === "base64" ? SAMPLE_TEXT : mode === "url" ? SAMPLE_URL : mode === "html" ? SAMPLE_HTML : SAMPLE_JWT;
    setInput(sample);
    setFrozen(null);
    if (mode !== "jwt") setDirection("encode");
  };

  const copy = useCallback(async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied", `${label} · ${plural(text.length, "character")}`);
    } catch {
      toast.error("Clipboard unavailable", "Select the text in the buffer and copy it manually.");
    }
  }, []);

  const outputText =
    mode === "jwt" ? (jwt?.ok ? jwt.payload.json : "") : result.status === "ok" ? result.text : "";
  const outputBytes = utf8Length(outputText);

  const state: { label: string; tone: Tone } =
    mode === "jwt"
      ? input.trim() === ""
        ? { label: "No token", tone: "neutral" }
        : jwt?.ok
          ? { label: expiry?.label ?? "Parsed", tone: expiry?.tone ?? "success" }
          : { label: "Parse error", tone: "error" }
      : result.status === "error"
        ? { label: "Error", tone: "error" }
        : result.status === "ok"
          ? { label: "Ready", tone: "success" }
          : { label: "Idle", tone: "neutral" };

  const outputTone: Tone = stale
    ? "warning"
    : result.status === "error"
      ? "error"
      : result.status === "ok"
        ? "success"
        : "neutral";

  const modeIcon =
    mode === "base64" ? <Binary size={14} /> : mode === "url" ? <Link2 size={14} /> : mode === "html" ? <Code size={14} /> : <KeyRound size={14} />;

  return (
    <ToolView
      eyebrow="CODEC"
      eyebrowTone="primary"
      eyebrowHint="RFC 4648 · RFC 7519 · CLIENT-SIDE"
      title="Base64 / URL Encoder"
      description="Encode and decode Base64, URL components, HTML entities, and JWT payloads."
      telemetry={[
        { label: "Mode", value: MODE_TITLES[mode], tone: "primary", icon: modeIcon },
        { label: "Input", value: inputBytes > 0 ? bytes(inputBytes) : "—", tone: "neutral", icon: <MoveHorizontal size={14} /> },
        { label: "Output", value: outputText ? bytes(outputBytes) : "—", tone: "tertiary", icon: <Braces size={14} /> },
        {
          label: "State",
          value: state.label,
          tone: state.tone,
          icon: <Dot tone={state.tone} pulse={state.tone === "success"} />,
        },
      ]}
      status={
        <>
          <Badge tone="neutral" mono>
            UTF-8
          </Badge>
          <Badge tone={state.tone} dot>
            {mode === "jwt" && expiry ? `${expiry.label} · ${expiry.detail}` : state.label}
          </Badge>
          <Badge tone="success" dot>
            local only
          </Badge>
        </>
      }
    >
      <Card className="flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 border-b border-white/[0.055] bg-white/[0.02]">
          <Tabs value={mode} onChange={changeMode} items={MODE_TABS} ariaLabel="Encoding mode" className="border-b-0" />
          <div className="flex flex-wrap items-center gap-3">
            {mode === "base64" && (
              <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
                URL-safe
                <Switch
                  checked={urlSafe}
                  onChange={setUrlSafe}
                  label="Use the URL-safe Base64 alphabet (- and _, no padding)"
                  size="sm"
                />
                <span className="font-mono text-[9.5px] text-outline/70">-_</span>
              </span>
            )}
            {mode === "jwt" ? (
              <span className="font-mono text-[10px] text-outline">{plural(input.split(".").length, "segment")}</span>
            ) : (
              <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
                Live
                <Switch checked={live} onChange={changeLive} label="Transform while typing" size="sm" />
              </span>
            )}
            <Button variant="ghost" size="xs" icon={<WandSparkles size={12} />} onClick={loadSample}>
              Load sample
            </Button>
          </div>
        </div>

        <div className="p-2.5">
          {mode === "jwt" ? (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_104px_minmax(0,1fr)] gap-2.5">
              <Pane
                title="Token buffer"
                accent="primary"
                badge={<Badge tone={detected.tone} mono>{detected.label}</Badge>}
                meta={
                  <>
                    <span>{bytes(inputBytes)}</span>
                    <span className="text-white/20">·</span>
                    <span>{plural(countLines(input), "line")}</span>
                  </>
                }
                footer={<span className="truncate">{INPUT_HINTS.jwt}</span>}
              >
                <CodeArea
                  value={input}
                  onChange={setInput}
                  ariaLabel="JWT token input"
                  placeholder={PLACEHOLDERS.jwt}
                  minHeight={300}
                  wrap
                  className="flex-1"
                />
              </Pane>

              <div className="flex flex-col justify-center gap-1.5 py-1">
                <span className="hidden lg:block text-center font-mono text-[9px] uppercase tracking-[0.12em] text-outline">
                  jws compact
                </span>
                <Button
                  size="sm"
                  block
                  icon={<RefreshCw size={13} />}
                  disabled={!jwt?.ok}
                  onClick={() => {
                    setNow(Date.now());
                    if (jwt?.ok) {
                      toast.success("Token parsed", `${jwt.algorithm} · ${jwt.header.bytes} B header · ${jwt.payload.bytes} B payload`);
                    } else {
                      toast.error("Token could not be parsed", jwt?.message ?? "Paste a token first.");
                    }
                  }}
                >
                  Re-check
                </Button>
                <div className="h-px bg-white/[0.06] my-0.5" />
                <Button
                  variant="ghost"
                  size="xs"
                  block
                  icon={<Copy size={12} />}
                  disabled={!jwt?.ok}
                  title="Copy payload JSON"
                  aria-label="Copy payload JSON"
                  onClick={() => void copy(jwt?.ok ? jwt.payload.json : "", "Payload JSON")}
                >
                  Payload
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  block
                  icon={<Copy size={12} />}
                  disabled={!jwt?.ok}
                  title="Copy header JSON"
                  aria-label="Copy header JSON"
                  onClick={() => void copy(jwt?.ok ? jwt.header.json : "", "Header JSON")}
                >
                  Header
                </Button>
                <Button variant="ghost" size="xs" block icon={<Eraser size={12} />} disabled={input.length === 0} onClick={clear}>
                  Clear
                </Button>
                <span className="hidden lg:flex items-center justify-center gap-1 pt-0.5 text-[9px] text-outline">
                  <ShieldAlert size={10} className="text-warning" />
                  not verified
                </span>
              </div>

              {jwt?.ok ? (
                <div className="flex min-w-0 flex-col gap-2.5">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                    <JsonPanel
                      title="JOSE header"
                      hint={`${bytes(jwt.header.bytes)} decoded · base64url`}
                      badge={<Badge tone="tertiary" mono>{jwt.algorithm}</Badge>}
                      json={jwt.header.json}
                      ariaLabel="Decoded JWT header JSON"
                    />
                    <JsonPanel
                      title="Payload claims"
                      hint={`${bytes(jwt.payload.bytes)} decoded · base64url`}
                      badge={
                        <Badge tone={expiry?.tone ?? "neutral"} dot>
                          {expiry ? `${expiry.label} · ${expiry.detail}` : "No claims"}
                        </Badge>
                      }
                      json={jwt.payload.json}
                      ariaLabel="Decoded JWT payload JSON"
                    />
                  </div>

                  <InfoNotice tone="warning" icon={<ShieldAlert size={12} />}>
                    <span className="font-semibold">Signature not verified — this UI only decodes.</span> The signature
                    segment is displayed but never checked against a key. Treat every claim below as untrusted until the
                    token is verified server-side.
                  </InfoNotice>

                  <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_280px] gap-2.5">
                    <ClaimsTable payload={jwt.payload.value} expiry={expiry} />
                    <SignatureCard jwt={jwt} />
                  </div>

                  {jwt.warnings.length > 0 && (
                    <InfoNotice tone="warning" icon={<TriangleAlert size={12} />}>
                      {jwt.warnings.join(" ")}
                    </InfoNotice>
                  )}
                </div>
              ) : (
                <Card className="min-w-0 p-3 flex flex-col justify-center">
                  {input.trim() === "" ? (
                    <EmptyState
                      compact
                      icon={<KeyRound size={16} />}
                      title="Paste a token to inspect it"
                      description="Header, payload, registered claims and expiry are decoded locally. Nothing is verified or uploaded."
                      action={
                        <Button size="sm" icon={<WandSparkles size={13} />} onClick={loadSample}>
                          Load sample token
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-2">
                      <ErrorNotice
                        title="Token could not be parsed"
                        message={jwt ? jwt.message : "The input is not a compact JWS token."}
                      />
                      {jwt && !jwt.ok && jwt.hint && (
                        <p className="flex gap-1.5 px-0.5 text-[10.5px] leading-relaxed text-outline">
                          <CircleAlert size={12} className="mt-0.5 shrink-0" />
                          {jwt.hint}
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] gap-2.5">
              <Pane
                title="Input buffer"
                accent="primary"
                badge={<Badge tone={detected.tone} mono>{detected.label}</Badge>}
                meta={
                  <>
                    <span>{bytes(inputBytes)}</span>
                    <span className="text-white/20">·</span>
                    <span>{plural(countLines(input), "line")}</span>
                  </>
                }
                footer={
                  <>
                    <span className="truncate">{INPUT_HINTS[mode]}</span>
                    <span className="font-mono text-[9.5px] shrink-0">{direction}</span>
                  </>
                }
              >
                <CodeArea
                  value={input}
                  onChange={setInput}
                  ariaLabel={`${MODE_TITLES[mode]} input`}
                  placeholder={PLACEHOLDERS[mode]}
                  minHeight={300}
                  wrap
                  className="flex-1"
                />
              </Pane>

              <div className="flex flex-col justify-center gap-1.5 py-1">
                <span className="hidden lg:block text-center font-mono text-[9px] uppercase tracking-[0.12em] text-outline">
                  {transformHint(mode, direction, urlSafe)}
                </span>
                <Button
                  variant={direction === "encode" ? "primary" : "default"}
                  size="sm"
                  block
                  aria-pressed={direction === "encode"}
                  trailing={<ArrowRight size={13} />}
                  onClick={() => run("encode")}
                >
                  Encode
                </Button>
                <Button
                  variant={direction === "decode" ? "primary" : "default"}
                  size="sm"
                  block
                  aria-pressed={direction === "decode"}
                  icon={<ArrowLeft size={13} />}
                  onClick={() => run("decode")}
                >
                  Decode
                </Button>
                <div className="h-px bg-white/[0.06] my-0.5" />
                <Button
                  variant="ghost"
                  size="xs"
                  block
                  icon={<ArrowLeftRight size={12} />}
                  disabled={result.status !== "ok"}
                  onClick={swap}
                >
                  Swap
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  block
                  icon={<Copy size={12} />}
                  disabled={result.status !== "ok" || !result.text}
                  onClick={() => void copy(result.status === "ok" ? result.text : "", `${MODE_TITLES[mode]} output`)}
                >
                  Copy
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  block
                  icon={<Eraser size={12} />}
                  disabled={input.length === 0}
                  onClick={clear}
                >
                  Clear
                </Button>
                <span className="hidden lg:flex items-center justify-center gap-1 pt-0.5 text-[9px] text-outline">
                  <Kbd>⌘</Kbd>
                  <Kbd>↵</Kbd>
                  <span>run</span>
                </span>
              </div>

              <Pane
                title="Output buffer"
                accent={result.status === "error" ? "error" : result.status === "ok" ? "success" : "neutral"}
                badge={<Badge tone={outputTone} mono>{stale ? "Stale result" : result.label}</Badge>}
                meta={
                  result.status === "ok" ? (
                    <>
                      <span>{bytes(utf8Length(result.text))}</span>
                      <span className="text-white/20">·</span>
                      <span>{plural(result.text.length, "char")}</span>
                    </>
                  ) : (
                    <span>—</span>
                  )
                }
                footer={
                  <>
                    <span className="truncate">{result.status === "ok" ? (result.note ?? "—") : "No result"}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <MoveHorizontal size={11} />
                      <span>wrap</span>
                      <Switch checked={wrapOutput} onChange={setWrapOutput} label="Wrap long output lines" size="sm" />
                    </span>
                  </>
                }
              >
                {result.status === "error" ? (
                  <div className="flex flex-col gap-2 p-0.5" aria-live="polite">
                    <ErrorNotice title="Transform failed" message={result.message} />
                    {result.hint && (
                      <p className="flex gap-1.5 px-0.5 text-[10.5px] leading-relaxed text-outline">
                        <CircleAlert size={12} className="mt-0.5 shrink-0" />
                        {result.hint}
                      </p>
                    )}
                  </div>
                ) : result.status === "idle" ? (
                  <EmptyState
                    compact
                    icon={stale ? <TriangleAlert size={16} /> : <Braces size={16} />}
                    title={input.length > 0 ? "Run the transform" : "Output appears here"}
                    description={
                      input.length > 0
                        ? "Live transform is off. Press Encode or Decode — or ⌘↵."
                        : "Paste or type into the input buffer, or load a sample."
                    }
                  />
                ) : (
                  <>
                    {result.warning && (
                      <InfoNotice tone="warning" icon={<TriangleAlert size={12} />}>
                        {result.warning}
                      </InfoNotice>
                    )}
                    <CodeArea
                      value={result.text}
                      readOnly
                      wrap={wrapOutput}
                      minHeight={300}
                      ariaLabel="Transformed output"
                      className="flex-1"
                    />
                  </>
                )}
              </Pane>
            </div>
          )}
        </div>
      </Card>

      {mode === "jwt" ? (
        <Card className="p-3">
          <SectionLabel trailing={<span className="font-mono text-[10px] normal-case text-outline">base64url segments</span>}>
            Token ledger
          </SectionLabel>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
            <Metric label="Segments" value={jwt?.ok ? "3" : "—"} sub={jwt?.ok ? "header · payload · signature" : "no valid token"} />
            <Metric
              label="Header"
              value={jwt?.ok ? bytes(jwt.header.bytes) : "—"}
              sub={jwt?.ok ? plural(Object.keys(jwt.header.value).length, "field") : "—"}
              tone="tertiary"
            />
            <Metric
              label="Payload"
              value={jwt?.ok ? bytes(jwt.payload.bytes) : "—"}
              sub={jwt?.ok ? plural(Object.keys(jwt.payload.value).length, "claim") : "—"}
              tone="primary"
            />
            <Metric
              label="Signature"
              value={jwt?.ok ? (jwt.signature.bytes === null ? "unreadable" : bytes(jwt.signature.bytes)) : "—"}
              sub="decoded, never verified"
              tone="warning"
            />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-outline">
            <ShieldCheck size={11} className="text-secondary" />
            The token never leaves this window: splitting, base64url decoding and claim maths run in the renderer.
          </p>
        </Card>
      ) : (
        <Card className="p-3">
          <SectionLabel
            trailing={
              <span className="font-mono text-[10px] normal-case text-outline">
                {mode === "base64" ? (urlSafe ? "base64url · no padding" : "RFC 4648 · padded") : mode === "url" ? "encodeURIComponent" : "named + numeric references"}
              </span>
            }
          >
            Byte ledger
          </SectionLabel>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
            <Metric
              label="Input bytes"
              value={bytes(inputBytes)}
              sub={plural(input.length, "character")}
            />
            <Metric
              label="Output bytes"
              value={result.status === "ok" ? bytes(utf8Length(result.text)) : "—"}
              sub={result.status === "ok" ? plural(result.text.length, "character") : "no result yet"}
              tone="tertiary"
            />
            <Metric
              label="Size ratio"
              value={result.status === "ok" && inputBytes > 0 ? percent((utf8Length(result.text) / inputBytes) * 100, 1) : "—"}
              sub={
                result.status === "ok"
                  ? `${utf8Length(result.text) - inputBytes >= 0 ? "+" : "−"}${bytes(Math.abs(utf8Length(result.text) - inputBytes))} vs input`
                  : result.status === "error"
                    ? "transform failed"
                    : "run a transform"
              }
              tone="primary"
            />
            <Metric
              label="Output lines"
              value={result.status === "ok" ? String(countLines(result.text)) : "—"}
              sub={
                result.status === "ok"
                  ? direction === "encode"
                    ? "encode direction"
                    : "decode direction"
                  : result.status === "error"
                    ? "no output"
                    : "run a transform"
              }
              tone="success"
            />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-outline">
            <ShieldCheck size={11} className="text-secondary" />
            Pure client-side: TextEncoder/TextDecoder, btoa/atob and encodeURIComponent. Nothing is sent to the Rust core
            or to the network.
          </p>
        </Card>
      )}
    </ToolView>
  );
}

function Pane({
  title,
  accent,
  badge,
  meta,
  footer,
  children,
}: {
  title: string;
  accent: Tone;
  badge?: ReactNode;
  meta?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-black/25">
      <header className="flex h-9 items-center justify-between gap-2 border-b border-white/[0.055] bg-white/[0.02] px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Dot tone={accent} />
          <span className="truncate text-[12px] font-semibold text-on-surface">{title}</span>
          {badge}
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-outline tnum">{meta}</div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-1.5">{children}</div>
      {footer && (
        <footer className="flex h-8 items-center justify-between gap-2 border-t border-white/[0.055] bg-white/[0.015] px-2.5 text-[10px] text-outline">
          {footer}
        </footer>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  const toneClass: Record<Tone, string> = {
    neutral: "text-on-surface",
    primary: "text-primary-soft",
    success: "text-secondary",
    warning: "text-warning",
    error: "text-error",
    tertiary: "text-tertiary",
  };

  return (
    <div className="min-w-0 rounded-lg border border-white/[0.055] bg-black/30 px-2.5 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</div>
      <div className={`font-mono text-[13px] tnum ${toneClass[tone]}`}>{value}</div>
      {sub && <div className="truncate text-[10px] text-outline">{sub}</div>}
    </div>
  );
}

function JsonPanel({
  title,
  hint,
  badge,
  json,
  ariaLabel,
}: {
  title: string;
  hint: string;
  badge: ReactNode;
  json: string;
  ariaLabel: string;
}) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <CardHeader title={title} hint={hint} icon={<FileJson size={13} />} actions={badge} />
      <div className="flex min-h-0 flex-1 p-1.5">
        <CodeArea value={json} readOnly wrap minHeight={168} ariaLabel={ariaLabel} className="flex-1" />
      </div>
    </Card>
  );
}

function claimText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return value.map((entry) => claimText(entry)).join(", ");
  return JSON.stringify(value);
}

function interpretation(value: unknown): string {
  if (Array.isArray(value)) return `array · ${plural(value.length, "entry", "entries")}`;
  if (typeof value === "string") return `string · ${plural(value.length, "character")}`;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value === null) return "null";
  return typeof value;
}

function ClaimsTable({ payload, expiry }: { payload: Record<string, unknown>; expiry: ExpiryState | null }) {
  const present = CLAIM_ROWS.filter((claim) => payload[claim.key] !== undefined);
  const missing = CLAIM_ROWS.filter((claim) => payload[claim.key] === undefined).map((claim) => claim.key);
  const custom = Object.keys(payload).filter((key) => !REGISTERED_CLAIMS.includes(key as (typeof REGISTERED_CLAIMS)[number]));

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <CardHeader
        title="Registered claims"
        hint={`${present.length}/6 present${missing.length > 0 ? ` · missing ${missing.join(", ")}` : ""}`}
        icon={<Fingerprint size={13} />}
        actions={
          expiry ? (
            <Badge tone={expiry.tone} dot>
              {expiry.label} · {expiry.detail}
            </Badge>
          ) : undefined
        }
      />
      {present.length === 0 ? (
        <EmptyState
          compact
          icon={<Fingerprint size={16} />}
          title="No registered claims"
          description="The payload carries none of iss, sub, aud, exp, iat or nbf."
        />
      ) : (
        <div className="px-1.5 pb-1.5">
          <div className="grid h-6 grid-cols-[92px_minmax(0,1fr)] items-center gap-2 border-b border-white/[0.05] px-1.5 xl:grid-cols-[92px_minmax(0,1fr)_minmax(0,1.05fr)]">
            <span className="text-[9px] font-semibold uppercase tracking-[0.09em] text-outline">Claim</span>
            <span className="text-[9px] font-semibold uppercase tracking-[0.09em] text-outline">Value</span>
            <span className="hidden text-[9px] font-semibold uppercase tracking-[0.09em] text-outline xl:block">
              Interpretation
            </span>
          </div>
          {present.map((claim) => {
            const value = payload[claim.key];
            const raw = claimText(value);
            const epoch = claim.time ? numericClaim(payload, claim.key) : null;
            const human = claim.time
              ? epoch === null
                ? "not a numeric epoch"
                : formatClaimDate(epoch)
              : interpretation(value);
            return (
              <div
                key={claim.key}
                className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-2 border-b border-white/[0.04] px-1.5 py-1 last:border-0 xl:grid-cols-[92px_minmax(0,1fr)_minmax(0,1.05fr)] xl:items-center"
              >
                <div className="min-w-0">
                  <span className="font-mono text-[10px] uppercase text-primary-soft/90">{claim.key}</span>
                  <div className="truncate text-[9px] uppercase tracking-[0.06em] text-outline">{claim.label}</div>
                </div>
                <div className="min-w-0">
                  <div className="break-all font-mono text-[10.5px] leading-snug text-on-surface" title={raw}>
                    {raw}
                  </div>
                  <div className="font-mono text-[9.5px] leading-snug text-outline xl:hidden">{human}</div>
                </div>
                <div className="hidden min-w-0 font-mono text-[10px] leading-snug text-on-variant xl:block">
                  <span className={claim.key === "exp" && expiry ? (expiry.tone === "error" ? "text-error" : "text-on-variant") : undefined}>
                    {human}
                  </span>
                  {claim.key === "exp" && expiry && <div className="text-[9.5px] text-outline">{expiry.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {custom.length > 0 && (
        <div className="px-2.5 pb-2 text-[10px] text-outline">
          {plural(custom.length, "custom claim")} present · {custom.slice(0, 4).join(", ")}
          {custom.length > 4 ? "…" : ""}
        </div>
      )}
    </Card>
  );
}

function SignatureCard({ jwt }: { jwt: OkJwt }) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <CardHeader
        title="Signature"
        hint="decoded, not verified"
        icon={<KeyRound size={13} />}
        actions={<Badge tone="warning" dot>unverified</Badge>}
      />
      <div className="space-y-2 p-2.5">
        <div className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/[0.05] px-2 py-1.5">
          <ShieldAlert size={12} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-[10.5px] leading-relaxed text-[#ffe066]">
            Bytes are shown, never checked. A well-formed token is not a trusted token.
          </p>
        </div>
        <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1 font-mono text-[10px]">
          <span className="text-outline">alg</span>
          <span className="truncate text-on-surface">{jwt.algorithm}</span>
          <span className="text-outline">typ</span>
          <span className="truncate text-on-surface">{jwt.type}</span>
          <span className="text-outline">bytes</span>
          <span className="text-on-surface">
            {jwt.signature.bytes === null ? "unreadable" : `${jwt.signature.bytes} B`}
          </span>
          <span className="text-outline">segment</span>
          <span className="max-h-16 overflow-hidden break-all leading-snug text-on-variant">
            {jwt.signature.segment || "—"}
          </span>
        </div>
      </div>
    </Card>
  );
}
