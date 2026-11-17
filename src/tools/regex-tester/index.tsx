import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Eraser,
  Highlighter,
  Layers,
  ListTree,
  Regex,
  Replace as ReplaceIcon,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge } from "@/components/ui/Badge";
import { Button, Kbd } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CodeArea, CopyButton } from "@/components/ui/CodeArea";
import { EmptyState, ErrorNotice, Spinner } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Form";
import { Tabs } from "@/components/ui/Tabs";
import { plural } from "@/lib/format";
import { DISPLAY_LIMIT, FLAG_META, FLAG_ORDER, MAX_MATCHES, formatMs } from "./lib/engine";
import type { CapturedMatch, Flag } from "./lib/engine";
import { CHEAT_SHEET, SAMPLES } from "./lib/samples";
import { useRegexRunner } from "./lib/useRegexRunner";

const PREVIEW_LIMIT = 20_000;
const DEFAULT_TEMPLATE = "$<protocol>://$<host>:443$<path>";

type Mode = "match" | "replace";

function FlagToggle({ flag, active, onToggle }: { flag: Flag; active: boolean; onToggle: (flag: Flag) => void }) {
  const meta = FLAG_META[flag];
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${meta.name} flag (${flag})`}
      title={`${flag} — ${meta.name}: ${meta.description}`}
      onClick={() => onToggle(flag)}
      className={clsx(
        "h-5 w-5 rounded-[5px] font-mono text-[11px] font-semibold leading-none transition-colors",
        active
          ? "bg-primary-container text-on-primary shadow-[0_1px_0_rgba(255,255,255,0.22)_inset]"
          : "bg-white/[0.06] text-outline hover:bg-white/[0.12] hover:text-on-surface",
        "focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-1",
      )}
    >
      {flag}
    </button>
  );
}

/** Highlight ranges as React nodes — never an HTML string, so the text cannot inject markup. */
function buildPreview(
  text: string,
  matches: CapturedMatch[],
  selected: number | null,
  onSelect: (index: number | null) => void,
): { nodes: ReactNode[]; clipped: boolean } {
  const clipped = text.length > PREVIEW_LIMIT;
  const body = clipped ? text.slice(0, PREVIEW_LIMIT) : text;
  const nodes: ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    if (match.start > body.length) return;
    const start = Math.max(match.start, cursor);
    const end = Math.min(Math.max(match.end, start), body.length);
    if (start > cursor) nodes.push(body.slice(cursor, start));

    if (start === end) {
      nodes.push(
        <span
          key={`zero-${index}`}
          aria-hidden
          title={`Zero-width match #${index + 1} at ${start}`}
          className={clsx(
            "mx-[1px] inline-block h-[13px] w-[3px] translate-y-[2px] rounded-full",
            selected === index ? "bg-primary-soft" : "bg-tertiary",
          )}
        />,
      );
    } else {
      nodes.push(
        <mark
          key={`match-${index}`}
          title={`Match ${index + 1} · [${match.start}..${match.end}]`}
          onClick={() => onSelect(selected === index ? null : index)}
          className={clsx(
            "cursor-pointer rounded-[3px] transition-colors",
            selected === index
              ? "bg-primary/40 text-white ring-1 ring-primary-soft/70"
              : "bg-primary/[0.16] text-on-surface ring-1 ring-primary/25 hover:bg-primary/25",
          )}
        >
          {body.slice(start, end)}
        </mark>,
      );
    }

    cursor = Math.max(cursor, end);
  });

  if (cursor < body.length) nodes.push(body.slice(cursor));
  return { nodes, clipped };
}

export default function RegexTesterView() {
  const [sampleId, setSampleId] = useState(SAMPLES[0].id);
  const [pattern, setPattern] = useState(SAMPLES[0].pattern);
  const [activeFlags, setActiveFlags] = useState<Set<Flag>>(() => new Set<Flag>(["g"]));
  const [text, setText] = useState(SAMPLES[0].text);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [tab, setTab] = useState<Mode>("match");
  const [selected, setSelected] = useState<number | null>(null);
  const [showCheat, setShowCheat] = useState(false);

  const flags = useMemo(() => FLAG_ORDER.filter((flag) => activeFlags.has(flag)).join(""), [activeFlags]);
  const { evaluation, replacement, pending, mode } = useRegexRunner({
    pattern,
    flags,
    text,
    template,
    withReplace: tab === "replace",
  });

  const matches = useMemo<CapturedMatch[]>(() => (evaluation && evaluation.ok ? evaluation.matches : []), [evaluation]);
  const failure = evaluation && !evaluation.ok ? evaluation : null;
  const groupCount = evaluation && evaluation.ok ? evaluation.groupCount : 0;
  const namedCount = evaluation && evaluation.ok ? evaluation.namedGroups.length : 0;
  const zeroWidth = evaluation && evaluation.ok ? evaluation.zeroWidth : 0;
  const selectedMatch = selected !== null && selected < matches.length ? matches[selected] : null;
  const elapsed = evaluation ? formatMs(evaluation.elapsedMs) : "—";

  const preview = useMemo(() => buildPreview(text, matches, selected, setSelected), [text, matches, selected]);

  useEffect(() => {
    if (selected !== null && selected >= matches.length) setSelected(null);
  }, [matches.length, selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setShowCheat((prev) => !prev);
      }
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleFlag = (flag: Flag) => {
    setActiveFlags((prev) => {
      const next = new Set(prev);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });
  };

  const loadSample = (id: string) => {
    const sample = SAMPLES.find((entry) => entry.id === id);
    if (!sample) return;
    setSampleId(sample.id);
    setPattern(sample.pattern);
    setActiveFlags(new Set(sample.flags.split("").filter((char): char is Flag => FLAG_ORDER.includes(char as Flag))));
    setText(sample.text);
    setSelected(null);
  };

  const clearText = () => {
    setText("");
    setSelected(null);
  };

  const warnings: ReactNode[] = [];
  if (failure?.timedOut) {
    warnings.push(
      <Badge key="timeout" tone="error" dot>
        execution terminated · worker restarted
      </Badge>,
    );
  }
  if (evaluation && evaluation.ok && evaluation.budgetExceeded) {
    warnings.push(
      <Badge key="budget" tone="warning" dot>
        time budget reached · partial results
      </Badge>,
    );
  }
  if (evaluation && evaluation.ok && evaluation.truncated) {
    warnings.push(
      <Badge key="capped" tone="warning" dot>
        capped at {MAX_MATCHES} matches
      </Badge>,
    );
  }
  if (zeroWidth > 0) {
    warnings.push(
      <Badge key="zero" tone="tertiary" dot>
        {plural(zeroWidth, "zero-width match", "zero-width matches")} advanced safely
      </Badge>,
    );
  }

  const matchCountLabel = pending ? "evaluating…" : pattern.length > 0 ? plural(matches.length, "match", "matches") : "no pattern";

  return (
    <ToolView
      eyebrow="PATTERN ENGINE"
      eyebrowTone="tertiary"
      eyebrowHint="ECMASCRIPT REGEXP · WORKER ISOLATED"
      title="Regex Tester"
      description="Test patterns against sample text with live match highlighting and captured group inspection."
      telemetry={[
        {
          label: "Matches",
          value: pending ? "…" : pattern.length > 0 ? matches.length : "—",
          tone: matches.length > 0 ? "primary" : "neutral",
          icon: <Regex size={14} />,
        },
        {
          label: "Capture groups",
          value: evaluation && evaluation.ok ? groupCount : "—",
          tone: "tertiary",
          icon: <Layers size={14} />,
        },
        {
          label: "Engine time",
          value: elapsed,
          tone: failure ? "error" : evaluation ? "success" : "neutral",
          icon: <Timer size={14} />,
        },
        {
          label: "Isolation",
          value: mode === "worker" ? "worker" : "inline",
          tone: mode === "worker" ? "success" : "warning",
          icon: <ShieldCheck size={14} />,
        },
      ]}
      headerExtra={
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
              <Regex size={12} className="text-primary" />
              Active regular expression
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10px]">
              <span
                className={clsx(
                  "inline-flex items-center gap-1",
                  failure ? "text-error" : evaluation ? "text-secondary" : "text-outline",
                )}
              >
                {failure ? <AlertTriangle size={11} /> : evaluation ? <Check size={11} /> : <Regex size={11} />}
                {failure ? "invalid pattern" : evaluation ? "valid pattern" : "no pattern"}
              </span>
              <span aria-hidden className="text-outline-variant">
                •
              </span>
              <span className="text-on-variant tnum">{pattern.length} chars</span>
              <span aria-hidden className="text-outline-variant">
                •
              </span>
              <span className="text-tertiary tnum">
                {groupCount} groups{namedCount > 0 ? ` · ${namedCount} named` : ""}
              </span>
              <span aria-hidden className="text-outline-variant">
                •
              </span>
              <span className="text-outline tnum" aria-live="polite">
                {pending ? "evaluating…" : evaluation ? `ran in ${elapsed}` : "idle"}
              </span>
            </div>
          </div>

          <div
            className={clsx(
              "flex flex-col gap-2 rounded-xl border bg-black/40 px-2 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] transition-colors duration-150 lg:flex-row lg:items-center",
              failure ? "border-error/45" : "border-white/[0.075] focus-within:border-primary/60",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <span aria-hidden className="select-none font-mono text-[16px] font-bold text-primary">
                /
              </span>
              <input
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                aria-label="Regular expression pattern"
                aria-invalid={failure ? true : undefined}
                placeholder="(?<name>pattern)"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[13px] tracking-tight text-primary-soft outline-none placeholder:text-outline/60"
              />
              <span aria-hidden className="select-none font-mono text-[16px] font-bold text-primary">
                /
              </span>
              <span
                aria-label={`Flags: ${flags || "none"}`}
                className="shrink-0 select-none font-mono text-[12px] font-semibold text-secondary"
              >
                {flags || "—"}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1 border-t border-white/[0.07] pt-1.5 lg:border-l lg:border-t-0 lg:pl-2 lg:pt-0">
              {FLAG_ORDER.map((flag) => (
                <FlagToggle key={flag} flag={flag} active={activeFlags.has(flag)} onToggle={toggleFlag} />
              ))}
              <span aria-hidden className="mx-1 h-4 w-px bg-white/10" />
              <CopyButton text={`/${pattern}/${flags}`} label="Copy" size="xs" />
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
              {warnings}
            </div>
          )}
        </div>
      }
      toolbar={
        <>
          <div className="w-52">
            <Select
              aria-label="Load a sample pattern"
              value={sampleId}
              onChange={(event) => loadSample(event.target.value)}
              options={SAMPLES.map((sample) => ({ value: sample.id, label: sample.label }))}
              sizeVariant="sm"
            />
          </div>
          <Button
            variant={showCheat ? "default" : "ghost"}
            icon={<BookOpen size={13} />}
            onClick={() => setShowCheat((prev) => !prev)}
            aria-expanded={showCheat}
            aria-controls="regex-cheat-sheet"
            trailing={<Kbd>⌘/</Kbd>}
          >
            Cheat sheet
          </Button>
          <Button variant="ghost" icon={<Eraser size={13} />} onClick={clearText} disabled={text.length === 0}>
            Clear test text
          </Button>
        </>
      }
      status={
        <>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-outline" aria-live="polite">
            {pending ? <Spinner size={11} /> : <Check size={11} className={failure ? "text-error" : "text-secondary"} />}
            <span className="tnum">
              {pending ? "evaluating…" : evaluation ? `${matchCountLabel} · ${elapsed}` : "idle"}
            </span>
          </span>
          <Badge tone={mode === "worker" ? "success" : "warning"} mono dot>
            {mode === "worker" ? "web worker" : "inline fallback"}
          </Badge>
        </>
      }
    >
      {failure && (
        <ErrorNotice
          title={failure.timedOut ? "Evaluation terminated" : "Invalid regular expression"}
          message={failure.error}
        />
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="flex min-w-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.055] px-2">
            <div className="-mb-px min-w-0">
              <Tabs
                ariaLabel="Result mode"
                value={tab}
                onChange={setTab}
                items={[
                  { value: "match", label: "Match view", icon: <Highlighter size={12} />, count: matches.length },
                  { value: "replace", label: "Replace preview", icon: <ReplaceIcon size={12} /> },
                ]}
              />
            </div>
            <span className="flex items-center gap-2 py-1 font-mono text-[10px] text-outline">
              {zeroWidth > 0 && <span className="text-tertiary">{zeroWidth} zero-width</span>}
              <span className="tnum">{text.length.toLocaleString("en-US")} chars</span>
            </span>
          </div>

          {tab === "replace" && (
            <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.055] bg-tertiary/[0.04] px-3 py-2">
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-tertiary">Substitution</span>
              <div className="min-w-[200px] flex-1">
                <Input
                  mono
                  sizeVariant="sm"
                  value={template}
                  onChange={(event) => setTemplate(event.target.value)}
                  aria-label="Replacement template"
                  placeholder="$<name> or $1"
                  spellCheck={false}
                />
              </div>
              <Badge tone="tertiary" mono dot>
                {replacement && replacement.ok ? `${replacement.count} replaced` : "—"}
              </Badge>
            </div>
          )}

          <div className="px-2.5 pt-2.5">
            <CodeArea
              value={text}
              onChange={setText}
              minHeight={168}
              ariaLabel="Test text"
              wrap
              placeholder="Paste the text to test here…"
              toolbar={
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">Test text</span>
                  <span className="font-mono text-[10px] text-outline tnum">
                    {text.length.toLocaleString("en-US")} chars · {text.split("\n").length} lines
                  </span>
                </div>
              }
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-2.5">
            {tab === "match" ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/[0.07] bg-black/35">
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.055] bg-white/[0.02] px-2.5 py-1.5">
                  <span className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">
                    <Highlighter size={11} className="text-primary" />
                    Highlighted preview
                  </span>
                  <span className="font-mono text-[10px] text-outline tnum" aria-live="polite">
                    {matchCountLabel}
                    {preview.clipped ? ` · first ${PREVIEW_LIMIT.toLocaleString("en-US")} chars` : ""}
                  </span>
                </div>
                <div
                  role="region"
                  aria-label="Test text with highlighted matches"
                  className="max-h-[300px] min-h-[150px] flex-1 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[11.5px] leading-[19px] text-on-variant"
                >
                  {pattern.length === 0 ? (
                    <span className="text-outline/70">Type a pattern above to highlight matches in the test text.</span>
                  ) : text.length === 0 ? (
                    <span className="text-outline/70">The test text is empty.</span>
                  ) : (
                    preview.nodes
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.055] bg-white/[0.015] px-2.5 py-1.5 font-mono text-[10px]">
                  <span className="text-on-variant tnum">
                    {selectedMatch && selected !== null ? (
                      <>
                        Match <span className="text-primary-soft">#{selected + 1}</span> · pos [{selectedMatch.start}..
                        {selectedMatch.end}] · {selectedMatch.end - selectedMatch.start} chars
                      </>
                    ) : (
                      <span className="text-outline">{matches.length > 0 ? "No match selected" : "Nothing to inspect"}</span>
                    )}
                  </span>
                  <span className="text-outline">Click a highlight to isolate it</span>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">
                    <ReplaceIcon size={11} className="text-tertiary" />
                    Replacement output
                  </span>
                  <span className="flex items-center gap-2">
                    {replacement && replacement.ok && (
                      <span className="font-mono text-[10px] text-outline tnum">{formatMs(replacement.elapsedMs)}</span>
                    )}
                    <CopyButton
                      text={replacement && replacement.ok ? replacement.output : ""}
                      label="Copy"
                      size="xs"
                    />
                  </span>
                </div>
                {replacement && !replacement.ok ? (
                  <ErrorNotice title="Replacement failed" message={replacement.error} />
                ) : (
                  <CodeArea
                    readOnly
                    wrap
                    value={replacement && replacement.ok ? replacement.output : ""}
                    minHeight={196}
                    ariaLabel="Replacement output"
                    className="flex-1"
                  />
                )}
                {replacement && replacement.ok && replacement.truncated && (
                  <Badge tone="warning" dot>
                    output truncated{replacement.budgetExceeded ? " · time budget reached" : ""}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card className="flex min-w-0 flex-col overflow-hidden">
          <CardHeader
            title="Match & capture breakdown"
            hint={
              pattern.length === 0
                ? "Waiting for a pattern"
                : failure
                  ? "Pattern does not compile"
                  : `${plural(matches.length, "match", "matches")} · ${groupCount} capture groups`
            }
            icon={<ListTree size={13} />}
            actions={
              <>
                <Badge tone={matches.length > 0 ? "primary" : "neutral"} mono>
                  <span aria-live="polite">{matches.length}</span>
                </Badge>
              </>
            }
          />
          <div className="max-h-[480px] min-h-0 flex-1 space-y-2 overflow-y-auto p-2 xl:max-h-none">
            {pattern.length === 0 ? (
              <EmptyState
                compact
                icon={<Regex size={16} />}
                title="No pattern loaded"
                description="Pick a sample or type a pattern to start matching."
              />
            ) : failure ? (
              <EmptyState
                compact
                icon={<AlertTriangle size={16} />}
                title="Pattern does not compile"
                description="The engine reported the exact syntax error above."
              />
            ) : matches.length === 0 ? (
              <EmptyState
                compact
                icon={<Regex size={16} />}
                title="No matches"
                description="The pattern is valid but nothing in the test text matches it."
              />
            ) : (
              matches.slice(0, DISPLAY_LIMIT).map((match, index) => {
                const active = selected === index;
                const empty = match.text.length === 0;
                return (
                  <article
                    key={`${match.start}-${match.end}-${index}`}
                    className={clsx(
                      "space-y-1.5 rounded-xl border p-2 transition-colors",
                      active
                        ? "border-primary/45 bg-primary/[0.07]"
                        : "border-white/[0.06] bg-white/[0.025] hover:border-white/[0.12] hover:bg-white/[0.045]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected(active ? null : index)}
                        aria-pressed={active}
                        aria-label={`Inspect match ${index + 1}, characters ${match.start} to ${match.end}`}
                        className="flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-2"
                      >
                        <span
                          className={clsx(
                            "rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold",
                            active ? "bg-primary text-white" : "bg-primary/20 text-primary-soft",
                          )}
                        >
                          #{index + 1}
                        </span>
                        <span className="font-mono text-[10px] text-outline tnum">
                          [{match.start}..{match.end}]
                        </span>
                        {empty && (
                          <Badge tone="warning" className="h-4">
                            zero-width
                          </Badge>
                        )}
                      </button>
                      <CopyButton text={match.text} label="Copy" size="xs" disabled={empty} />
                    </div>

                    <div
                      className={clsx(
                        "break-all rounded-md border border-white/[0.05] bg-black/35 px-2 py-1 font-mono text-[11px]",
                        empty ? "italic text-outline/70" : "text-on-surface",
                      )}
                    >
                      {empty ? "(empty match)" : match.text}
                    </div>

                    {match.groups.length > 0 && (
                      <div className="grid grid-cols-1 gap-1 2xl:grid-cols-2">
                        {match.groups.map((group) => {
                          const value = group.value;
                          return (
                            <div
                              key={group.number}
                              className="group/row flex min-w-0 items-center justify-between gap-2 rounded-md border border-white/[0.045] bg-white/[0.035] px-1.5 py-1"
                            >
                              <span className="flex shrink-0 items-baseline gap-1">
                                <span
                                  className={clsx(
                                    "font-mono text-[10px] font-semibold",
                                    group.name ? "text-primary-soft" : "text-outline",
                                  )}
                                >
                                  {group.name ?? `$${group.number}`}
                                </span>
                                {group.name && <span className="font-mono text-[9px] text-outline/70">${group.number}</span>}
                              </span>
                              <span className="flex min-w-0 items-center gap-1">
                                <span
                                  className={clsx(
                                    "truncate font-mono text-[10.5px]",
                                    value === null ? "italic text-outline/60" : "text-on-surface",
                                  )}
                                  title={value ?? "Group did not participate in this match"}
                                >
                                  {value === null ? "undefined" : value.length === 0 ? "(empty)" : value}
                                </span>
                                <CopyButton
                                  text={value ?? ""}
                                  label="Copy"
                                  size="xs"
                                  disabled={value === null || value.length === 0}
                                  className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
                                />
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
          {matches.length > DISPLAY_LIMIT && (
            <div className="border-t border-white/[0.055] px-3 py-1.5 font-mono text-[10px] text-outline">
              Showing first {DISPLAY_LIMIT} of {matches.length} matches
            </div>
          )}
        </Card>
      </div>

      <Card className="shrink-0 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowCheat((prev) => !prev)}
          aria-expanded={showCheat}
          aria-controls="regex-cheat-sheet"
          className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-[-2px]"
        >
          <span className="flex items-center gap-2 text-[12px] font-semibold text-on-surface">
            <BookOpen size={13} className="text-tertiary" />
            Syntax cheat sheet
            <span className="text-[10px] font-normal text-outline">ECMAScript RegExp</span>
          </span>
          <span className="flex items-center gap-2 text-[10px] text-outline">
            <span className="font-mono tnum">{CHEAT_SHEET.reduce((sum, group) => sum + group.entries.length, 0)} tokens</span>
            <Kbd>⌘/</Kbd>
            <ChevronDown
              size={13}
              className={clsx("transition-transform duration-150", showCheat && "rotate-180")}
            />
          </span>
        </button>
        {showCheat && (
          <div
            id="regex-cheat-sheet"
            className="grid grid-cols-1 gap-2 px-3 pb-3 pt-0.5 md:grid-cols-2 xl:grid-cols-3"
          >
            {CHEAT_SHEET.map((group) => (
              <div key={group.title} className="rounded-lg border border-white/[0.06] bg-black/25 p-2">
                <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">{group.title}</div>
                <div className="mt-1.5 space-y-1">
                  {group.entries.map((entry) => (
                    <div key={entry.token} className="flex min-w-0 items-baseline gap-1.5">
                      <code
                        className="w-[78px] shrink-0 truncate font-mono text-[10.5px] text-primary-soft"
                        title={entry.token}
                      >
                        {entry.token}
                      </code>
                      <span className="text-[10px] leading-snug text-on-variant/75">{entry.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </ToolView>
  );
}
