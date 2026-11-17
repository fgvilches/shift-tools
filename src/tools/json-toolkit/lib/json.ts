/**
 * Dependency-free JSON parser.
 *
 * `JSON.parse` is used for nothing here on purpose: WebKit reports errors
 * without a position ("JSON Parse error: Unexpected identifier"), and this
 * tool's whole value is pointing at the exact offending line. The grammar is
 * RFC 8259; the parser also surfaces the first duplicate-free error only.
 */

export type IndentOption = 2 | 4 | "tab";

export interface ParseFailure {
  message: string;
  line: number;
  column: number;
  hint: string;
}

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: ParseFailure };

const MAX_DEPTH = 256;
const NUMBER_PATTERN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

class JsonSyntaxError extends Error {
  readonly offset: number;
  readonly hint: string;

  constructor(message: string, offset: number, hint: string) {
    super(message);
    this.name = "JsonSyntaxError";
    this.offset = offset;
    this.hint = hint;
  }
}

interface Cursor {
  text: string;
  i: number;
}

function syntax(cursor: Cursor, message: string, hint: string, at = cursor.i): never {
  throw new JsonSyntaxError(message, at, hint);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeChar(char: string | undefined): string {
  if (char === undefined) return "end of input";
  const code = char.charCodeAt(0);
  if (code < 0x20) return `\\u${code.toString(16).padStart(4, "0")}`;
  return `"${char}"`;
}

function skipWhitespace(cursor: Cursor): void {
  const { text } = cursor;
  while (cursor.i < text.length) {
    const char = text[cursor.i];
    if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\uFEFF") cursor.i += 1;
    else break;
  }
}

function parseString(cursor: Cursor): string {
  const { text } = cursor;
  const openedAt = cursor.i;
  cursor.i += 1;
  let out = "";
  let chunk = cursor.i;

  for (;;) {
    if (cursor.i >= text.length) {
      syntax(cursor, "Unterminated string", "A string is missing its closing double quote.", openedAt);
    }
    const char = text[cursor.i];
    if (char === '"') {
      out += text.slice(chunk, cursor.i);
      cursor.i += 1;
      return out;
    }
    if (char === "\\") {
      out += text.slice(chunk, cursor.i);
      const escape = text[cursor.i + 1];
      switch (escape) {
        case '"':
          out += '"';
          cursor.i += 2;
          break;
        case "\\":
          out += "\\";
          cursor.i += 2;
          break;
        case "/":
          out += "/";
          cursor.i += 2;
          break;
        case "b":
          out += "\b";
          cursor.i += 2;
          break;
        case "f":
          out += "\f";
          cursor.i += 2;
          break;
        case "n":
          out += "\n";
          cursor.i += 2;
          break;
        case "r":
          out += "\r";
          cursor.i += 2;
          break;
        case "t":
          out += "\t";
          cursor.i += 2;
          break;
        case "u": {
          const hex = text.slice(cursor.i + 2, cursor.i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            syntax(cursor, "Invalid \\u escape", "A \\u escape needs exactly four hexadecimal digits, e.g. \\u00e9.");
          }
          out += String.fromCharCode(parseInt(hex, 16));
          cursor.i += 6;
          break;
        }
        default:
          syntax(
            cursor,
            `Invalid escape sequence "\\${escape ?? ""}"`,
            'Valid escapes are \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.',
          );
      }
      chunk = cursor.i;
      continue;
    }
    if (char.charCodeAt(0) < 0x20) {
      syntax(cursor, "Raw control character in string", "Escape line breaks and tabs as \\n and \\t inside strings.");
    }
    cursor.i += 1;
  }
}

function parseNumber(cursor: Cursor): number {
  const { text } = cursor;
  NUMBER_PATTERN.lastIndex = cursor.i;
  const match = NUMBER_PATTERN.exec(text);
  if (!match) {
    syntax(cursor, "Invalid number", "Numbers are digits with an optional sign, fraction and exponent — e.g. -12.5e3.");
  }
  const end = NUMBER_PATTERN.lastIndex;
  const next: string | undefined = text[end];
  if (next !== undefined && next !== " " && next !== "\t" && next !== "\n" && next !== "\r" && next !== "," && next !== "]" && next !== "}") {
    syntax(cursor, `Unexpected ${describeChar(next)} inside a number`, "Only one number per value; digits cannot follow the exponent directly.", end);
  }
  cursor.i = end;
  return Number(match[0]);
}

function parseLiteral(cursor: Cursor, literal: string, value: unknown): unknown {
  const { text } = cursor;
  if (!text.startsWith(literal, cursor.i)) {
    const rest = text.slice(cursor.i, cursor.i + literal.length);
    syntax(cursor, `Invalid literal "${rest}"`, `Expected "${literal}", lowercase and unquoted.`);
  }
  cursor.i += literal.length;
  return value;
}

function parseObject(cursor: Cursor, depth: number): Record<string, unknown> {
  const { text } = cursor;
  const openedAt = cursor.i;
  cursor.i += 1;
  const result: Record<string, unknown> = {};

  skipWhitespace(cursor);
  if (text[cursor.i] === "}") {
    cursor.i += 1;
    return result;
  }

  for (;;) {
    skipWhitespace(cursor);
    const keyChar: string | undefined = text[cursor.i];
    if (keyChar === undefined) {
      syntax(cursor, "Unexpected end of input", 'The object is missing its closing "}".', openedAt);
    }
    if (keyChar !== '"') {
      if (keyChar === "'") {
        syntax(cursor, "Property names must use double quotes", "JSON has no single-quoted strings — replace ' with \".");
      }
      if (keyChar === "}") {
        syntax(cursor, 'Trailing comma before "}"', "Remove the comma after the last property.", cursor.i - 1);
      }
      syntax(cursor, `Expected a property name, found ${describeChar(keyChar)}`, "Object keys must be double-quoted strings.");
    }

    const key = parseString(cursor);
    skipWhitespace(cursor);
    if (text[cursor.i] !== ":") {
      syntax(cursor, `Expected ":" after property name "${key}"`, "Every key needs a value, separated by a colon.");
    }
    cursor.i += 1;
    result[key] = parseValue(cursor, depth);

    skipWhitespace(cursor);
    const next: string | undefined = text[cursor.i];
    if (next === ",") {
      const commaAt = cursor.i;
      cursor.i += 1;
      skipWhitespace(cursor);
      if (text[cursor.i] === "}") {
        syntax(cursor, 'Trailing comma before "}"', "Remove the comma after the last property.", commaAt);
      }
      continue;
    }
    if (next === "}") {
      cursor.i += 1;
      return result;
    }
    if (next === undefined) {
      syntax(cursor, "Unexpected end of input", 'The object is missing its closing "}".');
    }
    syntax(cursor, `Expected "," or "}", found ${describeChar(next)}`, 'Properties are comma-separated and the object ends with "}".');
  }
}

function parseArray(cursor: Cursor, depth: number): unknown[] {
  const { text } = cursor;
  const openedAt = cursor.i;
  cursor.i += 1;
  const result: unknown[] = [];

  skipWhitespace(cursor);
  if (text[cursor.i] === "]") {
    cursor.i += 1;
    return result;
  }

  for (;;) {
    skipWhitespace(cursor);
    if (text[cursor.i] === "]") {
      syntax(cursor, 'Trailing comma before "]"', "Remove the comma after the last element.", cursor.i - 1);
    }
    result.push(parseValue(cursor, depth));
    skipWhitespace(cursor);
    const next: string | undefined = text[cursor.i];
    if (next === ",") {
      const commaAt = cursor.i;
      cursor.i += 1;
      skipWhitespace(cursor);
      if (text[cursor.i] === "]") {
        syntax(cursor, 'Trailing comma before "]"', "Remove the comma after the last element.", commaAt);
      }
      continue;
    }
    if (next === "]") {
      cursor.i += 1;
      return result;
    }
    if (next === undefined) {
      syntax(cursor, "Unexpected end of input", 'The array is missing its closing "]".', openedAt);
    }
    syntax(cursor, `Expected "," or "]", found ${describeChar(next)}`, 'Elements are comma-separated and the array ends with "]".');
  }
}

function parseValue(cursor: Cursor, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    syntax(cursor, `Nesting deeper than ${MAX_DEPTH} levels`, "Flatten the document or split it into smaller parts.");
  }
  skipWhitespace(cursor);
  const char: string | undefined = cursor.text[cursor.i];
  if (char === undefined) {
    syntax(cursor, "Unexpected end of input", "The document ends before a value is complete.");
  }
  switch (char) {
    case "{":
      return parseObject(cursor, depth + 1);
    case "[":
      return parseArray(cursor, depth + 1);
    case '"':
      return parseString(cursor);
    case "t":
      return parseLiteral(cursor, "true", true);
    case "f":
      return parseLiteral(cursor, "false", false);
    case "n":
      return parseLiteral(cursor, "null", null);
    default:
      if (char === "-" || (char >= "0" && char <= "9")) return parseNumber(cursor);
      if (char === "'") {
        syntax(cursor, "String values must use double quotes", "JSON has no single-quoted strings — replace ' with \".");
      }
      syntax(
        cursor,
        `Unexpected character ${describeChar(char)}`,
        "A value must be an object, array, string, number, true, false or null.",
      );
  }
}

/** Converts a UTF-16 offset into a 1-based line and column. */
export function locate(text: string, offset: number): { line: number; column: number } {
  const limit = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;
  for (let index = 0; index < limit; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

export function parseJson(text: string): JsonParseResult {
  if (text.trim().length === 0) {
    return {
      ok: false,
      error: {
        message: "The buffer is empty",
        line: 1,
        column: 1,
        hint: "Paste a JSON document or load the sample.",
      },
    };
  }

  const cursor: Cursor = { text, i: 0 };
  try {
    skipWhitespace(cursor);
    const value = parseValue(cursor, 0);
    skipWhitespace(cursor);
    if (cursor.i < text.length) {
      syntax(
        cursor,
        `Unexpected ${describeChar(text[cursor.i])} after the document`,
        "A buffer holds exactly one JSON value — remove anything that follows it.",
      );
    }
    return { ok: true, value };
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      const { line, column } = locate(text, error.offset);
      return { ok: false, error: { message: error.message, line, column, hint: error.hint } };
    }
    throw error;
  }
}

export function indentUnit(indent: IndentOption): string | number {
  return indent === "tab" ? "\t" : indent;
}

export function indentLabel(indent: IndentOption): string {
  return indent === "tab" ? "Tab" : `${indent} spaces`;
}

export function formatJson(value: unknown, indent: IndentOption): string {
  const text = JSON.stringify(value, null, indentUnit(indent));
  return text ?? "null";
}

export function minifyJson(value: unknown): string {
  const text = JSON.stringify(value);
  return text ?? "null";
}

/** Recursively sorts object keys A→Z while preserving array order. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortKeysDeep(entry));
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b, "en"))) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

export interface JsonStats {
  nodes: number;
  keys: number;
  objects: number;
  arrays: number;
  primitives: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  maxDepth: number;
  longestArray: number;
}

export function jsonStats(value: unknown): JsonStats {
  const stats: JsonStats = {
    nodes: 0,
    keys: 0,
    objects: 0,
    arrays: 0,
    primitives: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    maxDepth: 0,
    longestArray: 0,
  };

  const walk = (node: unknown, depth: number): void => {
    stats.nodes += 1;
    if (depth > stats.maxDepth) stats.maxDepth = depth;
    if (Array.isArray(node)) {
      stats.arrays += 1;
      if (node.length > stats.longestArray) stats.longestArray = node.length;
      for (const entry of node) walk(entry, depth + 1);
      return;
    }
    if (isPlainObject(node)) {
      stats.objects += 1;
      const entries = Object.entries(node);
      stats.keys += entries.length;
      for (const [, entry] of entries) walk(entry, depth + 1);
      return;
    }
    stats.primitives += 1;
    if (typeof node === "string") stats.strings += 1;
    else if (typeof node === "number") stats.numbers += 1;
    else if (typeof node === "boolean") stats.booleans += 1;
    else stats.nulls += 1;
  };

  walk(value, 0);
  return stats;
}

export type DetectedFormat = "json" | "yaml" | "csv" | "text" | "empty";

export function detectFormat(text: string): DetectedFormat {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) return "json";

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length >= 2) {
    const header = lines[0] ?? "";
    const commaCount = (header.match(/,/g) ?? []).length;
    if (commaCount > 0) {
      const widths = lines.slice(0, 20).map((line) => (line.match(/,/g) ?? []).length);
      if (widths.every((width) => width === commaCount)) return "csv";
    }
    if (/^[^\s#][^:\n]*:(\s|$)/.test(header)) return "yaml";
  }
  if (/^[^\s#][^:\n]*:(\s|$)/.test(trimmed)) return "yaml";
  return "text";
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Single-line description of any JSON value, used by the query hit strip. */
export function previewValue(value: unknown, max = 64): string {
  const text = value === undefined ? "undefined" : JSON.stringify(value) ?? String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
