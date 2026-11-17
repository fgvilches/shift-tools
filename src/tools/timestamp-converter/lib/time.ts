/**
 * Timestamp Converter — date math and formatting.
 *
 * Everything here is local `Date` / `Intl` work; no backend, no dependencies.
 * Zone-aware helpers accept a real IANA zone (never the "local" sentinel).
 */

export type UnitPreference = "auto" | "s" | "ms";
export type InputKind = "unix-seconds" | "unix-milliseconds" | "iso" | "date-string";
export type RowGroup = "numeric" | "iso" | "format" | "calendar";

export interface ParsedValue {
  ms: number;
  kind: InputKind;
  /** Context for the reader, e.g. "no offset · read as browser local time". */
  note: string | null;
  /** Soft warning, e.g. a unit override that disagrees with the magnitude. */
  warning: string | null;
}

export type ParseOutcome = { ok: true; value: ParsedValue } | { ok: false; error: string };

export interface RepresentationRow {
  key: string;
  group: RowGroup;
  label: string;
  value: string;
  tone?: "default" | "primary" | "secondary" | "tertiary" | "warning";
}

export interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export const KIND_LABEL: Record<InputKind, string> = {
  "unix-seconds": "unix seconds",
  "unix-milliseconds": "unix milliseconds",
  iso: "ISO 8601",
  "date-string": "date string",
};

export const ROW_GROUPS: { id: RowGroup; label: string }[] = [
  { id: "numeric", label: "Numeric" },
  { id: "iso", label: "ISO 8601 / RFC" },
  { id: "format", label: "Formatted" },
  { id: "calendar", label: "Calendar" },
];

const NUMERIC = /^[+-]?\d+(?:[.,]\d+)?$/;
const ISO_SHAPE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const ISO_PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const MAX_EPOCH_MS = 8.64e15;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ------------------------------------------------------------------ parsing */

export function parseInput(raw: string, unit: UnitPreference): ParseOutcome {
  const text = raw.trim();
  if (!text) {
    return { ok: false, error: "Nothing to convert yet — enter a Unix timestamp or a date." };
  }

  const numeric = text.replace(/_/g, "");
  if (NUMERIC.test(numeric)) {
    const magnitude = Number(numeric.replace(",", "."));
    if (!Number.isFinite(magnitude)) {
      return { ok: false, error: `"${text}" is not a finite number.` };
    }
    const resolved: "s" | "ms" = unit === "auto" ? (Math.abs(magnitude) >= 1e11 ? "ms" : "s") : unit;
    const ms = resolved === "s" ? magnitude * 1000 : magnitude;
    if (!Number.isFinite(ms) || Math.abs(ms) > MAX_EPOCH_MS) {
      return {
        ok: false,
        error: `${text} is outside the representable range. Unix ${resolved} must stay within ±${resolved === "s" ? "8.64e12" : "8.64e15"}.`,
      };
    }
    const warning =
      unit === "s" && Math.abs(magnitude) >= 1e11
        ? "This looks like a millisecond value but seconds were forced — the result is far in the future."
        : unit === "ms" && Math.abs(magnitude) < 1e11
          ? "This looks like a second value but milliseconds were forced — the result lands in January 1970."
          : null;
    return {
      ok: true,
      value: {
        ms: Math.round(ms),
        kind: resolved === "s" ? "unix-seconds" : "unix-milliseconds",
        note: unit === "auto" ? `${resolved} detected from magnitude` : `${resolved} forced by unit override`,
        warning,
      },
    };
  }

  if (ISO_SHAPE.test(text)) {
    const badField = invalidIsoField(text);
    if (badField) {
      return { ok: false, error: `"${text}" is not a real calendar date: ${badField}.` };
    }
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) {
      return { ok: false, error: `"${text}" looks like ISO 8601 but is not a valid calendar date.` };
    }
    const hasTime = /[T ]\d{2}:\d{2}/.test(text);
    const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
    return {
      ok: true,
      value: {
        ms,
        kind: "iso",
        note: !hasTime
          ? "date only · taken as UTC midnight"
          : hasOffset
            ? "offset present in input"
            : "no offset · read as browser local time",
        warning: null,
      },
    };
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return {
      ok: false,
      error: `Cannot read "${truncate(text, 48)}". Use a Unix timestamp (s or ms), ISO 8601, or a date such as 2025-03-11 14:30.`,
    };
  }
  return { ok: true, value: { ms: parsed, kind: "date-string", note: "parsed by the runtime date parser", warning: null } };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * V8 rolls impossible ISO dates over (2025-02-30 becomes 2025-03-02), so the
 * calendar fields are validated against the real month lengths before parsing.
 */
function invalidIsoField(text: string): string | null {
  const match = ISO_PARTS.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return `month ${match[2]} is outside 01–12`;
  const total = daysInMonth(year, month);
  if (day < 1 || day > total) {
    return `${match[1]}-${match[2]} has ${total} days, so day ${match[3]} does not exist`;
  }
  if (match[4] !== undefined && Number(match[4]) > 23) return `hour ${match[4]} is outside 00–23`;
  if (match[5] !== undefined && Number(match[5]) > 59) return `minute ${match[5]} is outside 00–59`;
  if (match[6] !== undefined && Number(match[6]) > 59) return `second ${match[6]} is outside 00–59`;
  return null;
}

/* ---------------------------------------------------------------- formatters */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
  formatterCache.set(key, created);
  return created;
}

function partsMap(ms: number, timeZone: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of formatter(timeZone, options).formatToParts(ms)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

const ZONE_PARTS_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
};

export function zoneParts(ms: number, timeZone: string): ZoneParts {
  const parts = partsMap(ms, timeZone, ZONE_PARTS_OPTIONS);
  const hour = Number(parts.hour ?? "0");
  return {
    year: Number(parts.year ?? "1970"),
    month: Number(parts.month ?? "1"),
    day: Number(parts.day ?? "1"),
    hour: hour === 24 ? 0 : hour,
    minute: Number(parts.minute ?? "0"),
    second: Number(parts.second ?? "0"),
  };
}

function utcFromParts(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** Offset of `timeZone` at that instant, in minutes east of UTC. */
export function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const parts = zoneParts(ms, timeZone);
  const wall = utcFromParts(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
  const whole = Math.floor(ms / 1000) * 1000;
  return Math.round((wall - whole) / 60_000);
}

export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function isoOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function pad(value: number, width = 2): string {
  return String(Math.abs(Math.trunc(value))).padStart(width, "0");
}

/** Reverse of zoneOffsetMinutes: wall-clock time in a zone → epoch ms. */
export function zonedWallTimeToMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone = "UTC",
): number {
  const naive = utcFromParts(year, month, day, hour, minute, second);
  const candidateA = naive - zoneOffsetMinutes(naive, timeZone) * 60_000;
  const candidateB = naive - zoneOffsetMinutes(candidateA, timeZone) * 60_000;
  const matches = (candidate: number): boolean => {
    const parts = zoneParts(candidate, timeZone);
    return (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute &&
      parts.second === second
    );
  };
  if (matches(candidateA)) return candidateA;
  if (matches(candidateB)) return candidateB;
  // Wall time inside a spring-forward gap (e.g. 00:00 that never happens):
  // take the later candidate, which is the first instant that does exist.
  return Math.max(candidateA, candidateB);
}

export function startOfDay(ms: number, timeZone: string): number {
  const parts = zoneParts(ms, timeZone);
  return zonedWallTimeToMs(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
}

export function startOfMonth(ms: number, timeZone: string): number {
  const parts = zoneParts(ms, timeZone);
  return zonedWallTimeToMs(parts.year, parts.month, 1, 0, 0, 0, timeZone);
}

export function zoneAbbreviation(ms: number, timeZone: string): string {
  const parts = partsMap(ms, timeZone, { timeZoneName: "short" });
  return parts.timeZoneName ?? offsetLabel(zoneOffsetMinutes(ms, timeZone));
}

export function isDstActive(ms: number, timeZone: string): boolean {
  const { year } = zoneParts(ms, timeZone);
  const january = zoneOffsetMinutes(utcFromParts(year, 1, 1), timeZone);
  const july = zoneOffsetMinutes(utcFromParts(year, 7, 1), timeZone);
  if (january === july) return false;
  return zoneOffsetMinutes(ms, timeZone) === Math.max(january, july);
}

export function zoneClock(ms: number, timeZone: string): { time: string; date: string } {
  const parts = zoneParts(ms, timeZone);
  const weekday = partsMap(ms, timeZone, { weekday: "short" }).weekday ?? DAY_NAMES[new Date(ms).getUTCDay()];
  const monthName = partsMap(ms, timeZone, { month: "short" }).month ?? MONTH_NAMES[parts.month - 1];
  return {
    time: `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`,
    date: `${weekday}, ${pad(parts.day)} ${monthName} ${parts.year}`,
  };
}

/* ------------------------------------------------------------- representations */

export function isoInZone(ms: number, timeZone: string): string {
  const parts = zoneParts(ms, timeZone);
  const offset = zoneOffsetMinutes(ms, timeZone);
  const millis = ((Math.floor(ms) % 1000) + 1000) % 1000;
  return (
    `${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${pad(millis, 3)}${isoOffset(offset)}`
  );
}

export function rfc2822(ms: number): string {
  const date = new Date(ms);
  return (
    `${DAY_NAMES[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTH_NAMES[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
  );
}

export function localeString(ms: number, timeZone: string): string {
  return formatter(timeZone, { dateStyle: "full", timeStyle: "long" }).format(ms);
}

export function weekdayName(ms: number, timeZone: string): string {
  return formatter(timeZone, { weekday: "long" }).format(ms);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isoWeek(ms: number, timeZone: string): { week: number; year: number } {
  const parts = zoneParts(ms, timeZone);
  const thursday = new Date(utcFromParts(parts.year, parts.month, parts.day));
  const dayNr = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - dayNr + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(utcFromParts(isoYear, 1, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { week, year: isoYear };
}

export function dayOfYear(ms: number, timeZone: string): { day: number; total: number } {
  const parts = zoneParts(ms, timeZone);
  const current = utcFromParts(parts.year, parts.month, parts.day);
  const first = utcFromParts(parts.year, 1, 1);
  return { day: 1 + Math.round((current - first) / 86_400_000), total: isLeapYear(parts.year) ? 366 : 365 };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(utcFromParts(year, month + 1, 0)).getUTCDate();
}

export function julianDate(ms: number): string {
  return (ms / 86_400_000 + 2_440_587.5).toFixed(4);
}

export function relativeFromNow(ms: number, now: number): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 1_500) return "just now";

  const future = diff > 0;
  let amount: number;
  let unit: string;

  if (abs < 60_000) {
    amount = Math.round(abs / 1000);
    unit = "second";
  } else if (abs < 3_600_000) {
    amount = Math.round(abs / 60_000);
    unit = "minute";
  } else if (abs < 86_400_000) {
    amount = Math.round(abs / 3_600_000);
    unit = "hour";
  } else if (abs < 2_592_000_000) {
    amount = Math.round(abs / 86_400_000);
    unit = "day";
  } else if (abs < 31_557_600_000) {
    amount = Math.round(abs / 2_629_800_000);
    unit = "month";
  } else {
    amount = Math.round(abs / 31_557_600_000);
    unit = "year";
  }

  if (amount >= 60 && unit === "second") {
    amount = Math.round(amount / 60);
    unit = "minute";
  } else if (amount >= 60 && unit === "minute") {
    amount = Math.round(amount / 60);
    unit = "hour";
  } else if (amount >= 24 && unit === "hour") {
    amount = Math.round(amount / 24);
    unit = "day";
  } else if (amount >= 12 && unit === "month") {
    amount = Math.round(amount / 12);
    unit = "year";
  }

  const plural = amount === 1 ? unit : `${unit}s`;
  return future ? `in ${amount} ${plural}` : `${amount} ${plural} ago`;
}

/** All representations of one instant, grouped in display order. */
export function buildRows(ms: number, zone: string, localZone: string, now: number): RepresentationRow[] {
  const parts = zoneParts(ms, zone);
  const offset = zoneOffsetMinutes(ms, zone);
  const week = isoWeek(ms, zone);
  const doy = dayOfYear(ms, zone);
  const relative = relativeFromNow(ms, now);

  const rows: RepresentationRow[] = [
    {
      key: "unix-s",
      group: "numeric",
      label: "Unix seconds",
      value: String(Math.floor(ms / 1000)),
      tone: "primary",
    },
    { key: "unix-ms", group: "numeric", label: "Unix milliseconds", value: String(ms) },
    { key: "julian", group: "numeric", label: "Julian date", value: julianDate(ms), tone: "tertiary" },
    { key: "iso-utc", group: "iso", label: "ISO 8601 · UTC", value: new Date(ms).toISOString() },
  ];

  if (zone !== localZone) {
    rows.push({ key: "iso-local", group: "iso", label: "ISO 8601 · local", value: isoInZone(ms, localZone) });
  }
  rows.push({ key: "iso-zone", group: "iso", label: `ISO 8601 · ${zone}`, value: isoInZone(ms, zone) });
  rows.push({ key: "rfc", group: "iso", label: "RFC 2822", value: rfc2822(ms), tone: "warning" });

  rows.push({ key: "locale", group: "format", label: "Locale string", value: localeString(ms, zone) });
  rows.push({ key: "weekday", group: "format", label: "Day of week", value: weekdayName(ms, zone) });
  rows.push({ key: "relative", group: "format", label: "Relative", value: relative, tone: "secondary" });

  rows.push({
    key: "doy",
    group: "calendar",
    label: "Day of year",
    value: `${doy.day} / ${doy.total}`,
  });
  rows.push({
    key: "iso-week",
    group: "calendar",
    label: "ISO week",
    value: `${week.year}-W${pad(week.week)}`,
  });
  rows.push({
    key: "month-length",
    group: "calendar",
    label: "Days in month",
    value: `${daysInMonth(parts.year, parts.month)}${isLeapYear(parts.year) ? " · leap year" : ""}`,
  });
  rows.push({ key: "offset", group: "calendar", label: `Offset · ${zone}`, value: offsetLabel(offset) });

  return rows;
}
