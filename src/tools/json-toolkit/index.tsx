import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import {
  ArrowDownAZ,
  ArrowLeftRight,
  BadgeCheck,
  Braces,
  Check,
  CircleAlert,
  Copy,
  FileJson,
  GitCompare,
  ListTree,
  Minimize2,
  Play,
  Search,
  Trash2,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, SectionLabel } from "@/components/ui/Card";
import { CodeArea } from "@/components/ui/CodeArea";
import { EmptyState, ErrorNotice, InfoNotice } from "@/components/ui/Feedback";
import { Input, SegmentedControl, Select, Switch } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { bytes, plural } from "@/lib/format";
import { csvToJson, jsonToCsv } from "./lib/csv";
import { diffLines, type DiffSuccess } from "./lib/diff";
import {
  countLines,
  detectFormat,
  type DetectedFormat,
  formatJson,
  type IndentOption,
  jsonStats,
  minifyJson,
  parseJson,
  type ParseFailure,
  previewValue,
  sortKeysDeep,
  utf8Bytes,
} from "./lib/json";
import { formatPath, runQuery, type QueryMatch } from "./lib/query";
import { jsonToYaml, normalizeForDiff, parseYamlText } from "./lib/serialize";

const SAMPLE_JSON = `{
  "status": "ok",
  "generated_at": "2026-11-03T09:42:18Z",
  "meta": {
    "engine": "v8-opt-darwin",
    "cluster": "ap-southeast-1",
    "version": 4.12,
    "sync": true,
    "sampling_rate": 0.05
  },
  "users": [
    {
      "id": "usr_99a8b1",
      "email": "sarah.chen@kernel.io",
      "active": true,
      "metrics": { "qps": 820, "latency_ms": 1.4 },
      "credentials": {
        "roles": ["sysadmin", "secops", "deployer"],
        "token_exp": 1729384900
      }
    },
    {
      "id": "usr_42cc90",
      "email": "marcus.vance@infra.net",
      "active": false,
      "metrics": { "qps": 0, "latency_ms": null },
      "credentials": {
        "roles": ["viewer"],
        "token_exp": 1728100000
      }
    },
    {
      "id": "usr_17be44",
      "email": "alina.rostova@cloud.internal",
      "active": true,
      "metrics": { "qps": 1420, "latency_ms": 0.8 },
      "credentials": {
        "roles": ["neteng", "auditor"],
        "token_exp": 1735689600
      }
    }
  ],
  "telemetry": {
    "trace_id": "0x7fffb8e3aa91",
    "sampled": false
  }
}`;

const SAMPLE_CSV = `id,email,active,qps,latency_ms,note
usr_99a8b1,sarah.chen@kernel.io,true,820,1.4,"primary, us-east"
usr_42cc90,marcus.vance@infra.net,false,0,,"dormant since 2026-10-02"
usr_17be44,alina.rostova@cloud.internal,true,1420,0.8,`;

const SAMPLE_COMPARE = `{
  "status": "degraded",
  "generated_at": "2026-11-03T09:42:18Z",
  "meta": {
    "engine": "v8-opt-darwin",
    "cluster": "ap-southeast-1",
    "version": 4.13,
    "sync": false,
    "sampling_rate": 0.05
  },
  "users": [
    {
      "id": "usr_99a8b1",
      "email": "sarah.chen@kernel.io",
      "active": true,
      "metrics": { "qps": 640, "latency_ms": 2.1 },
      "credentials": {
        "roles": ["sysadmin", "deployer"],
        "token_exp": 1729384900
      }
    },
    {
      "id": "usr_17be44",
      "email": "alina.rostova@cloud.internal",
      "active": true,
      "metrics": { "qps": 1420, "latency_ms": 0.8 },
      "credentials": {
        "roles": ["neteng", "auditor"],
        "token_exp": 1735689600
      }
    }
  ],
  "telemetry": {
    "trace_id": "0x7fffb8e3aa91",
    "sampled": true
  }
}`;

type IndentKey = "2" | "4" | "tab";
type OutputKind = "json" | "yaml" | "csv";
type CopyTarget = "input" | "output" | "diff";

const INDENTS: { value: IndentKey; label: string }[] = [
  { value: "2", label: "2" },
  { value: "4", label: "4" },
  { value: "tab", label: "Tab" },
];

const INDENT_VALUE: Record<IndentKey, IndentOption> = { "2": 2, "4": 4, tab: "tab" };

const CONVERSIONS = [
  { value: "json-yaml", label: "JSON → YAML" },
  { value: "yaml-json", label: "YAML → JSON" },
  { value: "json-csv", label: "JSON → CSV" },
  { value: "csv-json", label: "CSV → JSON" },
] as const;

type Conversion = (typeof CONVERSIONS)[number]["value"];

const DETECTED: Record<DetectedFormat, { label: string; tone: Tone }> = {
  json: { label: "JSON", tone: "primary" },
  yaml: { label: "YAML", tone: "tertiary" },
  csv: { label: "CSV", tone: "success" },
  text: { label: "Plain text", tone: "neutral" },
  empty: { label: "Empty", tone: "neutral" },
};

const KIND_LABEL: Record<OutputKind, string> = { json: "JSON", yaml: "YAML", csv: "CSV" };

interface Note {
  tone: "success" | "warning" | "primary";
  title: string;
  text: string;
}

interface Issue {
  title: string;
  message: string;
  line: number | null;
  column: number | null;
  hint: string;
}

interface OutputMeta {
  label: string;
  kind: OutputKind;
  source: string;
}

interface QueryView {
  path: string;
  normalized: string;
  matches: QueryMatch[];
  truncated: boolean;
  error: string | null;
  hint: string | null;
}

function issueFrom(title: string, failure: ParseFailure): Issue {
  return { title, message: failure.message, line: failure.line, column: failure.column, hint: failure.hint };
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-on-surface",
  primary: "text-primary-soft",
  success: "text-secondary",
  warning: "text-warning",
  error: "text-error",
  tertiary: "text-tertiary",
};

export default function JsonToolkitView() {
  const [input, setInput] = useState<string>(SAMPLE_JSON);
  const [output, setOutput] = useState<string>("");
  const [outputMeta, setOutputMeta] = useState<OutputMeta | null>(null);
  const [indent, setIndent] = useState<IndentKey>("2");
  const [wrapOutput, setWrapOutput] = useState(false);
  const [actionError, setActionError] = useState<Issue | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [query, setQuery] = useState("$.users[*].email");
  const [queryView, setQueryView] = useState<QueryView | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffInput, setDiffInput] = useState<string>(SAMPLE_COMPARE);
  const [diffNormalize, setDiffNormalize] = useState(true);
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const copyTimer = useRef<number | null>(null);

  const parsed = useMemo(() => {
    const started = performance.now();
    const result = parseJson(input);
    return { result, ms: performance.now() - started };
  }, [input]);

  const live = parsed.result;
  const detected = detectFormat(input);
  const inputBytes = utf8Bytes(input);
  const inputLines = countLines(input);
  const outputBytes = utf8Bytes(output);
  const outputLines = countLines(output);
  const stats = live.ok ? jsonStats(live.value) : null;
  const stale = outputMeta !== null && outputMeta.source !== input;

  const issue: Issue | null = actionError
    ? actionError
    : detected === "json" && !live.ok
      ? { title: "Invalid JSON", message: live.error.message, line: live.error.line, column: live.error.column, hint: live.error.hint }
      : null;

  const errorLine = issue?.line ?? null;

  const state: { label: string; tone: Tone } =
    input.trim().length === 0
      ? { label: "Empty buffer", tone: "neutral" }
      : live.ok
        ? { label: "Valid JSON", tone: "success" }
        : detected === "json"
          ? { label: "Parse error", tone: "error" }
          : { label: `${DETECTED[detected].label} buffer`, tone: "neutral" };

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const emit = useCallback(
    (text: string, label: string, kind: OutputKind, next: Note, source: string) => {
      setOutput(text);
      setOutputMeta({ label, kind, source });
      setNote(next);
      setActionError(null);
      setCopied(null);
    },
    [],
  );

  const fail = useCallback((title: string, failure: ParseFailure) => {
    setActionError(issueFrom(title, failure));
    setNote(null);
    toast.error(title, `Line ${failure.line}, column ${failure.column} — ${failure.message}`);
  }, []);

  const changeInput = (value: string) => {
    setInput(value);
    setActionError(null);
    setQueryView(null);
  };

  const runFormat = useCallback(() => {
    const result = parseJson(input);
    if (!result.ok) {
      fail("Format failed", result.error);
      return;
    }
    const text = formatJson(result.value, INDENT_VALUE[indent]);
    const counts = jsonStats(result.value);
    emit(
      text,
      "Formatted",
      "json",
      {
        tone: "success",
        title: "Formatted",
        text: `${plural(countLines(text), "line")} · ${bytes(utf8Bytes(text))} · ${plural(counts.keys, "key")} at ${indent === "tab" ? "tab" : `${indent}-space`} indent`,
      },
      input,
    );
    toast.success("Formatted", `${plural(countLines(text), "line")} · ${bytes(utf8Bytes(text))}`);
  }, [emit, fail, indent, input]);

  const runMinify = useCallback(() => {
    const result = parseJson(input);
    if (!result.ok) {
      fail("Minify failed", result.error);
      return;
    }
    const text = minifyJson(result.value);
    const before = utf8Bytes(input);
    const after = utf8Bytes(text);
    const saved = before > 0 ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
    emit(
      text,
      "Minified",
      "json",
      { tone: "success", title: "Minified", text: `${bytes(after)} · ${saved}% smaller than the buffer · ${plural(countLines(text), "line")}` },
      input,
    );
    toast.success("Minified", `${bytes(after)} · ${saved}% smaller`);
  }, [emit, fail, input]);

  const runSort = useCallback(() => {
    const result = parseJson(input);
    if (!result.ok) {
      fail("Sort failed", result.error);
      return;
    }
    const sorted = sortKeysDeep(result.value);
    const text = formatJson(sorted, INDENT_VALUE[indent]);
    const counts = jsonStats(result.value);
    emit(
      text,
      "Keys sorted",
      "json",
      { tone: "success", title: "Keys sorted A→Z", text: `${plural(counts.keys, "key")} reordered at every level · array order untouched · ${plural(countLines(text), "line")}` },
      input,
    );
    toast.success("Keys sorted", `${plural(counts.keys, "key")} · array order preserved`);
  }, [emit, fail, indent, input]);

  const runValidate = useCallback(() => {
    const result = parseJson(input);
    if (!result.ok) {
      fail("Validation failed", result.error);
      return;
    }
    const counts = jsonStats(result.value);
    setActionError(null);
    setNote({
      tone: "success",
      title: "Valid JSON",
      text: `${plural(counts.nodes, "node")} · ${plural(counts.keys, "key")} · depth ${counts.maxDepth} · ${plural(counts.arrays, "array")} · ${plural(counts.primitives, "primitive")} · parsed in ${parsed.ms.toFixed(2)} ms · RFC 8259`,
    });
    toast.success("Valid JSON", `${plural(counts.nodes, "node")} · depth ${counts.maxDepth}`);
  }, [fail, input, parsed.ms]);

  const runConversion = useCallback(
    (kind: Conversion) => {
      if (kind === "json-yaml" || kind === "json-csv") {
        const result = parseJson(input);
        if (!result.ok) {
          fail(`${KIND_LABEL.json} → ${kind === "json-yaml" ? "YAML" : "CSV"} needs valid JSON`, result.error);
          return;
        }
        if (kind === "json-yaml") {
          const width: 2 | 4 = indent === "4" ? 4 : 2;
          const text = jsonToYaml(result.value, width);
          emit(
            text,
            "YAML",
            "yaml",
            {
              tone: "success",
              title: "JSON → YAML",
              text: `${plural(countLines(text), "line")} · ${bytes(utf8Bytes(text))}${indent === "tab" ? " · YAML forbids tabs, written with 2 spaces" : ""}`,
            },
            input,
          );
          toast.success("Converted to YAML", `${plural(countLines(text), "line")} · YAML 1.2`);
          return;
        }
        const table = jsonToCsv(result.value);
        if (!table.ok) {
          setActionError({ title: "JSON → CSV failed", message: table.message, line: null, column: null, hint: table.hint });
          setNote(null);
          toast.error("JSON → CSV failed", table.message);
          return;
        }
        emit(
          table.csv,
          "CSV",
          "csv",
          {
            tone: "success",
            title: "JSON → CSV",
            text: `${plural(table.rows, "row")} × ${plural(table.columns, "column")} · nested keys flattened to dots${table.encodedCells > 0 ? ` · ${plural(table.encodedCells, "array cell")} JSON-encoded` : ""}`,
          },
          input,
        );
        toast.success("Converted to CSV", `${plural(table.rows, "row")} × ${plural(table.columns, "column")}`);
        return;
      }

      if (kind === "yaml-json") {
        const result = parseYamlText(input);
        if (!result.ok) {
          setActionError({ title: "YAML → JSON failed", message: result.message, line: result.line, column: null, hint: result.hint });
          setNote(null);
          toast.error("YAML → JSON failed", result.line ? `Line ${result.line} — ${result.message}` : result.message);
          return;
        }
        const text = formatJson(result.value, INDENT_VALUE[indent]);
        emit(
          text,
          "JSON",
          "json",
          { tone: "success", title: "YAML → JSON", text: `${plural(countLines(text), "line")} · ${bytes(utf8Bytes(text))} · ${indent === "tab" ? "tab" : `${indent}-space`} indent` },
          input,
        );
        toast.success("Converted to JSON", `${plural(countLines(text), "line")} · ${bytes(utf8Bytes(text))}`);
        return;
      }

      const table = csvToJson(input);
      if (!table.ok) {
        setActionError({
          title: "CSV → JSON failed",
          message: table.message,
          line: table.line,
          column: null,
          hint: table.hint,
        });
        setNote(null);
        toast.error("CSV → JSON failed", table.line ? `Line ${table.line} — ${table.message}` : table.message);
        return;
      }
      emit(
        table.json,
        "JSON",
        "json",
        {
          tone: "success",
          title: "CSV → JSON",
          text: `${plural(table.rows, "row")} × ${plural(table.columns, "column")} · every cell stays a string · dot keys expanded`,
        },
        input,
      );
      toast.success("Converted to JSON", `${plural(table.rows, "row")} x ${plural(table.columns, "column")}`);
    },
    [emit, fail, indent, input],
  );

  const runQueryAction = useCallback(() => {
    const expression = query.trim();
    if (expression.length === 0) {
      document.getElementById("json-toolkit-path")?.focus();
      toast.info("Enter a path", "Examples: $.users[0].email · $[*].id");
      return;
    }
    const result = parseJson(input);
    if (!result.ok) {
      fail("Query needs valid JSON", result.error);
      setQueryView({ path: expression, normalized: expression, matches: [], truncated: false, error: result.error.message, hint: `Line ${result.error.line}, column ${result.error.column}. Paths only run against a parsed document.` });
      return;
    }
    const queried = runQuery(result.value, expression);
    if (!queried.ok) {
      setQueryView({ path: expression, normalized: expression, matches: [], truncated: false, error: queried.message, hint: queried.hint });
      toast.error("Invalid path", queried.message);
      return;
    }
    const values = queried.matches.map((match) => match.value);
    const payload = values.length === 1 ? values[0] : values;
    setQueryView({
      path: expression,
      normalized: queried.normalized,
      matches: queried.matches,
      truncated: queried.truncated,
      error: null,
      hint: null,
    });
    emit(
      formatJson(payload, INDENT_VALUE[indent]),
      queried.matches.length === 1 ? "1 match" : `${queried.matches.length} matches`,
      "json",
      {
        tone: queried.matches.length > 0 ? "success" : "warning",
        title: queried.normalized,
        text:
          queried.matches.length === 0
            ? "Nothing in this document matches the path"
            : `${plural(queried.matches.length, "match", "matches")} of ${plural(stats?.nodes ?? 0, "node")} · written to the output${queried.truncated ? " · capped at 5000" : ""}`,
      },
      input,
    );
    if (queried.matches.length > 0) toast.success(plural(queried.matches.length, "match", "matches"), queried.normalized);
    else toast.warning("No matches", `${queried.normalized} selected nothing`);
  }, [emit, fail, indent, input, query, stats?.nodes]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (diffOpen) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        runFormat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [diffOpen, runFormat]);

  const copy = useCallback(async (text: string, target: CopyTarget, label: string) => {
    if (text.length === 0) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied((current) => (current === target ? null : current)), 1600);
      toast.success("Copied", `${label} · ${plural(countLines(text), "line")} · ${bytes(utf8Bytes(text))}`);
    } catch {
      toast.error("Clipboard unavailable", "Select the text in the buffer and copy it manually.");
    }
  }, []);

  const clearAll = () => {
    setInput("");
    setOutput("");
    setOutputMeta(null);
    setActionError(null);
    setNote(null);
    setQueryView(null);
  };

  const loadSample = (kind: "json" | "csv") => {
    setInput(kind === "json" ? SAMPLE_JSON : SAMPLE_CSV);
    setActionError(null);
    setQueryView(null);
  };

  const useOutputAsInput = () => {
    if (output.length === 0) return;
    setInput(output);
    setActionError(null);
    setQueryView(null);
    toast.info("Output moved to the input buffer", "Run a conversion or query on it now.");
  };

  const diffModel = useMemo(() => {
    if (!diffOpen) return null;
    const leftSide = diffNormalize ? normalizeForDiff(input) : { text: input, parsed: null, errorLine: null, message: null };
    const rightSide = diffNormalize ? normalizeForDiff(diffInput) : { text: diffInput, parsed: null, errorLine: null, message: null };
    return {
      result: diffLines(leftSide.text, rightSide.text),
      leftParsed: leftSide.parsed,
      rightParsed: rightSide.parsed,
      rightErrorLine: rightSide.errorLine,
      normalize: diffNormalize,
    };
  }, [diffInput, diffNormalize, diffOpen, input]);

  const diffText = useMemo(() => {
    if (!diffModel || !diffModel.result.ok) return "";
    return diffModel.result.rows
      .map((row) => `${row.kind === "add" ? "+ " : row.kind === "remove" ? "- " : "  "}${row.text}`)
      .join("\n");
  }, [diffModel]);

  const queryIssue = queryView?.error ?? null;
  const hitCount = queryView && !queryView.error ? queryView.matches.length : null;

  return (
    <>
      <ToolView
        eyebrow="STRUCTURED DATA"
        eyebrowTone="tertiary"
        eyebrowHint="RFC 8259 · YAML 1.2 · RFC 4180"
        title="JSON Toolkit"
        description="Format, minify, validate, convert, query, and diff JSON — all local, all instant."
        telemetry={[
          { label: "Buffer", value: DETECTED[detected].label, tone: DETECTED[detected].tone, icon: <FileJson size={14} /> },
          { label: "Input", value: input.length === 0 ? "—" : bytes(inputBytes), tone: "neutral", icon: <ListTree size={14} /> },
          { label: "State", value: state.label, tone: state.tone, icon: <Dot tone={state.tone} pulse={state.tone === "success"} /> },
          { label: "Hits", value: hitCount === null ? "—" : String(hitCount), tone: "tertiary", icon: <Search size={14} /> },
        ]}
        toolbar={
          <>
            <Button variant="primary" icon={<WandSparkles size={13} />} onClick={runFormat} trailing={<Kbd>⌘↵</Kbd>}>
              Format
            </Button>
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">Indent</span>
              <SegmentedControl value={indent} onChange={setIndent} options={INDENTS} ariaLabel="Indentation width" />
            </span>
            <Button icon={<Minimize2 size={13} />} onClick={runMinify}>
              Minify
            </Button>
            <Button icon={<BadgeCheck size={13} />} onClick={runValidate}>
              Validate
            </Button>
            <Button icon={<ArrowDownAZ size={13} />} onClick={runSort}>
              Sort keys
            </Button>
            <Select
              value=""
              onChange={(event) => {
                const value = event.target.value as Conversion | "";
                event.target.value = "";
                if (value) runConversion(value);
              }}
              options={[{ value: "", label: "Convert…" }, ...CONVERSIONS]}
              sizeVariant="sm"
              aria-label="Convert between JSON, YAML and CSV"
              className="w-[136px]"
            />
            <Button variant="ghost" icon={<GitCompare size={13} />} onClick={() => setDiffOpen(true)}>
              Diff
            </Button>
          </>
        }
        status={
          <>
            <Badge tone={state.tone} dot>
              {state.label}
            </Badge>
            <Badge tone="neutral" mono>
              {indent === "tab" ? "tab" : `${indent} sp`}
            </Badge>
            <Badge tone="success" dot>
              local only
            </Badge>
          </>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] gap-2.5">
          <Pane
            title="Input source"
            accent="primary"
            badge={
              <Badge tone={DETECTED[detected].tone} mono>
                {DETECTED[detected].label}
              </Badge>
            }
            meta={
              <>
                <span>{input.length === 0 ? "0 B" : bytes(inputBytes)}</span>
                <span className="text-white/20">·</span>
                <span>{plural(inputLines, "line")}</span>
              </>
            }
            footer={
              <>
                <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-outline">
                  UTF-8 · BOM stripped · ⌘↵ formats
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <IconButton
                    label={copied === "input" ? "Input buffer copied" : "Copy input buffer"}
                    icon={copied === "input" ? <Check size={12} /> : <Copy size={12} />}
                    size="sm"
                    disabled={input.length === 0}
                    onClick={() => void copy(input, "input", "Input buffer")}
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => loadSample("json")}
                    title="Replace the buffer with the JSON sample"
                    aria-label="Load the JSON sample"
                  >
                    JSON
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => loadSample("csv")}
                    title="Replace the buffer with the CSV sample"
                    aria-label="Load the CSV sample"
                  >
                    CSV
                  </Button>
                </span>
              </>
            }
          >
            <CodeArea
              value={input}
              onChange={changeInput}
              ariaLabel="JSON, YAML or CSV input buffer"
              placeholder="Paste JSON, YAML or CSV…"
              minHeight={340}
              errorLine={errorLine}
              className="flex-1"
            />
          </Pane>

          <div className="flex flex-col justify-center gap-1.5 py-1">
            <span className="hidden text-center font-mono text-[9px] uppercase tracking-[0.12em] text-outline lg:block">
              transform
            </span>
            <Button size="sm" block variant="primary" icon={<WandSparkles size={13} />} onClick={runFormat}>
              Format
            </Button>
            <Button size="sm" block icon={<ArrowDownAZ size={13} />} onClick={runSort}>
              Sort
            </Button>
            <div className="my-0.5 h-px bg-white/[0.06]" />
            <Button
              variant="ghost"
              size="xs"
              block
              icon={copied === "output" ? <Check size={12} /> : <Copy size={12} />}
              disabled={output.length === 0}
              onClick={() => void copy(output, "output", outputMeta?.label ?? "Output")}
            >
              {copied === "output" ? "Copied" : "Copy out"}
            </Button>
            <Button variant="ghost" size="xs" block icon={<ArrowLeftRight size={12} />} disabled={output.length === 0} onClick={useOutputAsInput}>
              To input
            </Button>
            <Button
              variant="ghost"
              size="xs"
              block
              icon={<Trash2 size={12} />}
              disabled={input.length === 0 && output.length === 0}
              onClick={clearAll}
            >
              Clear
            </Button>
            <span className="hidden items-center justify-center gap-1 pt-0.5 text-[9px] text-outline lg:flex">
              <Braces size={10} />
              {stats ? `${plural(stats.keys, "key")}` : "no parse"}
            </span>
          </div>

          <Pane
            title={outputMeta?.label ?? "Output"}
            accent={stale ? "warning" : output.length > 0 ? "success" : "neutral"}
            badge={
              output.length > 0 ? (
                <Badge tone={stale ? "warning" : "success"} mono>
                  {stale ? "stale" : KIND_LABEL[outputMeta?.kind ?? "json"]}
                </Badge>
              ) : undefined
            }
            meta={
              output.length === 0 ? (
                <span>—</span>
              ) : (
                <>
                  <span aria-live="polite">{bytes(outputBytes)}</span>
                  <span className="text-white/20">·</span>
                  <span aria-live="polite">{plural(outputLines, "line")}</span>
                </>
              )
            }
            footer={
              <>
                <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-outline" aria-live="polite">
                  {output.length === 0
                    ? "No output yet"
                    : stale
                      ? "Generated from a previous buffer"
                      : `${KIND_LABEL[outputMeta?.kind ?? "json"]} · ${plural(outputLines, "line")} · ${bytes(outputBytes)}`}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[9.5px] text-outline">wrap</span>
                  <Switch checked={wrapOutput} onChange={setWrapOutput} label="Wrap long output lines" size="sm" />
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={copied === "output" ? <Check size={12} /> : <Copy size={12} />}
                    disabled={output.length === 0}
                    onClick={() => void copy(output, "output", outputMeta?.label ?? "Output")}
                  >
                    {copied === "output" ? "Copied" : "Copy"}
                  </Button>
                </span>
              </>
            }
          >
            {output.length === 0 ? (
              <EmptyState
                compact
                icon={<Braces size={16} />}
                title="Output appears here"
                description="Format, minify, sort, convert or run a path — the result is written to this pane and never leaves the window."
                action={
                  <Button size="sm" icon={<WandSparkles size={13} />} onClick={runFormat} disabled={!live.ok}>
                    Format the buffer
                  </Button>
                }
              />
            ) : (
              <CodeArea value={output} readOnly wrap={wrapOutput} minHeight={340} ariaLabel={`${outputMeta?.label ?? "Output"} result`} className="flex-1" />
            )}
          </Pane>
        </div>

        {issue ? (
          <div className="flex flex-col gap-1.5">
            <ErrorNotice
              title={
                issue.line
                  ? `${issue.title} · line ${issue.line}${issue.column ? `, column ${issue.column}` : ""}`
                  : issue.title
              }
              message={issue.message}
            />
            <p className="flex items-start gap-1.5 px-0.5 text-[10.5px] leading-relaxed text-outline">
              <CircleAlert size={11} className="mt-0.5 shrink-0" />
              <span>
                {issue.hint}
                {issue.line ? ` The gutter marks line ${issue.line}.` : ""}
              </span>
            </p>
          </div>
        ) : note ? (
          <InfoNotice
            tone={note.tone === "primary" ? "primary" : note.tone === "warning" ? "warning" : "success"}
            icon={note.tone === "warning" ? <TriangleAlert size={12} /> : <Check size={12} />}
          >
            <span className="font-semibold">{note.title}</span>
            <span className="text-on-variant/85"> — {note.text}</span>
          </InfoNotice>
        ) : null}

        <Card className="p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-primary-soft">path</span>
            <span className="text-outline">›</span>
            <div className="min-w-[220px] flex-1">
              <Input
                id="json-toolkit-path"
                mono
                sizeVariant="sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runQueryAction();
                  }
                }}
                placeholder="$.users[0].email"
                aria-label="Path expression"
                invalid={queryIssue !== null}
                leading={<Search size={11} />}
              />
            </div>
            <Button size="sm" icon={<Play size={12} />} onClick={runQueryAction} disabled={input.trim().length === 0}>
              Run
            </Button>
            {queryIssue ? (
              <Badge tone="error" dot>
                Invalid path
              </Badge>
            ) : queryView ? (
              <Badge tone={queryView.matches.length > 0 ? "success" : "warning"} mono>
                {plural(queryView.matches.length, "match", "matches")}
              </Badge>
            ) : (
              <Badge tone="neutral" mono>
                not run
              </Badge>
            )}
            <span className="ml-auto hidden items-center gap-1.5 font-mono text-[9.5px] text-outline xl:flex">
              <span className="text-primary-soft">$</span>
              <span>.key</span>
              <span>[0]</span>
              <span>[-1]</span>
              <span>[*]</span>
              <span>[&quot;quoted key&quot;]</span>
              <span className="text-outline/60">no filters</span>
            </span>
          </div>

          {queryView ? (
            queryView.error ? (
              <div className="mt-2 space-y-1">
                <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-error" role="alert">
                  <TriangleAlert size={11} className="mt-0.5 shrink-0" />
                  {queryView.error}
                </p>
                {queryView.hint && <p className="pl-4 text-[10px] leading-relaxed text-outline">{queryView.hint}</p>}
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Hits</span>
                {queryView.matches.length === 0 ? (
                  <span className="text-[10.5px] text-outline">Nothing matches {queryView.normalized}</span>
                ) : (
                  queryView.matches.slice(0, 6).map((match) => (
                    <span
                      key={formatPath(match.path)}
                      className="max-w-[260px] shrink-0 truncate rounded border border-white/[0.06] bg-black/40 px-1.5 py-0.5 font-mono text-[10px]"
                      title={`${formatPath(match.path)} = ${previewValue(match.value, 200)}`}
                    >
                      <span className="text-primary-soft">{formatPath(match.path)}</span>
                      <span className="text-outline"> = </span>
                      <span className="text-secondary">{previewValue(match.value, 34)}</span>
                    </span>
                  ))
                )}
                {queryView.matches.length > 6 && (
                  <span className="shrink-0 text-[10px] text-outline">+{queryView.matches.length - 6} more</span>
                )}
                {queryView.truncated && <span className="shrink-0 text-[10px] text-warning">capped at 5000</span>}
              </div>
            )
          ) : (
            <p className="mt-2 text-[10px] leading-relaxed text-outline">
              Paths read the buffer: <span className="font-mono text-on-variant">$.users[*].email</span>,{" "}
              <span className="font-mono text-on-variant">$[0]</span>, <span className="font-mono text-on-variant">$[-1]</span>,{" "}
              <span className="font-mono text-on-variant">$.meta.*</span>. Negative indexes count from the end;{" "}
              <span className="font-mono text-on-variant">[*]</span> fans out arrays and object values. Keys with dots use{" "}
              <span className="font-mono text-on-variant">[&quot;a.b&quot;]</span>. Filters, slices and{" "}
              <span className="font-mono text-on-variant">..</span> are rejected with an explanation.
            </p>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Depth" value={stats ? String(stats.maxDepth) : "—"} tone="primary" />
          <Stat label="Keys" value={stats ? String(stats.keys) : "—"} />
          <Stat label="Nodes" value={stats ? String(stats.nodes) : "—"} tone="tertiary" />
          <Stat label="Arrays" value={stats ? String(stats.arrays) : "—"} />
          <Stat label="Primitives" value={stats ? String(stats.primitives) : "—"} tone="success" />
          <Stat label="Parse" value={live.ok ? `${parsed.ms.toFixed(2)} ms` : "—"} tone={live.ok ? "success" : "neutral"} />
        </div>
      </ToolView>

      <Modal
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        title="Structural diff"
        description="The input buffer on the left, a second document on the right. Both sides are pretty-printed and key-sorted first, so layout and key order never show up as changes."
        width={920}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDiffOpen(false)}>
              Close
            </Button>
            <Button
              icon={copied === "diff" ? <Check size={13} /> : <Copy size={13} />}
              disabled={diffText.length === 0}
              onClick={() => void copy(diffText, "diff", "Diff")}
            >
              {copied === "diff" ? "Copied" : "Copy diff"}
            </Button>
            <Button
              variant="primary"
              icon={<ArrowLeftRight size={13} />}
              disabled={diffInput.trim().length === 0}
              onClick={() => {
                setInput(diffInput);
                setActionError(null);
                setQueryView(null);
                setDiffOpen(false);
                toast.info("Input replaced", "The comparison document is now the buffer.");
              }}
            >
              Use right side
            </Button>
          </>
        }
      >
        <div className="max-h-[72vh] space-y-2.5 overflow-y-auto pr-0.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel trailing={<span className="font-mono text-[10px] normal-case text-outline">right side</span>}>
              Comparison buffer
            </SectionLabel>
            <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
              Normalize
              <Switch
                checked={diffNormalize}
                onChange={setDiffNormalize}
                label="Pretty-print and key-sort both sides before comparing"
                size="sm"
              />
            </span>
          </div>

          <CodeArea
            value={diffInput}
            onChange={setDiffInput}
            ariaLabel="Comparison document"
            placeholder="Paste the second JSON document…"
            minHeight={132}
            errorLine={diffModel?.rightErrorLine ?? null}
          />

          {diffModel && diffModel.normalize && (diffModel.leftParsed === false || diffModel.rightParsed === false) && (
            <InfoNotice tone="warning" icon={<TriangleAlert size={12} />}>
              {diffModel.leftParsed === false ? "The input buffer" : "The comparison buffer"} is not valid JSON, so that side
              is compared as raw text.
            </InfoNotice>
          )}

          <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-black/40">
            <div className="flex items-center justify-between gap-2 border-b border-white/[0.055] bg-white/[0.02] px-2 py-1.5">
              <span className="flex items-center gap-2 font-mono text-[10px] text-outline">
                <span className="inline-flex w-6 justify-end">L</span>
                <span className="inline-flex w-6 justify-end">R</span>
                <span className="pl-4">line diff</span>
              </span>
              {diffModel && diffModel.result.ok ? (
                <span className="flex items-center gap-1.5">
                  <Badge tone="success" mono>
                    +{diffModel.result.added} added
                  </Badge>
                  <Badge tone="error" mono>
                    −{diffModel.result.removed} removed
                  </Badge>
                  <Badge tone="neutral" mono>
                    {plural(diffModel.result.leftLines, "line")} vs {plural(diffModel.result.rightLines, "line")}
                  </Badge>
                </span>
              ) : null}
            </div>
            <div className="max-h-[300px] overflow-auto">
              {!diffModel ? null : diffModel.result.ok ? (
                diffModel.result.rows.length === 0 ? (
                  <p className="px-2 py-3 text-[11px] text-outline">Both buffers are empty.</p>
                ) : diffModel.result.added === 0 && diffModel.result.removed === 0 ? (
                  <p className="flex items-center gap-1.5 px-2 py-3 text-[11px] text-secondary">
                    <Check size={12} /> Identical after normalization — no value changed.
                  </p>
                ) : (
                  <DiffRows result={diffModel.result} />
                )
              ) : (
                <p className="px-2 py-3 text-[11px] text-warning">{diffModel.result.message}</p>
              )}
            </div>
          </div>

          <p className="px-0.5 text-[10px] leading-relaxed text-outline">
            <span className="text-outline/70">Comparisons are line-level.</span> Turn normalization off to diff the raw
            buffers byte for byte, including indentation and key order.
          </p>
        </div>
      </Modal>
    </>
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

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-white/[0.05] bg-black/30 px-2 py-1">
      <span className="truncate text-[9.5px] uppercase tracking-[0.06em] text-outline">{label}</span>
      <span className={clsx("shrink-0 font-mono text-[11px] tnum", TONE_TEXT[tone])}>{value}</span>
    </div>
  );
}

function DiffRows({ result }: { result: DiffSuccess }) {
  const limit = 1200;
  const rows = result.rows.slice(0, limit);
  return (
    <div className="font-mono text-[10.5px] leading-[17px]">
      {rows.map((row, index) => (
        <div
          key={`${row.kind}-${index}`}
          className={clsx(
            "flex items-start gap-2 px-2",
            row.kind === "add" && "bg-secondary/[0.08] text-[#8ff0a4]",
            row.kind === "remove" && "bg-error/[0.08] text-[#ff8b81]",
            row.kind === "equal" && "text-on-variant/70",
          )}
        >
          <span className="w-6 shrink-0 text-right text-outline/50 tnum">{row.leftLine ?? ""}</span>
          <span className="w-6 shrink-0 text-right text-outline/50 tnum">{row.rightLine ?? ""}</span>
          <span className="w-2 shrink-0 select-none text-center opacity-80">
            {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}
          </span>
          <span className="whitespace-pre-wrap break-all">{row.text.length === 0 ? "\u00a0" : row.text}</span>
        </div>
      ))}
      {result.rows.length > limit && (
        <div className="px-2 py-1 text-[10px] text-outline">
          Showing {limit} of {result.rows.length} rows — narrow the documents to see the rest.
        </div>
      )}
    </div>
  );
}
