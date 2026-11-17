import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Copy,
  Eraser,
  FileCode2,
  FileText,
  GitCompare,
  Minus,
  Plus,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CodeArea } from "@/components/ui/CodeArea";
import { Checkbox, SegmentedControl, Switch } from "@/components/ui/Form";
import { EmptyState, ErrorNotice, InfoNotice, Progress } from "@/components/ui/Feedback";
import { toast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/ipc";
import { plural } from "@/lib/format";
import {
  COLLAPSE_THRESHOLD,
  MAX_INPUT_CHARS,
  buildDisplayItems,
  buildPatch,
  computeDiff,
  countLines,
  normalizeText,
  type DiffRow,
  type DiffStats,
  type Granularity,
  type Segment,
  type ViewMode,
} from "./lib/diff";

const SPLIT_COLUMNS = "46px 18px minmax(0, 1fr) 46px 18px minmax(0, 1fr)";
const UNIFIED_COLUMNS = "46px 46px 18px minmax(0, 1fr)";
const RENDER_LIMIT = 1_500;
const PATCH_PREVIEW_LIMIT = 400;
const DEBOUNCE_MS = 220;

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "lines", label: "Lines" },
  { value: "words", label: "Words" },
  { value: "chars", label: "Characters" },
];

const VIEWS: { value: ViewMode; label: string }[] = [
  { value: "split", label: "Side-by-side" },
  { value: "unified", label: "Unified" },
];

const SAMPLE_ORIGINAL = [
  'import { createServer } from "node:http";',
  'import { readFile } from "node:fs/promises";',
  "",
  "const PORT = Number(process.env.PORT ?? 3000);",
  "const CACHE_TTL_MS = 30_000;",
  "",
  "type CacheEntry = { body: Buffer; expiresAt: number };",
  "",
  "const cache = new Map<string, CacheEntry>();",
  "",
  "export function remember(key: string, body: Buffer): void {",
  "  cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });",
  "}",
  "",
  "export async function loadAsset(path: string): Promise<Buffer> {",
  "  const cached = cache.get(path);",
  "  if (cached && cached.expiresAt > Date.now()) {",
  "    return cached.body;",
  "  }",
  "  const body = await readFile(path);",
  "  remember(path, body);",
  "  return body;",
  "}",
  "",
  "createServer(async (req, res) => {",
  "  const body = await loadAsset(`.${req.url ?? \"/index.html\"}`);",
  '  res.writeHead(200, { "content-type": "text/html" });',
  "  res.end(body);",
  "}).listen(PORT);",
].join("\n");

const SAMPLE_MODIFIED = [
  'import { createServer } from "node:http";',
  'import { readFile } from "node:fs/promises";',
  "",
  "const PORT = Number(process.env.PORT ?? 8080);",
  "const CACHE_TTL_MS = 15_000;",
  "",
  "type CacheEntry = { body: Buffer; expiresAt: number; hits: number };",
  "",
  "const cache = new Map<string, CacheEntry>();",
  "",
  "export function remember(key: string, body: Buffer): number {",
  "  const hits = (cache.get(key)?.hits ?? 0) + 1;",
  "  cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS, hits });",
  "  return hits;",
  "}",
  "",
  "export async function loadAsset(path: string): Promise<Buffer> {",
  "  const cached = cache.get(path);",
  "  if (cached && cached.expiresAt > Date.now()) {",
  "    return cached.body;",
  "  }",
  "  const body = await readFile(path);",
  "  remember(path, body);",
  "  return body;",
  "}",
  "",
  "const server = createServer(async (req, res) => {",
  "  const body = await loadAsset(`.${req.url ?? \"/index.html\"}`);",
  '  res.writeHead(200, { "content-type": "text/html", "cache-control": "max-age=15" });',
  "  res.end(body);",
  "});",
  "",
  'server.listen(PORT, () => console.log(`listening on ${PORT}`));',
  "",
  'process.on("SIGTERM", () => server.close());',
].join("\n");

function fmt(value: number): string {
  return value.toLocaleString("en-US");
}

function similarityTone(value: number): "success" | "primary" | "warning" | "error" {
  if (value >= 90) return "success";
  if (value >= 60) return "primary";
  if (value >= 30) return "warning";
  return "error";
}

function similarityLabel(value: number): string {
  if (value === 100) return "identical";
  if (value >= 85) return "low drift";
  if (value >= 50) return "moderate";
  if (value >= 25) return "heavy";
  return "diverged";
}

function Marked({ text, segments, mark }: { text: string; segments: Segment[] | null; mark: string }) {
  if (!segments) return <>{text === "" ? "\u00a0" : text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          <span key={index} className={mark}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

const REMOVED_MARK = "bg-error/30 text-[#ffd7d3] rounded-[2px]";
const ADDED_MARK = "bg-secondary/30 text-[#ccffd8] rounded-[2px]";
const FILLER =
  "bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.035)_0px,rgba(255,255,255,0.035)_1px,transparent_1px,transparent_5px)]";

function SplitRow({ row, active, chunkStart }: { row: DiffRow; active: boolean; chunkStart: boolean }) {
  const removedSide = row.kind === "removed" || row.kind === "modified";
  const addedSide = row.kind === "added" || row.kind === "modified";

  return (
    <div
      className={clsx(
        "grid border-b border-white/[0.035] transition-colors duration-100",
        active ? "bg-primary/[0.06]" : "hover:bg-white/[0.02]",
      )}
      style={{ gridTemplateColumns: SPLIT_COLUMNS }}
      data-chunk-start={chunkStart ? row.chunk : undefined}
    >
      <div
        className={clsx(
          "h-[22px] leading-[22px] pr-2 text-right font-mono text-[10.5px] tnum select-none",
          removedSide ? "text-error/80" : "text-outline/60",
          active && removedSide && "shadow-[inset_2px_0_0_#aac7ff]",
        )}
      >
        {row.leftNo ?? ""}
      </div>
      <div
        aria-hidden
        className={clsx(
          "h-[22px] leading-[22px] text-center font-mono text-[11px] select-none",
          removedSide ? "text-error" : "text-transparent",
          removedSide ? "bg-error/[0.075]" : row.kind === "added" ? FILLER : "",
        )}
      >
        {removedSide ? "−" : ""}
      </div>
      <div
        className={clsx(
          "h-[22px] leading-[22px] px-2 whitespace-pre overflow-hidden font-mono text-[11.5px]",
          removedSide
            ? row.kind === "modified"
              ? "bg-error/[0.075] text-on-variant"
              : "bg-error/[0.075] text-[#ffb4ab]"
            : row.kind === "added"
              ? clsx("text-transparent", FILLER)
              : "text-on-variant/90",
        )}
      >
        {removedSide ? <Marked text={row.left} segments={row.leftSeg} mark={REMOVED_MARK} /> : null}
      </div>

      <div
        className={clsx(
          "h-[22px] leading-[22px] pr-2 text-right font-mono text-[10.5px] tnum select-none border-l border-white/[0.06]",
          addedSide ? "text-secondary/80" : "text-outline/60",
          active && addedSide && "shadow-[inset_2px_0_0_#aac7ff]",
        )}
      >
        {row.rightNo ?? ""}
      </div>
      <div
        aria-hidden
        className={clsx(
          "h-[22px] leading-[22px] text-center font-mono text-[11px] select-none",
          addedSide ? "text-secondary bg-secondary/[0.07]" : row.kind === "removed" ? FILLER : "",
        )}
      >
        {addedSide ? "+" : ""}
      </div>
      <div
        className={clsx(
          "h-[22px] leading-[22px] px-2 whitespace-pre overflow-hidden font-mono text-[11.5px]",
          addedSide
            ? row.kind === "modified"
              ? "bg-secondary/[0.07] text-on-variant"
              : "bg-secondary/[0.07] text-[#9ef7b2]"
            : row.kind === "removed"
              ? clsx("text-transparent", FILLER)
              : "text-on-variant/90",
        )}
      >
        {addedSide ? <Marked text={row.right} segments={row.rightSeg} mark={ADDED_MARK} /> : null}
      </div>
    </div>
  );
}

function UnifiedRow({
  leftNo,
  rightNo,
  sign,
  text,
  segments,
  tone,
}: {
  leftNo: number | null;
  rightNo: number | null;
  sign: " " | "+" | "−";
  text: string;
  segments: Segment[] | null;
  tone: "equal" | "removed" | "added";
}) {
  return (
    <div
      className={clsx(
        "grid border-b border-white/[0.035] font-mono text-[11.5px]",
        tone === "removed" && "bg-error/[0.075]",
        tone === "added" && "bg-secondary/[0.07]",
      )}
      style={{ gridTemplateColumns: UNIFIED_COLUMNS }}
    >
      <div
        className={clsx(
          "h-[22px] leading-[22px] pr-2 text-right text-[10.5px] tnum select-none",
          tone === "removed" ? "text-error/80" : "text-outline/60",
        )}
      >
        {leftNo ?? ""}
      </div>
      <div
        className={clsx(
          "h-[22px] leading-[22px] pr-2 text-right text-[10.5px] tnum select-none border-l border-white/[0.06]",
          tone === "added" ? "text-secondary/80" : "text-outline/60",
        )}
      >
        {rightNo ?? ""}
      </div>
      <div
        aria-hidden
        className={clsx(
          "h-[22px] leading-[22px] text-center select-none",
          tone === "removed" ? "text-error" : tone === "added" ? "text-secondary" : "text-outline/40",
        )}
      >
        {sign}
      </div>
      <div
        className={clsx(
          "h-[22px] leading-[22px] px-2 whitespace-pre overflow-hidden",
          tone === "removed" ? "text-[#ffb4ab]" : tone === "added" ? "text-[#9ef7b2]" : "text-on-variant/90",
        )}
      >
        {tone === "equal" ? (
          text === "" ? "\u00a0" : text
        ) : (
          <Marked text={text} segments={segments} mark={tone === "removed" ? REMOVED_MARK : ADDED_MARK} />
        )}
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  tone,
  icon,
  sub,
}: {
  label: string;
  value: string;
  tone: string;
  icon: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2 px-3 py-2 min-w-0">
      <div className="min-w-0 space-y-1">
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</div>
        <div className={clsx("font-mono text-[14px] font-semibold tnum leading-none", tone)}>{value}</div>
        {sub}
      </div>
      <span className="text-outline/70 shrink-0 mt-0.5">{icon}</span>
    </div>
  );
}

interface RunOptions {
  left: string;
  right: string;
  granularity: Granularity;
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
}

export default function TextDiffView() {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("words");
  const [view, setView] = useState<ViewMode>("split");
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [autoCompare, setAutoCompare] = useState(true);
  const [result, setResult] = useState<ReturnType<typeof computeDiff>>(null);
  const [lastRun, setLastRun] = useState<RunOptions | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [activeChunk, setActiveChunk] = useState<number | null>(null);
  const [renderAll, setRenderAll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const overLimit = left.length > MAX_INPUT_CHARS || right.length > MAX_INPUT_CHARS;
  const empty = left.length === 0 && right.length === 0;

  const runCompare = useCallback(() => {
    if (left.length > MAX_INPUT_CHARS || right.length > MAX_INPUT_CHARS) {
      setResult(null);
      setLastRun(null);
      setPending(false);
      setError(null);
      return;
    }
    if (left.length === 0 && right.length === 0) {
      setResult(null);
      setLastRun(null);
      setPending(false);
      setError(null);
      return;
    }

    const next = computeDiff(left, right, granularity, { ignoreCase, ignoreWhitespace });
    if (!next) {
      setResult(null);
      setPending(false);
      setError("The comparison exceeded its 2.5 s budget. Trim the larger pane or switch granularity to Lines.");
      return;
    }
    setResult(next);
    setLastRun({ left, right, granularity, ignoreCase, ignoreWhitespace });
    setError(null);
    setPending(false);
    setExpanded(new Set());
    setExpandAll(false);
    setActiveChunk(null);
    setRenderAll(false);
  }, [left, right, granularity, ignoreCase, ignoreWhitespace]);

  useEffect(() => {
    if (!autoCompare) {
      setPending(false);
      return;
    }
    if (left.length === 0 && right.length === 0) {
      setResult(null);
      setLastRun(null);
      setPending(false);
      setError(null);
      return;
    }
    if (left.length > MAX_INPUT_CHARS || right.length > MAX_INPUT_CHARS) {
      setPending(false);
      setResult(null);
      setError(null);
      return;
    }
    setPending(true);
    const timer = window.setTimeout(runCompare, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [autoCompare, left, right, granularity, ignoreCase, ignoreWhitespace, runCompare]);

  const stale =
    lastRun !== null &&
    (lastRun.left !== left ||
      lastRun.right !== right ||
      lastRun.granularity !== granularity ||
      lastRun.ignoreCase !== ignoreCase ||
      lastRun.ignoreWhitespace !== ignoreWhitespace);

  const items = useMemo(
    () => (result ? buildDisplayItems(result.rows, expanded, expandAll) : []),
    [result, expanded, expandAll],
  );

  const stats: DiffStats | null = result?.stats ?? null;
  const hasChanges = stats !== null && stats.additions + stats.deletions > 0;

  const patch = useMemo(() => {
    if (!result || !hasChanges) return "";
    return buildPatch(left, right);
  }, [result, hasChanges, left, right]);

  const patchLines = useMemo(() => (patch.length === 0 ? [] : patch.split("\n")), [patch]);

  const longestLine = useMemo(() => {
    if (!result) return 0;
    let max = 0;
    for (const row of result.rows) {
      if (row.left.length > max) max = row.left.length;
      if (row.right.length > max) max = row.right.length;
    }
    return Math.min(max, 400);
  }, [result]);

  const contentWidth = useMemo(() => {
    if (view === "unified") return 118 + longestLine * 6.8;
    return 128 + longestLine * 6.8 * 2;
  }, [view, longestLine]);

  const jumpToChunk = useCallback((index: number) => {
    setActiveChunk(index);
    const container = scrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-chunk-start="${index}"]`);
    if (!target) return;
    const box = container.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + rect.top - box.top - box.height / 2 + rect.height / 2,
      behavior: "smooth",
    });
  }, []);

  const stepChunk = useCallback(
    (direction: 1 | -1) => {
      const total = result?.chunks.length ?? 0;
      if (total === 0) return;
      const next = activeChunk === null ? (direction === 1 ? 0 : total - 1) : (activeChunk + direction + total) % total;
      jumpToChunk(next);
    },
    [result, activeChunk, jumpToChunk],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "]") {
        event.preventDefault();
        stepChunk(1);
      } else if (event.key === "[") {
        event.preventDefault();
        stepChunk(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepChunk]);

  const clearAll = () => {
    setLeft("");
    setRight("");
    setResult(null);
    setLastRun(null);
    setError(null);
    setActiveChunk(null);
    setExpanded(new Set());
    setExpandAll(false);
  };

  const swapPanes = () => {
    setLeft(right);
    setRight(left);
    setActiveChunk(null);
  };

  const loadSample = () => {
    setLeft(SAMPLE_ORIGINAL);
    setRight(SAMPLE_MODIFIED);
    setActiveChunk(null);
  };

  const copyPatch = async () => {
    if (!patch) return;
    try {
      await navigator.clipboard.writeText(patch);
      toast.success("Unified patch copied", `${plural(patchLines.length, "line")} · ready for git apply`);
    } catch (err) {
      toast.error("Clipboard blocked", errorMessage(err));
    }
  };

  const toggleRun = (run: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(run)) next.delete(run);
      else next.add(run);
      return next;
    });
  };

  const visibleItems = renderAll ? items : items.slice(0, RENDER_LIMIT);
  const hiddenRows = items.length - visibleItems.length;
  const headerHint = result
    ? `${plural(result.rows.length, "row")} · ${plural(result.stats.chunks, "change block")} · ${result.elapsedMs} ms`
    : pending
      ? "Comparing…"
      : "Waiting for input";

  const leftLines = result?.stats.leftLines ?? countLines(left);
  const rightLines = result?.stats.rightLines ?? countLines(right);
  const simTone: "success" | "primary" | "warning" | "error" = stats ? similarityTone(stats.similarity) : "primary";
  const simText = {
    success: "text-secondary",
    primary: "text-primary-soft",
    warning: "text-warning",
    error: "text-error",
  }[simTone];

  let lastChunk = -1;

  return (
    <ToolView
      eyebrow="DIFF ENGINE"
      eyebrowTone="primary"
      eyebrowHint="MYERS LINE ALIGNMENT + TOKEN MARKS"
      title="Text Diff"
      description="Compare two blocks of text line by line with word-level highlights."
      telemetry={[
        {
          label: "Changes",
          value: stats ? fmt(stats.chunks) : "—",
          tone: "primary",
          icon: <GitCompare size={14} />,
        },
        {
          label: "Additions",
          value: stats ? `+${fmt(stats.additions)}` : "—",
          tone: "success",
          icon: <Plus size={14} />,
        },
        {
          label: "Deletions",
          value: stats ? `−${fmt(stats.deletions)}` : "—",
          tone: "error",
          icon: <Minus size={14} />,
        },
        {
          label: "Compute",
          value: result ? `${result.elapsedMs} ms` : "—",
          tone: "neutral",
          icon: <Timer size={14} />,
        },
      ]}
      toolbar={
        <>
          <SegmentedControl
            value={view}
            onChange={setView}
            options={VIEWS}
            ariaLabel="Diff layout"
          />
          <span className="text-outline/60 text-[11px] px-0.5">·</span>
          <SegmentedControl
            value={granularity}
            onChange={(value) => {
              setGranularity(value);
              setActiveChunk(null);
            }}
            options={GRANULARITIES}
            ariaLabel="Comparison granularity"
          />
          <div className="w-px h-4 bg-white/10 mx-1" aria-hidden />
          <Checkbox checked={ignoreWhitespace} onChange={setIgnoreWhitespace} label="Ignore whitespace" />
          <Checkbox checked={ignoreCase} onChange={setIgnoreCase} label="Ignore case" />
        </>
      }
      status={
        <>
          <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
            Auto-compare
            <Switch checked={autoCompare} onChange={setAutoCompare} label="Toggle auto compare" size="sm" />
          </span>
          {!autoCompare && (
            <Button size="xs" variant="primary" onClick={runCompare} disabled={empty || overLimit}>
              Compare
            </Button>
          )}
          <Button size="xs" icon={<ArrowLeftRight size={12} />} onClick={swapPanes} disabled={empty}>
            Swap
          </Button>
          <Button size="xs" icon={<Eraser size={12} />} onClick={clearAll} disabled={empty}>
            Clear
          </Button>
          <Button size="xs" variant="ghost" icon={<Sparkles size={12} />} onClick={loadSample}>
            Sample
          </Button>
        </>
      }
    >
      {overLimit && (
        <InfoNotice icon={<AlertTriangle size={12} />} tone="warning" aria-live="polite">
          Input exceeds {fmt(MAX_INPUT_CHARS)} characters in one pane. Comparison is paused so the view stays
          responsive — trim the text below {fmt(MAX_INPUT_CHARS)} characters to resume.
        </InfoNotice>
      )}

      <Card className="overflow-hidden">
        <CardHeader
          title="Input buffers"
          hint={`${fmt(left.length)} + ${fmt(right.length)} characters · limit ${fmt(MAX_INPUT_CHARS)} per pane`}
          icon={<FileText size={13} />}
          actions={
            <Badge tone={overLimit ? "error" : "neutral"} mono>
              {overLimit ? "over limit" : `${plural(leftLines + rightLines, "line")}`}
            </Badge>
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="p-2.5 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Dot tone="error" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-on-variant">Original</span>
                <span className="font-mono text-[10px] text-outline tnum">{plural(leftLines, "line")}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={clsx(
                    "font-mono text-[10px] tnum",
                    left.length > MAX_INPUT_CHARS ? "text-error font-semibold" : "text-outline",
                  )}
                >
                  {fmt(left.length)} chars
                </span>
                <IconButton
                  size="sm"
                  label="Clear original pane"
                  icon={<X size={11} />}
                  onClick={() => setLeft("")}
                  disabled={left.length === 0}
                />
              </div>
            </div>
            <CodeArea
              value={left}
              onChange={setLeft}
              ariaLabel="Original text"
              placeholder="Paste the baseline here…"
              minHeight={148}
            />
          </div>
          <div className="p-2.5 min-w-0 border-t md:border-t-0 md:border-l border-white/[0.055]">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Dot tone="success" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-on-variant">Modified</span>
                <span className="font-mono text-[10px] text-outline tnum">{plural(rightLines, "line")}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={clsx(
                    "font-mono text-[10px] tnum",
                    right.length > MAX_INPUT_CHARS ? "text-error font-semibold" : "text-outline",
                  )}
                >
                  {fmt(right.length)} chars
                </span>
                <IconButton
                  size="sm"
                  label="Clear modified pane"
                  icon={<X size={11} />}
                  onClick={() => setRight("")}
                  disabled={right.length === 0}
                />
              </div>
            </div>
            <CodeArea
              value={right}
              onChange={setRight}
              ariaLabel="Modified text"
              placeholder="Paste the changed text here…"
              minHeight={148}
            />
          </div>
        </div>
      </Card>

      <Card
        className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-white/[0.055]"
        aria-live="polite"
      >
        <StatCell
          label="Additions"
          value={stats ? `+${fmt(stats.additions)}` : "—"}
          tone="text-secondary"
          icon={<Plus size={12} />}
          sub={<span className="text-[9.5px] text-outline font-mono">{plural(rightLines, "line")} in modified</span>}
        />
        <StatCell
          label="Deletions"
          value={stats ? `−${fmt(stats.deletions)}` : "—"}
          tone="text-error"
          icon={<Minus size={12} />}
          sub={<span className="text-[9.5px] text-outline font-mono">{plural(leftLines, "line")} in original</span>}
        />
        <StatCell
          label="Unchanged"
          value={stats ? fmt(stats.unchanged) : "—"}
          tone="text-on-variant"
          icon={<GitCompare size={12} />}
          sub={<span className="text-[9.5px] text-outline font-mono">{stats ? plural(stats.modified, "modified pair") : "no overlap yet"}</span>}
        />
        <StatCell
          label="Similarity"
          value={stats ? `${stats.similarity.toFixed(1)}%` : "—"}
          tone={simText}
          icon={<Timer size={12} />}
          sub={
            <div className="w-24 pt-0.5 space-y-1">
              <Progress
                value={stats?.similarity ?? 0}
                tone={simTone}
                height={3}
                label="Text similarity"
              />
              <div className="text-[9.5px] text-outline font-mono">
                {stats ? similarityLabel(stats.similarity) : "awaiting compare"}
              </div>
            </div>
          }
        />
      </Card>

      <Card className="flex flex-col overflow-hidden min-h-[300px] flex-1">
        <CardHeader
          title={view === "split" ? "Aligned comparison" : "Unified diff"}
          hint={headerHint}
          icon={<GitCompare size={13} />}
          actions={
            <>
              {pending && (
                <Badge tone="primary" mono pulse>
                  comparing
                </Badge>
              )}
              {stale && !autoCompare && (
                <Badge tone="warning" mono>
                  edited
                </Badge>
              )}
              {result && !hasChanges && !pending && (
                <Badge tone="success" mono>
                  identical
                </Badge>
              )}
              <Button
                size="xs"
                variant="ghost"
                icon={<ChevronsUpDown size={12} />}
                onClick={() => setExpandAll((value) => !value)}
                disabled={!result || result.stats.unchanged === 0}
              >
                {expandAll ? "Collapse all" : "Expand all"}
              </Button>
              <IconButton
                size="sm"
                label="Previous change"
                icon={<ChevronUp size={13} />}
                onClick={() => stepChunk(-1)}
                disabled={!result || result.chunks.length === 0}
              />
              <IconButton
                size="sm"
                label="Next change"
                icon={<ChevronDown size={13} />}
                onClick={() => stepChunk(1)}
                disabled={!result || result.chunks.length === 0}
              />
            </>
          }
        />

        <div
          ref={scrollRef}
          role="region"
          aria-label={view === "split" ? "Side-by-side diff output" : "Unified diff output"}
          className="flex-1 min-h-0 overflow-auto bg-black/25"
        >
          {error ? (
            <div className="p-3">
              <ErrorNotice title="Comparison aborted" message={error} onRetry={runCompare} retryLabel="Try again" />
            </div>
          ) : !result ? (
            <EmptyState
              icon={<GitCompare size={18} />}
              title={empty ? "Two panes, one diff" : "Nothing compared yet"}
              description={
                empty
                  ? "Paste the original on the left and the modified text on the right. Lines are aligned with a Myers diff, paired changes are marked word by word or character by character, and unchanged runs longer than six lines collapse behind an expand control."
                  : autoCompare
                    ? "The comparison runs as soon as both panes contain text."
                    : "Auto-compare is off. Press Compare to align the buffers."
              }
              action={
                empty ? (
                  <Button size="xs" icon={<Sparkles size={12} />} onClick={loadSample} className="mt-2">
                    Load the sample diff
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div style={{ minWidth: contentWidth }}>
              {view === "split" ? (
                <div
                  className="sticky top-0 z-10 grid border-b border-white/[0.07] bg-[#12121a]/95 backdrop-blur-sm"
                  style={{ gridTemplateColumns: SPLIT_COLUMNS }}
                >
                  <div className="col-span-3 flex items-center gap-1.5 px-2 h-7 min-w-0">
                    <Dot tone="error" />
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-on-variant">
                      Original
                    </span>
                    <span className="font-mono text-[9.5px] text-outline tnum">{fmt(leftLines)} lines</span>
                  </div>
                  <div
                    className="col-span-3 flex items-center gap-1.5 px-2 h-7 min-w-0 border-l border-white/[0.06]"
                  >
                    <Dot tone="success" />
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-on-variant">
                      Modified
                    </span>
                    <span className="font-mono text-[9.5px] text-outline tnum">{fmt(rightLines)} lines</span>
                  </div>
                </div>
              ) : (
                <div
                  className="sticky top-0 z-10 grid border-b border-white/[0.07] bg-[#12121a]/95 backdrop-blur-sm h-7 items-center"
                  style={{ gridTemplateColumns: UNIFIED_COLUMNS }}
                >
                  <span className="pr-2 text-right font-mono text-[9.5px] uppercase tracking-[0.06em] text-outline">
                    old
                  </span>
                  <span className="pr-2 text-right font-mono text-[9.5px] uppercase tracking-[0.06em] text-outline border-l border-white/[0.06]">
                    new
                  </span>
                  <span />
                  <span className="px-2 font-mono text-[9.5px] uppercase tracking-[0.06em] text-outline">
                    unified hunk · {result.stats.chunks} blocks
                  </span>
                </div>
              )}

              {visibleItems.map((item) => {
                if (item.kind === "gap") {
                  return (
                    <div
                      key={`gap-${item.run}`}
                      className="flex items-center justify-center h-6 border-y border-white/[0.05] bg-primary/[0.04]"
                    >
                      <button
                        type="button"
                        onClick={() => toggleRun(item.run)}
                        aria-label={`Expand ${item.hidden} hidden unchanged lines`}
                        className="inline-flex items-center gap-1.5 h-5 px-2 rounded-md text-[10.5px] font-medium text-primary-soft hover:bg-primary/15 transition-colors duration-150"
                      >
                        <ChevronsUpDown size={11} />
                        Expand {fmt(item.hidden)} hidden lines
                      </button>
                    </div>
                  );
                }

                const row = item.row;
                const chunkStart = row.chunk >= 0 && row.chunk !== lastChunk;
                if (row.chunk >= 0) lastChunk = row.chunk;

                if (view === "split") {
                  return (
                    <SplitRow
                      key={row.key}
                      row={row}
                      active={activeChunk === row.chunk && row.chunk >= 0}
                      chunkStart={chunkStart}
                    />
                  );
                }

                const chunk = chunkStart ? result.chunks[row.chunk] : undefined;
                return (
                  <div key={row.key}>
                    {chunk && (
                      <div className="flex items-center gap-2 h-6 px-2 bg-primary/[0.07] border-y border-primary/15 font-mono text-[10px] text-primary-soft">
                        <span className="font-semibold">
                          @@ -{chunk.leftStart},{chunk.removed} +{chunk.rightStart},{chunk.added} @@
                        </span>
                        <span className="text-outline">
                          change {chunk.index + 1} of {result.chunks.length}
                        </span>
                      </div>
                    )}
                    {row.kind === "equal" ? (
                      <UnifiedRow
                        leftNo={row.leftNo}
                        rightNo={row.rightNo}
                        sign=" "
                        text={row.left}
                        segments={null}
                        tone="equal"
                      />
                    ) : row.kind === "modified" ? (
                      <>
                        <UnifiedRow
                          leftNo={row.leftNo}
                          rightNo={null}
                          sign="−"
                          text={row.left}
                          segments={row.leftSeg}
                          tone="removed"
                        />
                        <UnifiedRow
                          leftNo={null}
                          rightNo={row.rightNo}
                          sign="+"
                          text={row.right}
                          segments={row.rightSeg}
                          tone="added"
                        />
                      </>
                    ) : row.kind === "removed" ? (
                      <UnifiedRow
                        leftNo={row.leftNo}
                        rightNo={null}
                        sign="−"
                        text={row.left}
                        segments={row.leftSeg}
                        tone="removed"
                      />
                    ) : (
                      <UnifiedRow
                        leftNo={null}
                        rightNo={row.rightNo}
                        sign="+"
                        text={row.right}
                        segments={row.rightSeg}
                        tone="added"
                      />
                    )}
                  </div>
                );
              })}

              {hiddenRows > 0 && (
                <div className="flex items-center justify-center gap-2 py-2 border-t border-white/[0.05] bg-black/30">
                  <span className="font-mono text-[10px] text-outline">
                    {fmt(hiddenRows)} more rows not rendered
                  </span>
                  <Button size="xs" onClick={() => setRenderAll(true)}>
                    Render all
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-3 h-7 border-t border-white/[0.055] bg-white/[0.015]">
          <div className="flex items-center gap-3 font-mono text-[10px] text-outline min-w-0">
            <span className="truncate">
              {view === "split" ? "split · 6 columns" : "unified · diff -u"} · {granularity} marks
            </span>
            <span className="hidden sm:inline text-outline/60">
              {ignoreCase ? "case-insensitive" : "case-sensitive"} ·{" "}
              {ignoreWhitespace ? "whitespace collapsed" : "whitespace exact"}
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-outline shrink-0">
            <span className="flex items-center gap-1">
              <Kbd>[</Kbd>
              <Kbd>]</Kbd>
              <span className="ml-0.5">change</span>
            </span>
            <span className="text-outline/60">{plural(result?.chunks.length ?? 0, "block")}</span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3">
        <Card className="flex flex-col overflow-hidden min-w-0">
          <CardHeader
            title="Unified patch"
            hint={
              patchLines.length > 0
                ? `${plural(patchLines.length, "line")} · diff -u, git apply compatible`
                : "generated from the same line alignment"
            }
            icon={<FileCode2 size={13} />}
            actions={
              <Button
                size="xs"
                variant="primary"
                icon={<Copy size={12} />}
                onClick={() => void copyPatch()}
                disabled={!patch}
              >
                Copy patch
              </Button>
            }
          />
          <pre className="m-0 flex-1 min-h-[132px] max-h-[190px] overflow-auto p-2.5 font-mono text-[10.5px] leading-[16px] bg-black/35">
            {patchLines.length === 0 ? (
              <span className="text-outline">
                {result
                  ? hasChanges
                    ? "Patch is being prepared…"
                    : "No differences — the patch is empty."
                  : "Paste both sides to generate a git-compatible patch."}
              </span>
            ) : (
              patchLines.slice(0, PATCH_PREVIEW_LIMIT).map((line, index) => {
                const tone =
                  line.startsWith("diff ") || line.startsWith("--- ") || line.startsWith("+++ ")
                    ? "text-outline"
                    : line.startsWith("@@")
                      ? "text-primary-soft font-semibold"
                      : line.startsWith("+")
                        ? "text-secondary"
                        : line.startsWith("-")
                          ? "text-error"
                          : "text-on-variant/85";
                return (
                  <div key={index} className={clsx("whitespace-pre", tone)}>
                    {line.length === 0 ? " " : line}
                  </div>
                );
              })
            )}
            {patchLines.length > PATCH_PREVIEW_LIMIT && (
              <div className="pt-1 text-outline">
                + {fmt(patchLines.length - PATCH_PREVIEW_LIMIT)} more lines — copy to inspect the rest
              </div>
            )}
          </pre>
        </Card>

        <Card className="flex flex-col overflow-hidden">
          <CardHeader
            title="Change navigator"
            hint={result ? `${plural(result.chunks.length, "block")} · click to jump` : "no comparison"}
            icon={<GitCompare size={13} />}
            actions={
              <>
                <IconButton
                  size="sm"
                  label="Previous change"
                  icon={<ChevronUp size={12} />}
                  onClick={() => stepChunk(-1)}
                  disabled={!result || result.chunks.length === 0}
                />
                <IconButton
                  size="sm"
                  label="Next change"
                  icon={<ChevronDown size={12} />}
                  onClick={() => stepChunk(1)}
                  disabled={!result || result.chunks.length === 0}
                />
              </>
            }
          />
          <div className="flex-1 min-h-[132px] max-h-[190px] overflow-y-auto p-1.5 space-y-1">
            {result && result.chunks.length > 0 ? (
              result.chunks.map((chunk) => (
                <button
                  key={chunk.index}
                  type="button"
                  onClick={() => jumpToChunk(chunk.index)}
                  aria-label={`Jump to change ${chunk.index + 1}, original line ${chunk.leftStart}`}
                  aria-current={activeChunk === chunk.index ? "true" : undefined}
                  className={clsx(
                    "w-full flex items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition-colors duration-120 border",
                    activeChunk === chunk.index
                      ? "bg-primary/[0.12] border-primary/30"
                      : "bg-black/25 border-transparent hover:bg-white/[0.05]",
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[10px] text-outline w-6 shrink-0">#{chunk.index + 1}</span>
                    <span className="font-mono text-[10.5px] text-on-variant tnum truncate">
                      L{chunk.leftStart}–{chunk.leftEnd} → L{chunk.rightStart}–{chunk.rightEnd}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                    {chunk.removed > 0 && <span className="text-error">−{chunk.removed}</span>}
                    {chunk.added > 0 && <span className="text-secondary">+{chunk.added}</span>}
                  </span>
                </button>
              ))
            ) : (
              <EmptyState
                compact
                icon={<GitCompare size={16} />}
                title={result ? "No change blocks" : "No comparison yet"}
                description={result ? "The two buffers match line for line." : "Run a comparison to list its hotspots."}
              />
            )}
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-outline">
        <span className="flex items-center gap-1.5">
          <Dot tone={result && hasChanges ? "primary" : "success"} />
          {result
            ? `${plural(result.stats.chunks, "change block")} · ${plural(result.stats.modified, "paired line")} · ${
                result.stats.additions + result.stats.deletions
              } changed lines`
            : "Local computation only — nothing leaves this machine"}
        </span>
        <span className="font-mono">
          Myers · collapse &gt; {COLLAPSE_THRESHOLD} unchanged lines · cap {fmt(MAX_INPUT_CHARS)} chars ·{" "}
          {normalizeText(left).length === 0 && normalizeText(right).length === 0 ? "empty buffers" : "text/plain"}
        </span>
      </div>
    </ToolView>
  );
}
