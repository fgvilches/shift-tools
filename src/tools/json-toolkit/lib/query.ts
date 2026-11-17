/**
 * A deliberately small path language. Exact grammar:
 *
 *   query  = [ "$" ] segment*
 *   segment= "." key | "[" index "]" | "[" quote key quote "]" | "[" "*" "]" | ".*"
 *   key    = any characters except "." "[" "]" (surrounding spaces trimmed)
 *   index  = integer; negative counts from the end (-1 = last)
 *
 * No filters, slices, unions or recursive descent — those are rejected with
 * an explanation instead of silently returning nothing.
 */

import { isPlainObject } from "./json";

export type PathSegment = { kind: "key"; key: string } | { kind: "index"; index: number } | { kind: "wildcard" };

export interface QueryFailure {
  ok: false;
  message: string;
  hint: string;
}

export interface QueryMatch {
  path: (string | number)[];
  value: unknown;
}

export interface QuerySuccess {
  ok: true;
  segments: PathSegment[];
  matches: QueryMatch[];
  normalized: string;
  truncated: boolean;
}

export type QueryResult = QuerySuccess | QueryFailure;

const MAX_MATCHES = 5000;

function readKey(source: string, start: number): { key: string; next: number } {
  let index = start;
  while (index < source.length && source[index] !== "." && source[index] !== "[" && source[index] !== "]") {
    index += 1;
  }
  return { key: source.slice(start, index).trim(), next: index };
}

export function parseQuery(expression: string): { ok: true; segments: PathSegment[] } | QueryFailure {
  const source = expression.trim();
  if (source.length === 0) {
    return {
      ok: false,
      message: "Enter a path first",
      hint: "Examples: $.users[0].email · $[*].id · users[*].name",
    };
  }

  const segments: PathSegment[] = [];
  let index = 0;
  if (source[0] === "$") index = 1;

  while (index < source.length) {
    const char = source[index];

    if (char === ".") {
      if (source[index + 1] === ".") {
        return {
          ok: false,
          message: "Recursive descent (..) is not supported",
          hint: "Walk the levels explicitly, e.g. $.users[*].metrics.qps.",
        };
      }
      if (source[index + 1] === "*") {
        segments.push({ kind: "wildcard" });
        index += 2;
        continue;
      }
      const { key, next } = readKey(source, index + 1);
      if (key.length === 0) {
        return { ok: false, message: "Empty path segment", hint: "Two dots in a row leave a key out — remove one of them." };
      }
      segments.push({ kind: "key", key });
      index = next;
      continue;
    }

    if (char === "[") {
      const close = source.indexOf("]", index);
      if (close === -1) {
        return { ok: false, message: "Missing closing ]", hint: "Every [ needs a matching ]." };
      }
      const inner = source.slice(index + 1, close).trim();
      index = close + 1;

      if (inner === "*") {
        segments.push({ kind: "wildcard" });
        continue;
      }
      if (/^-?\d+$/.test(inner)) {
        segments.push({ kind: "index", index: Number(inner) });
        continue;
      }
      const quoted =
        (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2) ||
        (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2);
      if (quoted) {
        const raw = inner.slice(1, -1);
        const key = raw.replace(/\\(.)/g, "$1");
        if (key.length === 0) {
          return { ok: false, message: "Empty quoted key", hint: 'A quoted key needs at least one character, e.g. ["a.b"].' };
        }
        segments.push({ kind: "key", key });
        continue;
      }
      if (inner.startsWith("?")) {
        return {
          ok: false,
          message: "Filter expressions are not supported",
          hint: "Select with [*] or [n], then read the fields you need from the matches.",
        };
      }
      if (inner.includes(":")) {
        return {
          ok: false,
          message: "Slices are not supported",
          hint: "Pick single indexes ([0], [-1]) or the whole array ([*]).",
        };
      }
      return {
        ok: false,
        message: `Unsupported selector "[${inner}]"`,
        hint: 'Use an index ([0], [-1]), a wildcard ([*]) or a quoted key (["a.b"]).',
      };
    }

    if (index === 0 || (index === 1 && source[0] === "$")) {
      const { key, next } = readKey(source, index);
      if (key.length === 0) {
        return {
          ok: false,
          message: `Unexpected "${char}"`,
          hint: "A path starts with an optional $, then keys, indexes and wildcards.",
        };
      }
      segments.push({ kind: "key", key });
      index = next;
      continue;
    }

    return {
      ok: false,
      message: `Unexpected "${char}"`,
      hint: 'Separate keys with ".", and use [n] or [*] for arrays.',
    };
  }

  if (source === "$") return { ok: true, segments: [] };
  return { ok: true, segments };
}

export function formatPath(path: (string | number)[]): string {
  let out = "$";
  for (const part of path) {
    if (typeof part === "number") {
      out += `[${part}]`;
    } else if (/^[A-Za-z_$][\w$-]*$/.test(part)) {
      out += `.${part}`;
    } else {
      out += `[${JSON.stringify(part)}]`;
    }
  }
  return out;
}

export function normalizeQuery(segments: PathSegment[]): string {
  let out = "$";
  for (const segment of segments) {
    if (segment.kind === "key") out += /^[A-Za-z_$][\w$-]*$/.test(segment.key) ? `.${segment.key}` : `[${JSON.stringify(segment.key)}]`;
    else if (segment.kind === "index") out += `[${segment.index}]`;
    else out += "[*]";
  }
  return out;
}

export function runQuery(root: unknown, expression: string): QueryResult {
  const parsed = parseQuery(expression);
  if (!parsed.ok) return parsed;

  let current: QueryMatch[] = [{ path: [], value: root }];
  let truncated = false;

  for (const segment of parsed.segments) {
    const next: QueryMatch[] = [];
    for (const match of current) {
      const value = match.value;
      if (segment.kind === "key") {
        if (isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, segment.key)) {
          next.push({ path: [...match.path, segment.key], value: value[segment.key] });
        }
      } else if (segment.kind === "index") {
        if (Array.isArray(value)) {
          const target = segment.index < 0 ? value.length + segment.index : segment.index;
          if (target >= 0 && target < value.length) {
            next.push({ path: [...match.path, target], value: value[target] });
          }
        }
      } else if (Array.isArray(value)) {
        value.forEach((entry, position) => next.push({ path: [...match.path, position], value: entry }));
      } else if (isPlainObject(value)) {
        for (const [key, entry] of Object.entries(value)) next.push({ path: [...match.path, key], value: entry });
      }
      if (next.length > MAX_MATCHES) {
        truncated = true;
        break;
      }
    }
    current = truncated ? next.slice(0, MAX_MATCHES) : next;
    if (current.length === 0) break;
  }

  return {
    ok: true,
    segments: parsed.segments,
    matches: current,
    normalized: normalizeQuery(parsed.segments),
    truncated,
  };
}
