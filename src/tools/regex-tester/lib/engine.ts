/**
 * Local RegExp execution engine for the Regex Tester.
 *
 * Pure functions only: the same code runs inside the Web Worker and in the
 * synchronous fallback (when workers are unavailable). Every loop is capped by
 * match count and a wall-clock budget so a pathological pattern can never pin a
 * thread forever; the worker additionally gets terminated by the caller.
 */

export type Flag = "g" | "i" | "m" | "s" | "u" | "y";

export const FLAG_ORDER: Flag[] = ["g", "i", "m", "s", "u", "y"];

export const FLAG_META: Record<Flag, { name: string; description: string }> = {
  g: { name: "Global", description: "Find every match, not just the first" },
  i: { name: "Ignore case", description: "Case-insensitive matching" },
  m: { name: "Multiline", description: "^ and $ match at every line break" },
  s: { name: "dotAll", description: "Dot also matches newlines" },
  u: { name: "Unicode", description: "Full Unicode code-point semantics" },
  y: { name: "Sticky", description: "Match only at the current lastIndex" },
};

export const DEBOUNCE_MS = 200;
export const TIME_BUDGET_MS = 250;
export const HARD_TIMEOUT_MS = 1500;
export const MAX_MATCHES = 1000;
export const MAX_REPLACE_OUTPUT = 2_000_000;
export const DISPLAY_LIMIT = 150;

const D_SUPPORTED = (() => {
  try {
    new RegExp("", "d");
    return true;
  } catch {
    return false;
  }
})();

export interface CaptureGroup {
  number: number;
  name: string | null;
  value: string | null;
  start: number | null;
  end: number | null;
}

export interface CapturedMatch {
  start: number;
  end: number;
  text: string;
  groups: CaptureGroup[];
}

export interface PatternAnalysis {
  groupCount: number;
  names: Map<number, string>;
  named: string[];
}

export interface EvalSuccess {
  ok: true;
  matches: CapturedMatch[];
  elapsedMs: number;
  groupCount: number;
  namedGroups: string[];
  zeroWidth: number;
  truncated: boolean;
  budgetExceeded: boolean;
}

export interface EvalFailure {
  ok: false;
  error: string;
  elapsedMs: number;
  timedOut: boolean;
  partialMatches: number;
  hitLimit: boolean;
}

export type EvalResult = EvalSuccess | EvalFailure;

export interface ReplaceSuccess {
  ok: true;
  output: string;
  count: number;
  elapsedMs: number;
  truncated: boolean;
  budgetExceeded: boolean;
}

export interface ReplaceFailure {
  ok: false;
  error: string;
  elapsedMs: number;
  timedOut: boolean;
}

export type ReplaceResult = ReplaceSuccess | ReplaceFailure;

export type WorkerRequest =
  | { id: number; kind: "evaluate"; pattern: string; flags: string; text: string }
  | { id: number; kind: "replace"; pattern: string; flags: string; text: string; template: string };

export type WorkerResponse =
  | { id: number; kind: "evaluate"; result: EvalResult }
  | { id: number; kind: "replace"; result: ReplaceResult };

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeFlags(raw: string): string {
  const picked = new Set(raw.split("").filter((char) => (FLAG_ORDER as string[]).includes(char)));
  return FLAG_ORDER.filter((flag) => picked.has(flag)).join("");
}

function iterationFlags(flags: string): string {
  const normalized = normalizeFlags(flags);
  const withGlobal = normalized.includes("g") ? normalized : `g${normalized}`;
  return D_SUPPORTED ? `${withGlobal}d` : withGlobal;
}

/** Count capture groups and their names without executing the pattern. */
export function analyzePattern(pattern: string): PatternAnalysis {
  const names = new Map<number, string>();
  let groupCount = 0;
  let inClass = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char !== "(") continue;

    if (pattern[i + 1] !== "?") {
      groupCount += 1;
      continue;
    }

    const rest = pattern.slice(i + 2);
    if (rest.startsWith(":") || rest.startsWith("=") || rest.startsWith("!") || rest.startsWith("<=") || rest.startsWith("<!")) {
      continue;
    }
    const named = /^<([A-Za-z_$][\w$]*)>/.exec(rest);
    if (named) {
      groupCount += 1;
      names.set(groupCount, named[1]);
    }
  }

  return { groupCount, names, named: [...names.values()] };
}

/**
 * Cheap pre-flight heuristic: a quantified group that already contains an
 * unbounded quantifier is the classic exponential-backtracking shape.
 */
export function looksCatastrophic(pattern: string): boolean {
  if (!pattern) return false;
  const nestedGroup = /\((?:[^()\\]|\\.)*(?:[*+]|\{\d+,\})(?:[^()\\]|\\.)*\)(?:[*+]|\{\d+,\})/.test(pattern);
  const repeatedAny = /(?:\.\*|\.\+)(?:[^()\\]|\\.){0,40}(?:\.\*|\.\+)/.test(pattern);
  return nestedGroup || repeatedAny;
}

function advanceIndex(text: string, index: number, unicode: boolean): number {
  if (!unicode) return index + 1;
  const first = text.charCodeAt(index);
  if (first >= 0xd800 && first <= 0xdbff) {
    const second = text.charCodeAt(index + 1);
    if (second >= 0xdc00 && second <= 0xdfff) return index + 2;
  }
  return index + 1;
}

function toMatch(exec: RegExpExecArray, analysis: PatternAnalysis): CapturedMatch {
  const indices = (exec as RegExpExecArray & { indices?: [number, number][] }).indices;
  const count = Math.max(analysis.groupCount, exec.length - 1);
  const groups: CaptureGroup[] = [];

  for (let i = 1; i <= count; i += 1) {
    const value: string | undefined = exec[i];
    const pair = indices?.[i];
    groups.push({
      number: i,
      name: analysis.names.get(i) ?? null,
      value: value === undefined ? null : value,
      start: pair ? pair[0] : null,
      end: pair ? pair[1] : null,
    });
  }

  return { start: exec.index, end: exec.index + exec[0].length, text: exec[0], groups };
}

export function evaluate(pattern: string, flags: string, text: string): EvalResult {
  const started = now();
  const analysis = analyzePattern(pattern);
  const normalized = normalizeFlags(flags);

  if (pattern.length === 0) {
    return {
      ok: true,
      matches: [],
      elapsedMs: now() - started,
      groupCount: 0,
      namedGroups: [],
      zeroWidth: 0,
      truncated: false,
      budgetExceeded: false,
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, iterationFlags(normalized));
  } catch (error) {
    return { ok: false, error: messageOf(error), elapsedMs: now() - started, timedOut: false, partialMatches: 0, hitLimit: false };
  }

  const matches: CapturedMatch[] = [];
  const global = normalized.includes("g");
  let zeroWidth = 0;
  let truncated = false;
  let budgetExceeded = false;

  try {
    let exec: RegExpExecArray | null;
    while ((exec = regex.exec(text)) !== null) {
      matches.push(toMatch(exec, analysis));

      if (exec[0].length === 0) {
        zeroWidth += 1;
        const next = advanceIndex(text, regex.lastIndex, normalized.includes("u"));
        regex.lastIndex = next;
        if (next > text.length) break;
      }

      if (!global) break;
      if (matches.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
      if (now() - started >= TIME_BUDGET_MS) {
        budgetExceeded = true;
        break;
      }
    }
  } catch (error) {
    return { ok: false, error: messageOf(error), elapsedMs: now() - started, timedOut: false, partialMatches: matches.length, hitLimit: true };
  }

  return {
    ok: true,
    matches,
    elapsedMs: now() - started,
    groupCount: analysis.groupCount,
    namedGroups: analysis.named,
    zeroWidth,
    truncated,
    budgetExceeded,
  };
}

function expandTemplate(template: string, exec: RegExpExecArray, text: string): string {
  if (!template.includes("$")) return template;

  return template.replace(/\$(\$|&|`|'|<([^>]*)>|\d{1,2})/g, (token: string, group: string, name?: string) => {
    if (group === "$") return "$";
    if (group === "&") return exec[0];
    if (group === "`") return text.slice(0, exec.index);
    if (group === "'") return text.slice(exec.index + exec[0].length);
    if (name !== undefined) return exec.groups?.[name] ?? "";

    const index = Number(group);
    if (index === 0) return token;
    return exec[index] ?? "";
  });
}

export function replaceAllMatches(pattern: string, flags: string, text: string, template: string): ReplaceResult {
  const started = now();

  if (pattern.length === 0) {
    return { ok: false, error: "The pattern is empty — nothing to replace.", elapsedMs: now() - started, timedOut: false };
  }

  const normalized = normalizeFlags(flags);
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, iterationFlags(normalized));
  } catch (error) {
    return { ok: false, error: messageOf(error), elapsedMs: now() - started, timedOut: false };
  }

  const global = normalized.includes("g");
  const parts: string[] = [];
  let cursor = 0;
  let produced = 0;
  let count = 0;
  let truncated = false;
  let budgetExceeded = false;

  try {
    let exec: RegExpExecArray | null;
    while ((exec = regex.exec(text)) !== null) {
      const chunk = text.slice(cursor, exec.index);
      const replacement = expandTemplate(template, exec, text);
      parts.push(chunk);
      parts.push(replacement);
      produced += chunk.length + replacement.length;
      cursor = exec.index + exec[0].length;
      count += 1;

      if (exec[0].length === 0) {
        const next = advanceIndex(text, regex.lastIndex, normalized.includes("u"));
        regex.lastIndex = next;
        if (next > text.length) break;
      }

      if (!global) break;
      if (count >= MAX_MATCHES || produced >= MAX_REPLACE_OUTPUT) {
        truncated = true;
        break;
      }
      if (now() - started >= TIME_BUDGET_MS) {
        budgetExceeded = true;
        truncated = true;
        break;
      }
    }
  } catch (error) {
    return { ok: false, error: messageOf(error), elapsedMs: now() - started, timedOut: false };
  }

  parts.push(text.slice(cursor));
  let output = parts.join("");
  if (output.length > MAX_REPLACE_OUTPUT) {
    output = output.slice(0, MAX_REPLACE_OUTPUT);
    truncated = true;
  }

  return { ok: true, output, count, elapsedMs: now() - started, truncated, budgetExceeded };
}

export function evaluationTimeout(elapsedMs: number): EvalFailure {
  return {
    ok: false,
    error: `Execution exceeded ${elapsedMs} ms and was terminated. The pattern most likely backtracks catastrophically on this input — simplify nested quantifiers or shorten the text.`,
    elapsedMs,
    timedOut: true,
    partialMatches: 0,
    hitLimit: true,
  };
}

export function replacementTimeout(elapsedMs: number): ReplaceFailure {
  return {
    ok: false,
    error: `Replacement exceeded ${elapsedMs} ms and was terminated. The pattern most likely backtracks catastrophically on this input.`,
    elapsedMs,
    timedOut: true,
  };
}

export function formatMs(value: number): string {
  if (value < 1) return `${value.toFixed(2)} ms`;
  if (value < 10) return `${value.toFixed(1)} ms`;
  return `${Math.round(value)} ms`;
}
