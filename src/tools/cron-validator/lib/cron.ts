/**
 * Local cron engine: parsing, per-field explanation, whole-schedule translation
 * and bounded next-run projection. No backend involved.
 *
 * Dialect: classic Vixie/POSIX cron.
 *   minute hour day-of-month month day-of-week
 * Optional explicit 6-field form (toggle in the UI): second minute hour dom month dow.
 * Supported syntax per field: "*", single values, ranges a-b, lists a,b, steps "* /n"
 * and "a-b/n" (written without the space), plus 3-letter or full English names for
 * month and day-of-week fields. Macros: @hourly @daily @midnight @weekly @monthly
 * @yearly @annually.
 */

export type FieldKey = "second" | "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek";

export interface FieldDef {
  key: FieldKey;
  label: string;
  short: string;
  /** Accepted numeric bounds (day-of-week also accepts 7 = Sunday). */
  min: number;
  max: number;
  /** Canonical values used for matching, ordered. */
  domain: number[];
  rangeLabel: string;
  names?: Record<string, number>;
}

function intRange(from: number, to: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v += 1) out.push(v);
  return out;
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function buildNameMap(names: readonly string[]): Record<string, number> {
  const map: Record<string, number> = {};
  names.forEach((name, index) => {
    map[name.toLowerCase()] = index;
    map[name.slice(0, 3).toLowerCase()] = index;
  });
  return map;
}

const MONTH_NAME_MAP: Record<string, number> = {};
MONTH_NAMES.forEach((name, index) => {
  MONTH_NAME_MAP[name.toLowerCase()] = index + 1;
  MONTH_NAME_MAP[name.slice(0, 3).toLowerCase()] = index + 1;
});

const WEEKDAY_NAME_MAP = buildNameMap(WEEKDAY_NAMES);

/** Field metadata, independent of the 5- or 6-field dialect. */
export const FIELD_DEFS: Record<FieldKey, FieldDef> = {
  second: {
    key: "second",
    label: "Second",
    short: "sec",
    min: 0,
    max: 59,
    domain: intRange(0, 59),
    rangeLabel: "0-59",
  },
  minute: {
    key: "minute",
    label: "Minute",
    short: "min",
    min: 0,
    max: 59,
    domain: intRange(0, 59),
    rangeLabel: "0-59",
  },
  hour: {
    key: "hour",
    label: "Hour",
    short: "hour",
    min: 0,
    max: 23,
    domain: intRange(0, 23),
    rangeLabel: "0-23",
  },
  dayOfMonth: {
    key: "dayOfMonth",
    label: "Day of month",
    short: "day (m)",
    min: 1,
    max: 31,
    domain: intRange(1, 31),
    rangeLabel: "1-31",
  },
  month: {
    key: "month",
    label: "Month",
    short: "month",
    min: 1,
    max: 12,
    domain: intRange(1, 12),
    rangeLabel: "1-12 · JAN-DEC",
    names: MONTH_NAME_MAP,
  },
  dayOfWeek: {
    key: "dayOfWeek",
    label: "Day of week",
    short: "day (w)",
    min: 0,
    max: 7,
    domain: intRange(0, 6),
    rangeLabel: "0-7 · SUN-SAT",
    names: WEEKDAY_NAME_MAP,
  },
};

export const FIELDS_5: FieldDef[] = [
  FIELD_DEFS.minute,
  FIELD_DEFS.hour,
  FIELD_DEFS.dayOfMonth,
  FIELD_DEFS.month,
  FIELD_DEFS.dayOfWeek,
];

export const FIELDS_6: FieldDef[] = [FIELD_DEFS.second, ...FIELDS_5];

export const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

/** Candidate steps allowed before the projection gives up. */
export const MAX_STEPS = 24000;
/** Candidate steps allowed for the 24 h / 7 day cadence counters. */
export const COUNT_STEPS = 12000;

export type FieldPattern =
  | { kind: "wildcard" }
  | { kind: "single"; value: number }
  | { kind: "range"; start: number; end: number }
  | { kind: "step-all"; step: number }
  | { kind: "step-range"; start: number; end: number; step: number }
  | { kind: "list" };

export interface ParsedField {
  key: FieldKey;
  label: string;
  short: string;
  rangeLabel: string;
  raw: string;
  values: number[];
  /** Boolean lookup indexed by canonical value. */
  set: boolean[];
  wildcard: boolean;
  pattern: FieldPattern;
  explanation: string;
  error: string | null;
}

export type ProblemField = FieldKey | "expression";

export interface ScheduleProblem {
  field: ProblemField;
  label: string;
  message: string;
}

export interface ParsedSchedule {
  input: string;
  ok: boolean;
  usesSeconds: boolean;
  macro: string | null;
  /** Macro-expanded, whitespace-normalized expression (6-field when usesSeconds). */
  expression: string;
  fields: ParsedField[];
  problems: ScheduleProblem[];
  summary: string;
  dayRule: string;
}

/* ------------------------------------------------------------------ */
/* Field parsing                                                       */
/* ------------------------------------------------------------------ */

function emptyField(def: FieldDef, raw = ""): ParsedField {
  return {
    key: def.key,
    label: def.label,
    short: def.short,
    rangeLabel: def.rangeLabel,
    raw,
    values: [],
    set: new Array<boolean>(def.max + 1).fill(false),
    wildcard: false,
    pattern: { kind: "list" },
    explanation: "",
    error: null,
  };
}

function resolveValue(token: string, def: FieldDef): number | string {
  const text = token.trim();
  if (!text) return `${def.label} value is missing.`;
  const named = def.names?.[text.toLowerCase()];
  const numeric = /^\d+$/.test(text) ? Number(text) : named;
  if (numeric === undefined) {
    return `"${text}" is not a valid ${def.label.toLowerCase()} value (${def.rangeLabel}).`;
  }
  if (numeric < def.min || numeric > def.max) {
    return `${numeric} is outside the ${def.label.toLowerCase()} range ${def.rangeLabel}.`;
  }
  return numeric;
}

function consumeField(raw: string, def: FieldDef): ParsedField {
  const base = emptyField(def, raw);
  const text = raw.trim();
  if (!text) return { ...base, error: "Value is missing." };

  const set = base.set;
  const terms = text.split(",");
  let termCount = 0;
  let stepTerm: { start: number; end: number; step: number; whole: boolean } | null = null;
  let rangeTerm: { start: number; end: number } | null = null;

  for (const untrimmed of terms) {
    const term = untrimmed.trim();
    if (!term) return { ...base, error: `Empty list item in "${text}".` };

    const slashParts = term.split("/");
    if (slashParts.length > 2) return { ...base, error: `"${term}" contains more than one "/".` };
    const rangeText = (slashParts[0] ?? "").trim();
    const stepText = slashParts[1];

    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText.trim())) {
        return { ...base, error: `Step "${stepText}" in "${term}" must be a whole number.` };
      }
      step = Number(stepText.trim());
      if (step < 1) return { ...base, error: `Step in "${term}" must be at least 1.` };
    }

    let start: number;
    let end: number;
    let whole = false;
    let usedRange = false;

    if (rangeText === "*") {
      start = def.domain[0]!;
      end = def.domain[def.domain.length - 1]!;
      whole = true;
    } else {
      const bounds = rangeText.split("-");
      if (bounds.length > 2) return { ...base, error: `"${term}" contains more than one "-".` };
      const first = resolveValue(bounds[0] ?? "", def);
      if (typeof first !== "number") return { ...base, error: first };
      if (bounds.length === 1) {
        if (stepText !== undefined) {
          return {
            ...base,
            error: `"${term}" applies a step to a single value; use */${step} or a-b/${step}.`,
          };
        }
        start = first;
        end = first;
      } else {
        const last = resolveValue(bounds[1] ?? "", def);
        if (typeof last !== "number") return { ...base, error: last };
        if (first > last) {
          return { ...base, error: `Range "${rangeText}" runs backwards; start must not exceed end.` };
        }
        start = first;
        end = last;
        usedRange = true;
      }
    }

    for (let value = start; value <= end; value += step) {
      const canonical = def.key === "dayOfWeek" && value === 7 ? 0 : value;
      set[canonical] = true;
    }

    if (stepText !== undefined) stepTerm = { start, end, step, whole };
    if (usedRange) rangeTerm = { start, end };
    termCount += 1;
  }

  const values = def.domain.filter((value) => set[value]);
  if (values.length === 0) return { ...base, error: "No values matched." };

  const wildcard = values.length === def.domain.length;
  let pattern: FieldPattern;
  if (wildcard) {
    pattern = { kind: "wildcard" };
  } else if (termCount === 1) {
    if (stepTerm) {
      pattern = stepTerm.whole
        ? { kind: "step-all", step: stepTerm.step }
        : { kind: "step-range", start: stepTerm.start, end: stepTerm.end, step: stepTerm.step };
    } else if (rangeTerm) {
      pattern = { kind: "range", start: rangeTerm.start, end: rangeTerm.end };
    } else {
      pattern = { kind: "single", value: values[0]! };
    }
  } else {
    pattern = { kind: "list" };
  }

  return {
    ...base,
    values,
    wildcard,
    pattern,
    explanation: describeField(def, pattern, values),
    error: null,
  };
}

/* ------------------------------------------------------------------ */
/* Phrasing                                                            */
/* ------------------------------------------------------------------ */

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function clock(hour: number, minute = 0): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[value % 10] ?? "th";
  return `${value}${suffix}`;
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capped(items: string[], max = 8): string {
  if (items.length <= max) return joinList(items);
  return `${items.slice(0, max).join(", ")} and ${items.length - max} more`;
}

function contiguous(values: number[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    if (values[i]! !== values[i - 1]! + 1) return false;
  }
  return true;
}

function hoursSpan(hours: number[]): string {
  if (hours.length === 0) return "—";
  const first = hours[0]!;
  const last = hours[hours.length - 1]!;
  if (hours.length === 1) return `${clock(first)} through ${pad2(first)}:59`;
  if (contiguous(hours)) return `${clock(first)} through ${pad2(last)}:59`;
  return `hours ${capped(hours.map((hour) => pad2(hour)), 6)}`;
}

function describeField(def: FieldDef, pattern: FieldPattern, values: number[]): string {
  switch (pattern.kind) {
    case "wildcard":
      return def.key === "minute"
        ? "Every minute"
        : def.key === "hour"
          ? "Every hour"
          : def.key === "dayOfMonth"
            ? "Every day of the month"
            : def.key === "month"
              ? "Every month"
              : def.key === "dayOfWeek"
                ? "Every day of the week"
                : "Every second";
    case "single": {
      const value = pattern.value;
      switch (def.key) {
        case "minute":
          return `At minute ${value}`;
        case "hour":
          return `At ${clock(value)}`;
        case "dayOfMonth":
          return `On the ${ordinal(value)}`;
        case "month":
          return MONTH_NAMES[value - 1] ?? String(value);
        case "dayOfWeek":
          return `On ${WEEKDAY_NAMES[value] ?? String(value)}`;
        default:
          return `At second ${value}`;
      }
    }
    case "range": {
      const { start, end } = pattern;
      switch (def.key) {
        case "minute":
          return `Minutes ${start} through ${end}`;
        case "hour":
          return `Between ${clock(start)} and ${pad2(end)}:59`;
        case "dayOfMonth":
          return `On days ${start} through ${end}`;
        case "month":
          return `${MONTH_NAMES[start - 1]} through ${MONTH_NAMES[end - 1]}`;
        case "dayOfWeek":
          return `${WEEKDAY_NAMES[start]} through ${WEEKDAY_NAMES[end]}`;
        default:
          return `Seconds ${start} through ${end}`;
      }
    }
    case "step-all": {
      const { step } = pattern;
      switch (def.key) {
        case "minute":
          return step === 1 ? "Every minute" : `Every ${step} minutes`;
        case "hour":
          return step === 1 ? "Every hour" : `Every ${step} hours`;
        case "dayOfMonth":
          return step === 1 ? "Every day of the month" : `Every ${step} days of the month`;
        case "month":
          return step === 1 ? "Every month" : `Every ${step} months starting in January`;
        case "dayOfWeek":
          return step === 1
            ? "Every day of the week"
            : `Every ${step} days of the week starting ${WEEKDAY_NAMES[0]}`;
        default:
          return step === 1 ? "Every second" : `Every ${step} seconds`;
      }
    }
    case "step-range": {
      const { start, end, step } = pattern;
      switch (def.key) {
        case "minute":
          return `Every ${step} minutes from ${start} through ${end}`;
        case "hour":
          return `Every ${step} hours from ${clock(start)} through ${clock(end)}`;
        case "dayOfMonth":
          return `Every ${step} days from the ${ordinal(start)} through the ${ordinal(end)}`;
        case "month":
          return `Every ${step} months from ${MONTH_NAMES[start - 1]} through ${MONTH_NAMES[end - 1]}`;
        case "dayOfWeek":
          return `Every ${step} days from ${WEEKDAY_NAMES[start]} through ${WEEKDAY_NAMES[end]}`;
        default:
          return `Every ${step} seconds from ${start} through ${end}`;
      }
    }
    case "list":
    default: {
      switch (def.key) {
        case "minute":
          return `At minutes ${capped(values.map(String))}`;
        case "hour":
          return `At ${capped(values.map((hour) => clock(hour)), 6)}`;
        case "dayOfMonth":
          return `On the ${capped(values.map(ordinal))}`;
        case "month":
          return capped(values.map((month) => MONTH_NAMES[month - 1] ?? String(month)), 6);
        case "dayOfWeek":
          return `On ${capped(values.map((day) => WEEKDAY_NAMES[day] ?? String(day)), 6)}`;
        default:
          return `At seconds ${capped(values.map(String))}`;
      }
    }
  }
}

function lowerClause(text: string): string {
  return text.replace(/^On\b/, "on").replace(/^Every\b/, "every").replace(/^Between\b/, "between");
}

function secondsQualifier(field: ParsedField): string {
  const pattern = field.pattern;
  switch (pattern.kind) {
    case "single":
      return `at second ${pattern.value}`;
    case "range":
      return `at seconds ${pattern.start} through ${pattern.end}`;
    case "step-all":
      return `at every ${ordinal(pattern.step)} second`;
    case "step-range":
      return `at every ${ordinal(pattern.step)} second from ${pattern.start} through ${pattern.end}`;
    case "list":
      return `at seconds ${capped(field.values.map(String), 6)}`;
    case "wildcard":
    default:
      return "at every second";
  }
}

function monthPhrase(field: ParsedField): string {
  const pattern = field.pattern;
  switch (pattern.kind) {
    case "single":
      return MONTH_NAMES[pattern.value - 1] ?? String(pattern.value);
    case "range":
      return `${MONTH_NAMES[pattern.start - 1]} through ${MONTH_NAMES[pattern.end - 1]}`;
    case "step-all":
      return `every ${pattern.step} months`;
    case "step-range":
      return `every ${pattern.step} months from ${MONTH_NAMES[pattern.start - 1]} through ${MONTH_NAMES[pattern.end - 1]}`;
    case "list":
      return capped(field.values.map((month) => MONTH_NAMES[month - 1] ?? String(month)), 6);
    case "wildcard":
    default:
      return "every month";
  }
}

function indexFields(fields: ParsedField[]): Partial<Record<FieldKey, ParsedField>> {
  const map: Partial<Record<FieldKey, ParsedField>> = {};
  for (const field of fields) map[field.key] = field;
  return map;
}

function buildSummary(fields: ParsedField[], usesSeconds: boolean): string {
  const map = indexFields(fields);
  const { minute, hour, second, dayOfMonth, month, dayOfWeek } = map;
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return "";

  const minPattern = minute.pattern;
  const hourSpan = hoursSpan(hour.values);
  let time: string;

  if (minute.wildcard && hour.wildcard) {
    time = "Every minute";
  } else if (minPattern.kind === "step-all" && hour.wildcard) {
    time = `Every ${minPattern.step} minutes`;
  } else if (hour.wildcard) {
    time = `${minute.explanation} of every hour`;
  } else if (minute.wildcard) {
    time = `Every minute from ${hourSpan}`;
  } else if (minPattern.kind === "step-all") {
    time = `Every ${minPattern.step} minutes from ${hourSpan}`;
  } else if (minPattern.kind === "single" && hour.values.length === 1) {
    time = `At ${clock(hour.values[0]!, minPattern.value)}`;
  } else if (minPattern.kind === "single" && hour.values.length <= 6) {
    time = `At ${joinList(hour.values.map((value) => clock(value, minPattern.value)))}`;
  } else if (minPattern.kind === "list" && minute.values.length * hour.values.length <= 8) {
    const times: string[] = [];
    for (const h of hour.values) {
      for (const m of minute.values) times.push(clock(h, m));
    }
    time = `At ${joinList(times)}`;
  } else if (minPattern.kind === "step-range") {
    time = `Every ${minPattern.step} minutes from minute ${minPattern.start} through ${minPattern.end} during ${hourSpan}`;
  } else {
    time = `${minute.explanation} during ${hourSpan}`;
  }

  if (usesSeconds && second) {
    if (second.pattern.kind === "wildcard") {
      time = minute.wildcard && hour.wildcard ? "Every second" : `${time}, at every second`;
    } else if (second.pattern.kind === "step-all" && minute.wildcard && hour.wildcard) {
      time = `Every ${second.pattern.step} seconds`;
    } else if (!(second.pattern.kind === "single" && second.values[0] === 0)) {
      time = `${time}, ${secondsQualifier(second)}`;
    }
  }

  const dayUnrestricted = dayOfMonth.wildcard && dayOfWeek.wildcard;
  let dayClause = "";
  if (!dayUnrestricted) {
    if (dayOfWeek.wildcard) {
      dayClause = `, ${lowerClause(dayOfMonth.explanation)}`;
    } else if (dayOfMonth.wildcard) {
      dayClause = `, ${lowerClause(dayOfWeek.explanation)}`;
    } else {
      dayClause = `, ${lowerClause(dayOfMonth.explanation)} or ${lowerClause(dayOfWeek.explanation)}`;
    }
  }

  if (!month.wildcard) {
    const phrase = monthPhrase(month);
    const period = month.pattern.kind === "step-all" || month.pattern.kind === "step-range";
    if (dayUnrestricted) {
      dayClause = period ? `, every day, ${phrase}` : `, every day in ${phrase}`;
    } else {
      dayClause = `${dayClause}, ${period ? phrase : `in ${phrase}`}`;
    }
  } else if (dayUnrestricted && !(minute.wildcard && hour.wildcard)) {
    dayClause = ", every day";
  }

  const sentence = `${time}${dayClause}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function buildDayRule(fields: ParsedField[]): string {
  const map = indexFields(fields);
  const { dayOfMonth, dayOfWeek } = map;
  if (!dayOfMonth || !dayOfWeek) return "";
  if (dayOfMonth.wildcard && dayOfWeek.wildcard) {
    return "Both day fields are unrestricted, so every calendar date can fire.";
  }
  if (dayOfMonth.wildcard) {
    return `Day of week only: ${lowerClause(dayOfWeek.explanation)}. Day of month is unrestricted.`;
  }
  if (dayOfWeek.wildcard) {
    return `Day of month only: ${lowerClause(dayOfMonth.explanation)}. Day of week is unrestricted.`;
  }
  return `Both day fields are restricted, so either may match (OR): ${lowerClause(dayOfMonth.explanation)}, or ${lowerClause(dayOfWeek.explanation)}.`;
}

/* ------------------------------------------------------------------ */
/* Whole-expression parsing                                            */
/* ------------------------------------------------------------------ */

export function parseSchedule(input: string, withSeconds: boolean): ParsedSchedule {
  const defs = withSeconds ? FIELDS_6 : FIELDS_5;
  const trimmed = input.trim();
  const invalid = (problem: ScheduleProblem): ParsedSchedule => ({
    input,
    ok: false,
    usesSeconds: withSeconds,
    macro: null,
    expression: trimmed,
    fields: defs.map((def) => emptyField(def)),
    problems: [problem],
    summary: "",
    dayRule: "",
  });

  if (!trimmed) {
    return invalid({
      field: "expression",
      label: "Expression",
      message: "Type a cron expression to validate it.",
    });
  }

  let expression = trimmed;
  let macro: string | null = null;
  if (trimmed.startsWith("@")) {
    const key = trimmed.toLowerCase();
    const expansion = MACROS[key];
    if (!expansion) {
      return invalid({
        field: "expression",
        label: "Shortcut",
        message: `Unknown shortcut "${trimmed}". Supported: @hourly, @daily, @midnight, @weekly, @monthly, @yearly.`,
      });
    }
    macro = key;
    expression = withSeconds ? `0 ${expansion}` : expansion;
  }

  const tokens = expression.split(/\s+/);
  if (tokens.length !== defs.length) {
    const expected = withSeconds
      ? "6 fields (second minute hour day-of-month month day-of-week)"
      : "5 fields (minute hour day-of-month month day-of-week)";
    const hint =
      !withSeconds && tokens.length === 6
        ? " Enable the seconds field for a leading seconds token."
        : withSeconds && tokens.length === 5
          ? " Turn off the seconds field to use a 5-field expression."
          : "";
    return invalid({
      field: "expression",
      label: "Expression",
      message: `Expected ${expected}, found ${tokens.length}.${hint}`,
    });
  }

  const fields = defs.map((def, index) => consumeField(tokens[index]!, def));
  const problems: ScheduleProblem[] = fields
    .filter((field): field is ParsedField & { error: string } => field.error !== null)
    .map((field) => ({ field: field.key, label: field.label, message: field.error }));

  if (problems.length > 0) {
    return {
      input,
      ok: false,
      usesSeconds: withSeconds,
      macro,
      expression: tokens.join(" "),
      fields,
      problems,
      summary: "",
      dayRule: "",
    };
  }

  return {
    input,
    ok: true,
    usesSeconds: withSeconds,
    macro,
    expression: tokens.join(" "),
    fields,
    problems: [],
    summary: buildSummary(fields, withSeconds),
    dayRule: buildDayRule(fields),
  };
}

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

function dayMatches(date: Date, dayOfMonth: ParsedField, dayOfWeek: ParsedField): boolean {
  const domHit = dayOfMonth.set[date.getDate()] === true;
  const dowHit = dayOfWeek.set[date.getDay()] === true;
  if (dayOfMonth.wildcard && dayOfWeek.wildcard) return true;
  if (dayOfMonth.wildcard) return dowHit;
  if (dayOfWeek.wildcard) return domHit;
  return domHit || dowHit;
}

interface WalkResult {
  steps: number;
  stoppedByVisitor: boolean;
}

/**
 * Bounded local-time walk. Jumps field by field (month -> day -> hour -> minute
 * -> second) so ordinary schedules resolve in a handful of steps; the step cap
 * turns impossible dates into a graceful failure instead of a hang.
 */
function walk(
  schedule: ParsedSchedule,
  from: Date,
  maxSteps: number,
  visit: (date: Date) => boolean,
): WalkResult {
  if (!schedule.ok || maxSteps <= 0) return { steps: 0, stoppedByVisitor: false };
  const map = indexFields(schedule.fields);
  const { minute, hour, dayOfMonth, month, dayOfWeek, second } = map;
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return { steps: 0, stoppedByVisitor: false };
  }

  const withSeconds = schedule.usesSeconds && second !== undefined;
  const startMs = withSeconds
    ? Math.floor(from.getTime() / 1000) * 1000 + 1000
    : Math.floor(from.getTime() / 60000) * 60000 + 60000;

  let cursor = startMs;
  let steps = 0;

  while (steps < maxSteps) {
    steps += 1;
    const date = new Date(cursor);

    if (!month.set[date.getMonth() + 1]) {
      cursor = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
      continue;
    }
    if (!dayMatches(date, dayOfMonth, dayOfWeek)) {
      cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime();
      continue;
    }
    if (!hour.set[date.getHours()]) {
      cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() + 1, 0, 0, 0).getTime();
      continue;
    }
    if (!minute.set[date.getMinutes()]) {
      cursor = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes() + 1,
        0,
        0,
      ).getTime();
      continue;
    }
    if (withSeconds && second && !second.set[date.getSeconds()]) {
      cursor += 1000;
      continue;
    }

    const keepGoing = visit(date);
    if (!keepGoing) return { steps, stoppedByVisitor: true };

    cursor = withSeconds
      ? cursor + 1000
      : new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          date.getHours(),
          date.getMinutes() + 1,
          0,
          0,
        ).getTime();
  }

  return { steps, stoppedByVisitor: false };
}

export interface ProjectionResult {
  runs: Date[];
  /** True when the run list is shorter than requested because the step cap was hit. */
  exhausted: boolean;
  steps: number;
}

export function nextRuns(schedule: ParsedSchedule, from: Date, count: number, maxSteps = MAX_STEPS): ProjectionResult {
  const runs: Date[] = [];
  if (!schedule.ok || count <= 0) return { runs, exhausted: false, steps: 0 };
  const result = walk(schedule, from, maxSteps, (date) => {
    runs.push(date);
    return runs.length < count;
  });
  return { runs, exhausted: runs.length < count, steps: result.steps };
}

export interface RunCount {
  count: number;
  /** True when the counter stopped at the step cap before reaching the horizon. */
  capped: boolean;
}

export function countRuns(schedule: ParsedSchedule, from: Date, until: Date, maxSteps = COUNT_STEPS): RunCount {
  if (!schedule.ok) return { count: 0, capped: false };
  const limit = until.getTime();
  let count = 0;
  const result = walk(schedule, from, maxSteps, (date) => {
    if (date.getTime() > limit) return false;
    count += 1;
    return true;
  });
  return { count, capped: !result.stoppedByVisitor && result.steps >= maxSteps };
}

export interface DensityDay {
  date: Date;
  weekday: string;
  /** Firings per local hour (index 0-23). */
  counts: number[];
  total: number;
}

/** Firing density per hour for `days` calendar days starting today. */
export function densityByHour(schedule: ParsedSchedule, days = 7, from = new Date()): DensityDay[] {
  if (!schedule.ok) return [];
  const map = indexFields(schedule.fields);
  const { minute, hour, dayOfMonth, dayOfWeek, second } = map;
  if (!minute || !hour || !dayOfMonth || !dayOfWeek) return [];

  const perHour = minute.values.length * (schedule.usesSeconds && second ? second.values.length : 1);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const out: DensityDay[] = [];

  for (let index = 0; index < days; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const active = dayMatches(date, dayOfMonth, dayOfWeek);
    const counts = Array.from({ length: 24 }, (_, h) => (active && hour.set[h] ? perHour : 0));
    out.push({
      date,
      weekday: WEEKDAY_NAMES[date.getDay()] ?? "",
      counts,
      total: counts.reduce((sum, value) => sum + value, 0),
    });
  }

  return out;
}
