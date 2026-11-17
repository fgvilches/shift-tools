import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  Globe2,
  Quote,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input, Switch } from "@/components/ui/Form";
import { EmptyState, InfoNotice } from "@/components/ui/Feedback";
import { toast } from "@/components/ui/Toast";
import { duration, number, plural } from "@/lib/format";
import {
  MAX_STEPS,
  densityByHour,
  nextRuns,
  parseSchedule,
  type FieldKey,
  type ParsedField,
} from "./lib/cron";

const RUN_COUNT = 8;
const DEFAULT_EXPRESSION = "*/15 8-18 * * 1-5";

const PRESETS = [
  { label: "Every 5 min", expression: "*/5 * * * *" },
  { label: "Hourly", expression: "0 * * * *" },
  { label: "Daily 02:00", expression: "0 2 * * *" },
  { label: "Weekdays 09:00", expression: "0 9 * * 1-5" },
  { label: "Monthly 1st", expression: "0 0 1 * *" },
  { label: "Sundays", expression: "0 0 * * 0" },
] as const;

const FIELD_ACCENT: Record<FieldKey, { text: string; chip: string }> = {
  second: { text: "text-on-variant", chip: "bg-white/[0.05] border-white/12" },
  minute: { text: "text-primary-soft", chip: "bg-primary/12 border-primary/30" },
  hour: { text: "text-[#8ff0a4]", chip: "bg-secondary/12 border-secondary/25" },
  dayOfMonth: { text: "text-[#dda6ff]", chip: "bg-tertiary/12 border-tertiary/25" },
  month: { text: "text-on-surface", chip: "bg-white/[0.05] border-white/12" },
  dayOfWeek: { text: "text-[#ffe066]", chip: "bg-warning/12 border-warning/25" },
};

function relativeIn(target: Date, now: Date): string {
  const diff = Math.round((target.getTime() - now.getTime()) / 1000);
  if (diff <= 0) return "now";
  return `in ${duration(diff)}`;
}

function clockOf(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function dateOf(date: Date): string {
  return date.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function weekdayOf(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function absoluteStamp(date: Date): string {
  return `${dateOf(date)} ${clockOf(date)}`;
}

function shortZone(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date());
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "local";
}

interface RunRow {
  key: number;
  index: number;
  date: Date;
}

export default function CronValidatorView() {
  const [draft, setDraft] = useState(DEFAULT_EXPRESSION);
  const [withSeconds, setWithSeconds] = useState(false);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const minuteKey = Math.floor(now.getTime() / 60000);
  const tzShort = useMemo(() => shortZone(), [minuteKey]);
  const tzIana = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "local", []);

  const parsed = useMemo(() => parseSchedule(draft, withSeconds), [draft, withSeconds]);

  const projection = useMemo(() => {
    const from = new Date();
    return { from, ...nextRuns(parsed, from, RUN_COUNT) };
  }, [parsed, minuteKey, revision]);

  const density = useMemo(() => densityByHour(parsed, 7, new Date()), [parsed, minuteKey]);

  const refreshProjection = useCallback(() => {
    setNow(new Date());
    setRevision((value) => value + 1);
    toast.info("Projection refreshed", `Anchored to ${clockOf(new Date())} · ${tzShort}`);
  }, [tzShort]);

  const copyText = useCallback(async (text: string, label: string) => {
    if (!text) return;
    if (!navigator.clipboard) {
      toast.error("Clipboard unavailable", "This environment does not expose the Clipboard API.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`, text.split("\n")[0]);
    } catch (error) {
      toast.error("Clipboard write failed", error instanceof Error ? error.message : String(error));
    }
  }, []);

  const scheduleText = useMemo(() => {
    if (!parsed.ok) return "";
    const lines = [
      `Cron: ${parsed.input.trim()}`,
      `Meaning: ${parsed.summary}`,
      `Time zone: ${tzIana} (${tzShort})`,
      "",
    ];
    projection.runs.forEach((run, index) => {
      lines.push(
        `${String(index + 1).padStart(2, " ")}. ${absoluteStamp(run)} · ${weekdayOf(run)} · ${relativeIn(run, now)}`,
      );
    });
    if (projection.exhausted) {
      lines.push("", `Projection incomplete after ${number(MAX_STEPS)} candidate steps.`);
    }
    return lines.join("\n");
  }, [parsed, projection, now, tzIana, tzShort]);

  const expressionTokens = useMemo(
    () => (draft.trim() ? draft.trim().split(/\s+/) : []),
    [draft],
  );
  const aligned = expressionTokens.length === parsed.fields.length || parsed.macro !== null;
  const hasInput = draft.trim().length > 0;
  const validFields = parsed.fields.filter((field) => field.raw !== "" && field.error === null).length;

  const toggleSeconds = useCallback(
    (next: boolean) => {
      if (next === withSeconds) return;
      const tokens = draft.trim() ? draft.trim().split(/\s+/) : [];
      if (next && tokens.length === 5) {
        setDraft(`0 ${tokens.join(" ")}`);
      } else if (!next && tokens.length === 6) {
        setDraft(tokens.slice(1).join(" "));
      }
      setWithSeconds(next);
    },
    [draft, withSeconds],
  );

  const loadPreset = useCallback(
    (expression: string) => {
      setDraft(withSeconds ? `0 ${expression}` : expression);
    },
    [withSeconds],
  );

  const todayTotal = density.length > 0 ? density[0]!.total : 0;
  const weekTotal = density.reduce((sum, day) => sum + day.total, 0);
  const densityMax = density.reduce(
    (max, day) => Math.max(max, ...day.counts),
    0,
  );

  const runs: RunRow[] = projection.runs.map((date, index) => ({
    key: date.getTime(),
    index: index + 1,
    date,
  }));

  const columns: Column<RunRow>[] = [
    {
      key: "index",
      header: "#",
      align: "right",
      width: 38,
      mono: true,
      render: (row) => (
        <span className={row.index === 1 ? "text-[#8ff0a4] font-semibold" : "text-outline"}>
          {String(row.index).padStart(2, "0")}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      width: 96,
      mono: true,
      render: (row) => <span className="text-on-surface">{dateOf(row.date)}</span>,
    },
    {
      key: "time",
      header: "Absolute time",
      width: 92,
      mono: true,
      render: (row) => <span className={row.index === 1 ? "text-primary-soft" : "text-on-variant"}>{clockOf(row.date)}</span>,
    },
    {
      key: "weekday",
      header: "Weekday",
      width: 104,
      render: (row) => <span className="text-on-variant">{weekdayOf(row.date)}</span>,
    },
    {
      key: "relative",
      header: "Relative",
      align: "right",
      width: 118,
      render: (row) => (
        <Badge tone={row.index === 1 ? "success" : "neutral"} mono dot={row.index === 1}>
          {relativeIn(row.date, now)}
        </Badge>
      ),
    },
  ];

  const tokenViews = aligned
    ? parsed.fields.map((field) => ({
        raw: field.raw,
        label: field.label,
        invalid: field.error !== null,
        accent: FIELD_ACCENT[field.key],
        key: field.key,
      }))
    : expressionTokens.map((raw, index) => ({
        raw,
        label: parsed.macro && index === 0 ? "shortcut" : `field ${index + 1}`,
        invalid: !parsed.ok,
        accent: { text: "text-on-variant", chip: "bg-white/[0.05] border-white/12" },
        key: `${raw}-${index}`,
      }));

  const emptyRuns = () => {
    if (!parsed.ok) {
      return (
        <EmptyState
          compact
          icon={<AlertTriangle size={15} />}
          title="No projection yet"
          description="Fix the expression above, then the next executions are projected here."
        />
      );
    }
    return (
      <EmptyState
        compact
        icon={<CalendarClock size={15} />}
        title="No execution inside the search budget"
        description={`The bounded search stopped after ${number(MAX_STEPS)} candidate steps. The schedule may name a date that never occurs, such as 30 February.`}
      />
    );
  };

  return (
    <ToolView
      eyebrow="SCHEDULE PARSER"
      eyebrowTone="warning"
      eyebrowHint={withSeconds ? "POSIX + SECONDS · 6-FIELD" : "STANDARD POSIX · 5-FIELD"}
      title="Cron Validator"
      description="Validate cron expressions, explain each field, and project the next scheduled runs."
      telemetry={[
        {
          label: "Fields",
          value: `${validFields}/${parsed.fields.length}`,
          tone: parsed.ok ? "success" : hasInput ? "error" : "neutral",
          icon: parsed.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />,
        },
        {
          label: "Next run",
          value: runs[0] ? relativeIn(runs[0].date, now) : "—",
          tone: "primary",
          icon: <Clock3 size={14} />,
        },
        {
          label: "Today",
          value: parsed.ok ? number(todayTotal) : "—",
          tone: "neutral",
          icon: <CalendarDays size={14} />,
        },
        {
          label: "Time zone",
          value: tzShort,
          tone: "neutral",
          icon: <Globe2 size={14} />,
        },
      ]}
      toolbar={
        <>
          <Button
            variant="primary"
            icon={<RefreshCw size={13} />}
            onClick={refreshProjection}
            trailing={<Kbd>↵</Kbd>}
          >
            Project
          </Button>
          <Button
            icon={<Copy size={13} />}
            onClick={() => void copyText(draft.trim(), "Expression")}
            disabled={!hasInput}
          >
            Copy expression
          </Button>
          <Button
            icon={<ClipboardList size={13} />}
            onClick={() => void copyText(scheduleText, "Schedule")}
            disabled={!parsed.ok || runs.length === 0}
          >
            Copy schedule
          </Button>
        </>
      }
      status={
        <>
          <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
            Seconds field
            <Switch
              checked={withSeconds}
              onChange={toggleSeconds}
              label="Include an explicit seconds field (6-field expression)"
              size="sm"
            />
          </span>
          <Badge tone={parsed.ok ? "success" : hasInput ? "error" : "neutral"} dot mono>
            {parsed.ok ? "VALID" : hasInput ? "INVALID" : "IDLE"}
          </Badge>
          <Badge tone="neutral" mono>
            {tzShort}
          </Badge>
        </>
      }
    >
      <Card className="p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SectionLabel>Expression</SectionLabel>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-outline">
              {withSeconds ? "sec min hour dom month dow" : "min hour dom month dow"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {parsed.macro && (
              <Badge tone="tertiary" mono>
                {parsed.macro}
              </Badge>
            )}
            <Badge tone={parsed.ok ? "success" : "error"} dot mono>
              {parsed.ok ? `VALID · ${parsed.usesSeconds ? 6 : 5} FIELDS` : "INVALID"}
            </Badge>
            <IconButton
              label="Reset expression to the default"
              icon={<RotateCcw size={12} />}
              onClick={() => setDraft(withSeconds ? `0 ${DEFAULT_EXPRESSION}` : DEFAULT_EXPRESSION)}
            />
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            refreshProjection();
          }}
          aria-label="Cron expression form"
        >
          <label htmlFor="cron-expression" className="sr-only">
            Cron expression
          </label>
          <Input
            id="cron-expression"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={withSeconds ? "0 */15 8-18 * * 1-5" : "*/15 8-18 * * 1-5"}
            aria-label="Cron expression"
            aria-invalid={!parsed.ok && hasInput ? true : undefined}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            mono
            invalid={!parsed.ok && hasInput}
            className="px-3.5 tracking-[0.02em]"
            style={{ height: 48, fontSize: 20, lineHeight: "28px" }}
            leading={<TerminalGlyph />}
          />
        </form>

        <div
          role="group"
          aria-label="Expression split into cron fields"
          className="flex flex-wrap items-start gap-1.5 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5"
        >
          {tokenViews.length === 0 && (
            <span className="font-mono text-[11px] text-outline py-1">Awaiting an expression…</span>
          )}
          {tokenViews.map((token, index) => (
            <div key={token.key} className="flex flex-col items-center gap-0.5">
              <span
                className={clsx(
                  "font-mono text-[15px] leading-5 px-2 py-1 rounded-md border transition-colors",
                  token.invalid ? "border-error/45 bg-error/10 text-[#ff8b81]" : token.accent.chip,
                  !token.invalid && token.accent.text,
                )}
              >
                {token.raw || "—"}
              </span>
              <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-outline">
                {token.label}
              </span>
              {index < tokenViews.length - 1 && <span className="sr-only">field separator</span>}
            </div>
          ))}
          <span className="ml-auto self-center font-mono text-[9.5px] text-outline">
            {tokenViews.length} token{tokenViews.length === 1 ? "" : "s"}
          </span>
        </div>

        {aligned && (
          <div
            className={clsx(
              "grid grid-cols-2 sm:grid-cols-3 gap-1.5",
              parsed.usesSeconds ? "xl:grid-cols-6" : "xl:grid-cols-5",
            )}
          >
            {parsed.fields.map((field) => (
              <FieldCard key={field.key} field={field} />
            ))}
          </div>
        )}

        {parsed.problems.length > 0 ? (
          <div role="alert" className="rounded-xl border border-error/30 bg-error/[0.06] px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#ffb4ab]">
              <AlertTriangle size={13} />
              {plural(parsed.problems.length, "validation error")}
            </div>
            <ul className="space-y-1">
              {parsed.problems.map((problem) => (
                <li key={`${problem.field}-${problem.message}`} className="flex items-start gap-2">
                  <span className="mt-[1px] shrink-0 rounded bg-error/15 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[#ffb4ab]">
                    {problem.label}
                  </span>
                  <span className="text-[11px] leading-[16px] text-on-variant/90">{problem.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2.5">
            <div className="flex items-start gap-2.5 min-w-0">
              <span className="w-7 h-7 rounded-full bg-primary/15 text-primary-soft flex items-center justify-center shrink-0">
                <Quote size={13} />
              </span>
              <div className="min-w-0">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-outline">
                  Natural language schedule
                </div>
                <p className="text-[13px] font-medium leading-[19px] text-on-surface">{parsed.summary}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 lg:pl-3">
              <span className="font-mono text-[9.5px] text-outline">{parsed.expression}</span>
              <Badge tone="success" dot>
                Valid
              </Badge>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <SectionLabel trailing={<span className="font-mono text-[9.5px] text-outline">local time</span>}>
            Common presets
          </SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => {
              const expression = withSeconds ? `0 ${preset.expression}` : preset.expression;
              const active = draft.trim().replace(/\s+/g, " ") === expression;
              return (
                <button
                  key={preset.label}
                  type="button"
                  aria-label={`Load preset ${preset.label}: ${expression}`}
                  aria-pressed={active}
                  onClick={() => loadPreset(preset.expression)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] transition-colors",
                    active
                      ? "border-primary/45 bg-primary/15 text-on-surface"
                      : "border-white/[0.07] bg-black/30 text-on-variant hover:text-on-surface hover:border-white/20 hover:bg-white/[0.05]",
                  )}
                >
                  <span>{preset.label}</span>
                  <code className="font-mono text-[9.5px] text-primary-soft">{expression}</code>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_332px] gap-3">
        <Card className="flex flex-col overflow-hidden min-w-0">
          <CardHeader
            title="Upcoming executions"
            hint={`Next ${RUN_COUNT} runs · anchored ${clockOf(projection.from)} · ${tzShort}`}
            icon={<CalendarClock size={13} />}
            actions={
              <>
                <Badge tone={projection.exhausted ? "warning" : "primary"} mono>
                  {projection.runs.length}/{RUN_COUNT}
                </Badge>
                <Badge tone="neutral" mono>
                  {number(projection.steps)} steps
                </Badge>
              </>
            }
          />
          {parsed.ok && projection.exhausted && (
            <div className="px-3 pt-2.5">
              <InfoNotice tone="warning" icon={<AlertTriangle size={12} />}>
                Bounded search stopped after {number(MAX_STEPS)} candidate steps with{" "}
                {plural(projection.runs.length, "run")} of {RUN_COUNT} found. The expression may target a date that never
                occurs (30 February) or a window far beyond the cap.
              </InfoNotice>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto">
            <DataTable
              ariaLabel="Next scheduled executions"
              columns={columns}
              rows={runs}
              rowKey={(row) => row.key}
              dense
              rowTone={(row) => (row.index === 1 ? "success" : null)}
              empty={emptyRuns()}
              footer={
                <tr>
                  <td colSpan={columns.length} className="px-2 h-7">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-outline">
                      <span>
                        {parsed.ok
                          ? `${plural(projection.runs.length, "execution")} projected · ${parsed.expression}`
                          : "Projection paused until the expression is valid"}
                      </span>
                      <span>
                        {projection.from.toLocaleTimeString("en-GB", { hour12: false })} local · {tzIana}
                      </span>
                    </div>
                  </td>
                </tr>
              }
            />
          </div>
        </Card>

        <div className="flex flex-col gap-3 min-w-0">
          <Card className="p-3 space-y-2.5">
            <SectionLabel trailing={<Badge tone="primary" mono>{parsed.usesSeconds ? "6-field" : "5-field"}</Badge>}>
              Cadence
            </SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Today" value={parsed.ok ? number(todayTotal) : "—"} hint="calendar day" tone="neutral" />
              <Metric
                label="Next 7 days"
                value={parsed.ok ? number(weekTotal) : "—"}
                hint="calendar days"
                tone="primary"
              />
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/30 px-2.5 py-2 space-y-1.5 font-mono text-[10px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-outline">Next execution</span>
                <span className="text-on-surface tnum">{runs[0] ? absoluteStamp(runs[0].date) : "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-outline">Relative</span>
                <span className="text-primary-soft tnum">{runs[0] ? relativeIn(runs[0].date, now) : "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-outline">Anchor</span>
                <span className="text-on-variant tnum">{clockOf(projection.from)}</span>
              </div>
            </div>
            <p className="text-[10.5px] leading-[15px] text-outline">
              {parsed.dayRule || "The day-of-month / day-of-week rule appears once the expression parses."}
            </p>
            <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
              <span className="text-[10px] text-outline">Time zone</span>
              <span className="font-mono text-[9.5px] text-on-variant truncate" title={tzIana}>
                {tzIana} · {tzShort}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="xs"
                block
                icon={<Copy size={11} />}
                onClick={() => void copyText(draft.trim(), "Expression")}
                disabled={!hasInput}
              >
                Copy expression
              </Button>
              <Button
                size="xs"
                block
                icon={<ClipboardList size={11} />}
                onClick={() => void copyText(scheduleText, "Schedule")}
                disabled={!parsed.ok || runs.length === 0}
              >
                Copy schedule
              </Button>
            </div>
            <p className="font-mono text-[9px] leading-[13px] text-outline">
              Bounded local search · cap {number(MAX_STEPS)} steps · no backend, no fabricated runs.
            </p>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="7-day firing density"
          hint="Runs per local hour across the next seven calendar days."
          icon={<CalendarDays size={13} />}
          actions={
            <div className="flex items-center gap-2.5 font-mono text-[9px] text-outline">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-[3px] border border-white/[0.05] bg-white/[0.035]" /> idle
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-[3px] border border-primary/20 bg-primary/25" /> low
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-[3px] border border-primary/30 bg-primary/50" /> busy
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-[3px] border border-secondary/40 bg-secondary/80" /> peak
              </span>
            </div>
          }
        />
        <div className="p-3">
          {density.length === 0 ? (
            <EmptyState
              compact
              icon={<CalendarDays size={15} />}
              title="No density projection"
              description="Parse a valid expression to see how its firings distribute over the week."
            />
          ) : (
            <div className="overflow-x-auto">
              <div
                role="img"
                aria-label={`Hourly firing density for ${parsed.summary} — ${density
                  .map((day) => `${day.weekday}: ${day.total} runs`)
                  .join(", ")}`}
                className="min-w-[600px] space-y-[3px]"
              >
                <div className="grid grid-cols-[70px_repeat(24,minmax(0,1fr))] gap-[3px]">
                  <span />
                  {Array.from({ length: 24 }, (_, hour) => (
                    <span
                      key={hour}
                      className="text-center font-mono text-[8.5px] leading-3 text-outline"
                    >
                      {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
                    </span>
                  ))}
                </div>
                {density.map((day) => (
                  <div
                    key={day.date.getTime()}
                    className="grid grid-cols-[70px_repeat(24,minmax(0,1fr))] gap-[3px] items-center"
                  >
                    <span className="font-mono text-[9.5px] text-on-variant truncate">
                      {day.weekday.slice(0, 3)}{" "}
                      <span className="text-outline">{day.date.getDate()}</span>
                    </span>
                    {day.counts.map((count, hour) => (
                      <div
                        key={hour}
                        title={`${day.weekday} ${dateOf(day.date)} ${String(hour).padStart(2, "0")}:00 — ${count} ${
                          count === 1 ? "run" : "runs"
                        }`}
                        className={clsx(
                          "h-4 rounded-[3px] border transition-colors",
                          count === 0
                            ? "bg-white/[0.035] border-white/[0.04]"
                            : densityScale(count, densityMax),
                        )}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2 font-mono text-[9.5px] text-outline">
                <span>
                  {plural(density.length, "day")} · {plural(weekTotal, "firing")} in view · peak cell{" "}
                  {plural(densityMax, "run")}
                </span>
                <span>{parsed.ok ? parsed.summary : ""}</span>
              </div>
            </div>
          )}
        </div>
      </Card>
    </ToolView>
  );
}

function densityScale(count: number, max: number): string {
  const ratio = count / Math.max(1, max);
  if (ratio < 0.2) return "bg-primary/20 border-primary/20";
  if (ratio < 0.5) return "bg-primary/40 border-primary/30";
  if (ratio < 0.85) return "bg-secondary/45 border-secondary/30";
  return "bg-secondary/80 border-secondary/40";
}

function TerminalGlyph() {
  return <span className="font-mono text-[16px] leading-none text-primary-soft">$</span>;
}

function FieldCard({ field }: { field: ParsedField }) {
  const accent = FIELD_ACCENT[field.key];
  const pending = field.raw === "";
  return (
    <div
      className={clsx(
        "rounded-lg border bg-black/25 px-2.5 py-2 space-y-1 min-w-0",
        field.error ? "border-error/35" : "border-white/[0.07]",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">{field.label}</span>
        <span className={clsx("font-mono text-[8.5px] px-1 rounded bg-white/[0.04]", pending ? "text-outline" : accent.text)}>
          {field.rangeLabel}
        </span>
      </div>
      <div
        className={clsx(
          "font-mono text-[15px] leading-5 font-semibold truncate",
          field.error ? "text-[#ff8b81]" : "text-on-surface",
        )}
        title={field.raw}
      >
        {field.raw || "—"}
      </div>
      <div className="flex items-start gap-1 min-h-[26px]">
        {field.error ? (
          <AlertTriangle size={10} className="mt-[2px] shrink-0 text-error" />
        ) : (
          <Dot tone="success" className="mt-[5px]" />
        )}
        <p
          className={clsx(
            "text-[10.5px] leading-[14px]",
            field.error ? "text-[#ff8b81]" : pending ? "text-outline" : "text-on-variant/85",
          )}
        >
          {field.error ?? field.explanation ?? "—"}
        </p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "neutral" | "primary";
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/30 px-2.5 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</div>
      <div className={clsx("font-mono text-[16px] leading-6 font-semibold tnum", tone === "primary" ? "text-primary-soft" : "text-on-surface")}>
        {value}
      </div>
      <div className="font-mono text-[8.5px] text-outline">{hint}</div>
    </div>
  );
}
