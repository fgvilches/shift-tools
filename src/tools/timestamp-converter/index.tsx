import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Clock,
  Copy,
  CornerDownLeft,
  Eraser,
  Globe,
  Globe2,
  History as HistoryIcon,
  RefreshCw,
  X,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { Field, Input, SegmentedControl, Select, Switch } from "@/components/ui/Form";
import { EmptyState, ErrorNotice, InfoNotice, Progress } from "@/components/ui/Feedback";
import { toast } from "@/components/ui/Toast";
import { plural } from "@/lib/format";
import { CopyIcon } from "./components/CopyIcon";
import {
  buildRows,
  isDstActive,
  isoInZone,
  KIND_LABEL,
  offsetLabel,
  parseInput,
  relativeFromNow,
  ROW_GROUPS,
  startOfDay,
  startOfMonth,
  zoneAbbreviation,
  zoneClock,
  zoneOffsetMinutes,
  type RepresentationRow,
  type UnitPreference,
} from "./lib/time";

const UNIT_OPTIONS: { value: UnitPreference; label: string }[] = [
  { value: "auto", label: "auto" },
  { value: "s", label: "s" },
  { value: "ms", label: "ms" },
];

const ZONES = [
  "UTC",
  "America/Santiago",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Madrid",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
] as const;

const TONE_CLASS: Record<NonNullable<RepresentationRow["tone"]>, string> = {
  default: "text-on-surface",
  primary: "text-primary-soft",
  secondary: "text-secondary",
  warning: "text-warning",
  tertiary: "text-tertiary",
};

interface HistoryEntry {
  id: number;
  input: string;
  unit: UnitPreference;
  ms: number;
  at: number;
}

function resolveLocalZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function zoneCity(zone: string): string {
  const parts = zone.split("/");
  return (parts[parts.length - 1] ?? zone).replace(/_/g, " ");
}

/** Second-aligned clock: ticks exactly on each wall-clock second boundary. */
function useNowTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, 1000 - (Date.now() % 1000));
    };
    setNow(Date.now());
    schedule();
    return () => window.clearTimeout(timer);
  }, [active]);

  return now;
}

function LiveCell({
  label,
  value,
  sub,
  copyValue,
  copyLabel,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  copyValue: string;
  copyLabel: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-black/30 border border-white/[0.055] px-2 py-1.5">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline truncate">{label}</span>
        <CopyIcon value={copyValue} label={copyLabel} />
      </div>
      <div
        className={clsx(
          "font-mono tnum text-[11.5px] truncate mt-0.5",
          emphasis ? "text-primary-soft" : "text-on-surface",
        )}
        title={value}
      >
        {value}
      </div>
      {sub && (
        <div className="font-mono text-[9.5px] text-outline truncate" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function TimestampConverterView() {
  const localZone = useMemo(resolveLocalZone, []);
  const [live, setLive] = useState(true);
  const now = useNowTicker(live);

  const [zoneChoice, setZoneChoice] = useState("local");
  const resolvedZone = zoneChoice === "local" ? localZone : zoneChoice;

  const [unit, setUnit] = useState<UnitPreference>("auto");
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)));
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const logSeq = useRef(0);

  const parsed = useMemo(() => parseInput(input, unit), [input, unit]);
  const anchorMs = parsed.ok ? parsed.value.ms : now;
  const unixtime = Math.floor(now / 1000);

  const localClock = useMemo(() => zoneClock(now, localZone), [now, localZone]);
  const utcClock = useMemo(() => zoneClock(now, "UTC"), [now]);
  const localOffset = useMemo(() => zoneOffsetMinutes(now, localZone), [now, localZone]);

  const zoneView = useMemo(
    () => ({
      clock: zoneClock(anchorMs, resolvedZone),
      offset: zoneOffsetMinutes(anchorMs, resolvedZone),
      abbr: zoneAbbreviation(anchorMs, resolvedZone),
      dst: isDstActive(anchorMs, resolvedZone),
      iso: isoInZone(anchorMs, resolvedZone),
    }),
    [anchorMs, resolvedZone],
  );

  const zoneLabel = zoneChoice === "local" ? `local (${localZone})` : resolvedZone;

  const rows = useMemo(
    () => (parsed.ok ? buildRows(parsed.value.ms, resolvedZone, localZone, now) : []),
    [parsed, resolvedZone, localZone, now],
  );

  const pushHistory = useCallback((text: string, nextUnit: UnitPreference, ms: number) => {
    logSeq.current += 1;
    const entry: HistoryEntry = { id: logSeq.current, input: text, unit: nextUnit, ms, at: Date.now() };
    setHistory((prev) => [entry, ...prev.filter((e) => !(e.input === text && e.unit === nextUnit))].slice(0, 8));
  }, []);

  /** Load an instant into the input; whole seconds stay seconds, anything else keeps ms. */
  const applyInstant = useCallback(
    (ms: number) => {
      const rounded = Math.round(ms);
      const wholeSecond = rounded % 1000 === 0;
      const text = String(wholeSecond ? rounded / 1000 : rounded);
      const nextUnit: UnitPreference = wholeSecond ? "auto" : "ms";
      setInput(text);
      setUnit(nextUnit);
      pushHistory(text, nextUnit, rounded);
    },
    [pushHistory],
  );

  const setToNow = useCallback(() => applyInstant(Date.now()), [applyInstant]);

  const logConversion = useCallback(() => {
    if (!parsed.ok) {
      toast.error("Nothing to log", parsed.error);
      return;
    }
    const text = input.trim();
    pushHistory(text, unit, parsed.value.ms);
    toast.success(
      "Conversion logged",
      `${KIND_LABEL[parsed.value.kind]} · ${relativeFromNow(parsed.value.ms, Date.now())}`,
    );
  }, [parsed, input, unit, pushHistory]);

  const clearInput = useCallback(() => {
    setInput("");
    setUnit("auto");
  }, []);

  const copyNow = useCallback(async () => {
    const value = String(Math.floor(Date.now() / 1000));
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Unix seconds copied", value);
    } catch {
      toast.error("Clipboard unavailable", "Select the value and copy it manually.");
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        setToNow();
      } else if (key === "l") {
        e.preventDefault();
        logConversion();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setToNow, logConversion]);

  const zoneOptions = useMemo(() => {
    const entries = [
      { value: "local", zone: localZone, name: `Local · ${localZone}` },
      ...ZONES.map((zone) => ({ value: zone, zone, name: zone })),
    ];
    return entries.map((entry) => ({
      value: entry.value,
      label: `${entry.name} (${offsetLabel(zoneOffsetMinutes(now, entry.zone))})`,
    }));
  }, [localZone, now]);

  const worldClocks = useMemo(() => {
    const entries = [
      { id: "local", zone: localZone, name: "Local", sub: localZone },
      ...ZONES.filter((zone) => zone !== localZone).map((zone) => ({
        id: zone,
        zone,
        name: zoneCity(zone),
        sub: zone,
      })),
    ];
    return entries.map((entry) => ({
      ...entry,
      time: zoneClock(now, entry.zone).time,
      abbr: zoneAbbreviation(now, entry.zone),
      offset: offsetLabel(zoneOffsetMinutes(now, entry.zone)),
      dst: isDstActive(now, entry.zone),
    }));
  }, [localZone, now]);

  const references = useMemo(() => {
    const raw = [
      { key: "now", label: "Now", ms: now },
      { key: "today", label: "Start of today", ms: startOfDay(anchorMs, resolvedZone) },
      { key: "month", label: "Start of month", ms: startOfMonth(anchorMs, resolvedZone) },
      { key: "h1", label: "+1 hour", ms: anchorMs + 3_600_000 },
      { key: "h24", label: "+24 hours", ms: anchorMs + 86_400_000 },
      { key: "d7", label: "+7 days", ms: anchorMs + 604_800_000 },
    ];
    return raw.map((item) => {
      const clock = zoneClock(item.ms, resolvedZone);
      return {
        ...item,
        unix: String(Math.floor(item.ms / 1000)),
        clock: clock.time,
        day: clock.date,
      };
    });
  }, [anchorMs, now, resolvedZone]);

  const quickJumps = useMemo(() => {
    const dayStart = startOfDay(anchorMs, resolvedZone);
    return [
      { label: "Start of day", ms: dayStart },
      { label: "End of day", ms: dayStart + 86_399_999 },
      { label: "−1h", ms: anchorMs - 3_600_000 },
      { label: "−24h", ms: anchorMs - 86_400_000 },
    ];
  }, [anchorMs, resolvedZone]);

  const parsedNote = parsed.ok
    ? `${KIND_LABEL[parsed.value.kind]} · ${parsed.value.note ?? "parsed"}`
    : "Unix seconds or milliseconds, ISO 8601, or any date the runtime can parse.";

  return (
    <ToolView
      eyebrow="TIME AXIS"
      eyebrowTone="primary"
      eyebrowHint="DATE + INTL · NO BACKEND"
      title="Timestamp Converter"
      description="Translate between Unix epoch, ISO 8601, and human-readable local time across zones."
      telemetry={[
        { label: "Epoch now", value: String(unixtime), tone: "primary", icon: <Clock size={14} /> },
        {
          label: "Zone",
          value: offsetLabel(zoneView.offset),
          tone: "tertiary",
          icon: <Globe2 size={14} />,
        },
        {
          label: "Ticker",
          value: live ? "1s" : "paused",
          tone: live ? "success" : "warning",
          icon: <Dot tone={live ? "success" : "warning"} pulse={live} />,
        },
      ]}
      toolbar={
        <>
          <Button variant="primary" icon={<RefreshCw size={13} />} onClick={setToNow} trailing={<Kbd>N</Kbd>}>
            Set to now
          </Button>
          <Button icon={<Copy size={13} />} onClick={() => void copyNow()}>
            Copy Unix seconds
          </Button>
          <Button variant="ghost" icon={<Eraser size={13} />} onClick={clearInput}>
            Clear
          </Button>
        </>
      }
      status={
        <>
          <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
            Live ticker
            <Switch checked={live} onChange={setLive} label="Toggle live ticker" size="sm" />
          </span>
          <Badge tone="neutral" mono>
            {zoneAbbreviation(now, resolvedZone)} · {offsetLabel(zoneOffsetMinutes(now, resolvedZone))}
          </Badge>
        </>
      }
    >
      <span className="sr-only" aria-live="polite">
        {parsed.ok
          ? `${KIND_LABEL[parsed.value.kind]} parsed as ${isoInZone(parsed.value.ms, resolvedZone)}`
          : input.trim()
            ? parsed.error
            : ""}
      </span>

      {/* Live now strip */}
      <Card className="relative overflow-hidden shrink-0">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 right-16 w-72 h-40 rounded-full bg-primary/[0.10] blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 left-10 w-64 h-44 rounded-full bg-tertiary/[0.07] blur-3xl"
        />
        <div className="relative flex flex-col xl:flex-row gap-3.5 p-3.5">
          <div className="xl:w-[292px] shrink-0 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>Live ticker</SectionLabel>
              <Badge tone={live ? "success" : "warning"} dot pulse={live} mono>
                {live ? "ticking 1s" : "paused"}
              </Badge>
            </div>
            <div className="flex items-end gap-2 min-w-0">
              <span className="font-mono tnum text-[30px] leading-none font-semibold tracking-tight text-primary">
                {unixtime}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline pb-1">sec</span>
              <CopyIcon value={String(unixtime)} label="live Unix seconds" className="mb-1" />
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-on-variant min-w-0">
              <span className="tnum truncate">{now}</span>
              <span className="text-[9px] uppercase tracking-[0.08em] text-outline">ms</span>
              <CopyIcon value={String(now)} label="live Unix milliseconds" />
              <span className="ml-auto shrink-0 rounded border border-white/[0.06] bg-black/35 px-1.5 py-0.5 text-[9.5px] text-tertiary tnum">
                0x{unixtime.toString(16).toUpperCase()}
              </span>
            </div>
            <div className="space-y-1 pt-0.5">
              <div className="flex items-center justify-between font-mono text-[9.5px] text-outline">
                <span>Subsecond phase</span>
                <span className="text-on-variant tnum">{now % 1000} ms</span>
              </div>
              <Progress
                value={(now % 1000) / 10}
                height={3}
                label="Position inside the current second"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 min-w-0 content-start">
            <LiveCell
              label="ISO 8601 · UTC"
              value={new Date(now).toISOString()}
              copyValue={new Date(now).toISOString()}
              copyLabel="live ISO 8601 timestamp"
            />
            <LiveCell
              label={`Local · ${localZone}`}
              value={localClock.time}
              sub={localClock.date}
              copyValue={isoInZone(now, localZone)}
              copyLabel="live local time"
              emphasis
            />
            <LiveCell
              label="UTC"
              value={utcClock.time}
              sub={`${utcClock.date} · ${offsetLabel(0)}`}
              copyValue={isoInZone(now, "UTC")}
              copyLabel="live UTC time"
            />
            <LiveCell
              label="Relative"
              value={relativeFromNow(parsed.ok ? parsed.value.ms : now, now)}
              sub={parsed.ok ? "converted instant vs now" : "live clock"}
              copyValue={relativeFromNow(parsed.ok ? parsed.value.ms : now, now)}
              copyLabel="relative time"
              emphasis={parsed.ok}
            />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-3 items-start">
        {/* Converter */}
        <Card className="min-w-0 overflow-hidden">
          <CardHeader
            title="Converter"
            hint="Live parse — every field below is computed from the input"
            icon={<Clock size={13} />}
            actions={
              <>
                <Badge tone={parsed.ok ? "primary" : "warning"} mono>
                  {parsed.ok ? KIND_LABEL[parsed.value.kind] : "unparsed"}
                </Badge>
                <Button
                  size="xs"
                  icon={<CornerDownLeft size={11} />}
                  onClick={logConversion}
                  disabled={!parsed.ok}
                  aria-label="Log this conversion to history"
                >
                  Log
                </Button>
              </>
            }
          />
          <div className="p-3 space-y-2.5">
            <Field
              label="Input"
              htmlFor="ts-input"
              hint={parsedNote}
              trailing={
                <SegmentedControl<UnitPreference>
                  value={unit}
                  onChange={setUnit}
                  options={UNIT_OPTIONS}
                  ariaLabel="Numeric unit override"
                />
              }
            >
              <Input
                id="ts-input"
                mono
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="1741712400 · 2025-03-11T17:00:00Z · Mar 11, 2025 14:30"
                aria-label="Timestamp or date input"
                aria-invalid={!parsed.ok && input.trim().length > 0 ? true : undefined}
                autoComplete="off"
                spellCheck={false}
                invalid={!parsed.ok && input.trim().length > 0}
                leading={<span className="font-mono text-[10px] text-outline">TS</span>}
                trailingSlot={<IconButton label="Clear input" icon={<X size={11} />} size="sm" onClick={clearInput} />}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    logConversion();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    clearInput();
                  }
                }}
                className="pr-14"
              />
            </Field>

            <div className="flex flex-wrap items-center gap-1">
              {quickJumps.map((jump) => (
                <button
                  key={jump.label}
                  type="button"
                  onClick={() => applyInstant(jump.ms)}
                  aria-label={`Load ${jump.label} into the converter`}
                  className="h-6 px-2 rounded-md border border-white/[0.08] bg-white/[0.05] font-mono text-[10.5px] text-on-variant hover:text-on-surface hover:bg-white/[0.09] transition-colors"
                >
                  {jump.label}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-outline">
                <Kbd>↵</Kbd> log this conversion
              </span>
            </div>

            {parsed.ok && parsed.value.warning && (
              <InfoNotice tone="warning" icon={<AlertTriangle size={12} />}>
                {parsed.value.warning}
              </InfoNotice>
            )}
          </div>

          {!parsed.ok ? (
            input.trim() ? (
              <div className="px-3 pb-3">
                <ErrorNotice title="Cannot parse that input" message={parsed.error} />
              </div>
            ) : (
              <div className="border-t border-white/[0.055]">
                <EmptyState
                  compact
                  icon={<Clock size={16} />}
                  title="Waiting for input"
                  description="Type a Unix timestamp, an ISO 8601 string, or a date such as 2025-03-11 14:30. Results are computed as you type."
                />
              </div>
            )
          ) : (
            <div className="border-t border-white/[0.055]">
              <table className="w-full border-collapse" aria-label="Timestamp representations">
                <caption className="sr-only">
                  Representations of the converted instant in {zoneLabel}
                </caption>
                <thead>
                  <tr className="bg-black/25">
                    <th
                      scope="col"
                      className="h-7 px-3 text-left text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline whitespace-nowrap"
                    >
                      Representation
                    </th>
                    <th
                      scope="col"
                      className="h-7 px-3 text-left text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline"
                    >
                      Value
                    </th>
                    <th scope="col" className="h-7 px-3 w-12">
                      <span className="sr-only">Copy value</span>
                    </th>
                  </tr>
                </thead>
                {ROW_GROUPS.map((group) => {
                  const groupRows = rows.filter((row) => row.group === group.id);
                  if (groupRows.length === 0) return null;
                  return (
                    <tbody key={group.id}>
                      <tr className="bg-white/[0.022]">
                        <th
                          scope="colgroup"
                          colSpan={3}
                          className="h-6 px-3 text-left text-[9px] font-semibold uppercase tracking-[0.09em] text-outline/80"
                        >
                          {group.label}
                        </th>
                      </tr>
                      {groupRows.map((row) => (
                        <tr key={row.key} className="dt-row">
                          <td className="h-7 px-3 text-[11.5px] text-on-variant whitespace-nowrap">{row.label}</td>
                          <td className="h-7 px-3 w-full max-w-0">
                            <div
                              className={clsx(
                                "font-mono text-[11.5px] tnum truncate",
                                TONE_CLASS[row.tone ?? "default"],
                              )}
                              title={row.value}
                            >
                              {row.value}
                            </div>
                          </td>
                          <td className="h-7 px-3 text-right">
                            <CopyIcon value={row.value} label={row.label} className="opacity-60 hover:opacity-100" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
              <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-t border-white/[0.055] font-mono text-[10px] text-outline">
                <span className="truncate">
                  {parsed.ok ? `${KIND_LABEL[parsed.value.kind]} → ${parsed.value.note ?? "parsed"}` : ""}
                </span>
                <span className="shrink-0">{zoneLabel}</span>
              </div>
            </div>
          )}
        </Card>

        {/* Right rail */}
        <div className="flex flex-col gap-3 min-w-0">
          <Card className="min-w-0">
            <CardHeader
              title="Zone view"
              hint={parsed.ok ? "Converted instant, same clock" : "Live instant, same clock"}
              icon={<Globe2 size={13} />}
              actions={
                <Badge tone={zoneView.dst ? "warning" : "neutral"} mono>
                  {zoneView.abbr}
                </Badge>
              }
            />
            <div className="p-3 space-y-2.5">
              <Select
                aria-label="Display timezone"
                sizeVariant="sm"
                value={zoneChoice}
                onChange={(e) => setZoneChoice(e.target.value)}
                options={zoneOptions}
              />
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono tnum text-[24px] leading-none font-semibold text-on-surface">
                    {zoneView.clock.time}
                  </div>
                  <div className="text-[10.5px] text-on-variant mt-1 truncate">{zoneView.clock.date}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono text-[11px] text-primary-soft">{offsetLabel(zoneView.offset)}</div>
                  <div className="font-mono text-[9.5px] text-outline mt-0.5">
                    {zoneView.dst ? "DST active" : "standard time"}
                  </div>
                </div>
              </div>
              <div className="min-w-0 rounded-lg border border-white/[0.05] bg-black/30 px-2 py-1.5">
                <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
                  ISO 8601 in zone
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-[10.5px] tnum text-on-surface truncate" title={zoneView.iso}>
                    {zoneView.iso}
                  </span>
                  <CopyIcon value={zoneView.iso} label={`ISO 8601 in ${zoneLabel}`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 border-t border-white/[0.05] pt-2">
                <div className="min-w-0">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Local zone</div>
                  <div className="font-mono text-[10px] text-on-variant truncate" title={localZone}>
                    {localZone}
                  </div>
                </div>
                <div className="min-w-0 text-right">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
                    Local offset
                  </div>
                  <div className="font-mono text-[10px] text-on-variant tnum">{offsetLabel(localOffset)}</div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="min-w-0">
            <CardHeader
              title="Epoch reference"
              hint="Anchored to the instant above"
              icon={<CalendarClock size={13} />}
              actions={
                <Badge tone="neutral" mono>
                  {zoneCity(resolvedZone)}
                </Badge>
              }
            />
            <div className="p-1.5">
              {references.map((reference) => (
                <button
                  key={reference.key}
                  type="button"
                  onClick={() => applyInstant(reference.ms)}
                  aria-label={`Load ${reference.label} into the converter: ${reference.unix} Unix seconds`}
                  title={`${reference.day} ${reference.clock} · ${resolvedZone}`}
                  className="group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span className="text-[11px] text-on-variant truncate">{reference.label}</span>
                  <ArrowRight
                    size={10}
                    className="ml-auto shrink-0 text-outline opacity-0 transition-opacity group-hover:opacity-100"
                  />
                  <span className="font-mono text-[10.5px] tnum text-on-surface shrink-0">{reference.unix}</span>
                  <span className="w-14 shrink-0 text-right font-mono text-[9.5px] text-outline">
                    {reference.clock}
                  </span>
                </button>
              ))}
            </div>
            <div className="border-t border-white/[0.055] px-3 py-1.5 text-[10px] text-outline">
              Click a row to load it into the converter.
            </div>
          </Card>

          <Card className="min-w-0">
            <CardHeader
              title="History"
              hint={`${plural(history.length, "entry", "entries")} · max 8`}
              icon={<HistoryIcon size={13} />}
              actions={
                history.length > 0 ? (
                  <Button size="xs" variant="ghost" onClick={() => setHistory([])} aria-label="Clear conversion history">
                    Clear
                  </Button>
                ) : undefined
              }
            />
            {history.length === 0 ? (
              <EmptyState
                compact
                icon={<HistoryIcon size={16} />}
                title="No conversions logged"
                description="Press Enter in the converter to pin it here."
              />
            ) : (
              <ul aria-label="Recent conversions" className="p-1.5 space-y-0.5">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setInput(entry.input);
                        setUnit(entry.unit);
                      }}
                      aria-label={`Load ${entry.input} into the converter`}
                      className="w-full rounded-md px-2 py-1 text-left transition-colors hover:bg-white/[0.06]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Dot tone="primary" />
                        <span className="font-mono text-[10.5px] tnum text-on-surface truncate">
                          {entry.input}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[9px] text-outline">
                          {relativeFromNow(entry.ms, now)}
                        </span>
                      </div>
                      <div className="pl-[13px] font-mono text-[9.5px] text-outline truncate">
                        {isoInZone(entry.ms, resolvedZone)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* World clocks */}
      <Card className="shrink-0">
        <CardHeader
          title="World clocks"
          hint="Same instant, every configured zone — click to inspect"
          icon={<Globe size={13} />}
          actions={
            <Badge tone="primary" mono>
              {offsetLabel(zoneView.offset)}
            </Badge>
          }
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 p-2">
          {worldClocks.map((zone) => {
            const active = zoneChoice === zone.id;
            return (
              <button
                key={zone.id}
                type="button"
                onClick={() => setZoneChoice(zone.id)}
                aria-pressed={active}
                aria-label={`Show ${zone.name} time (${zone.sub})`}
                title={zone.sub}
                className={clsx(
                  "min-w-0 rounded-lg border px-2 py-1.5 text-left transition-colors",
                  active
                    ? "border-primary/45 bg-primary/[0.09]"
                    : "border-white/[0.06] bg-black/25 hover:bg-white/[0.055]",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[10.5px] font-medium text-on-surface">{zone.name}</span>
                  <Dot tone={zone.dst ? "warning" : "neutral"} />
                </div>
                <div
                  className={clsx(
                    "font-mono tnum text-[13px] leading-tight mt-0.5",
                    active ? "text-primary-soft" : "text-on-surface",
                  )}
                >
                  {zone.time}
                </div>
                <div className="font-mono text-[9px] text-outline truncate">
                  {zone.abbr} · {zone.offset}
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </ToolView>
  );
}
