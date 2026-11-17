/**
 * YAML bridge and the canonical form used by the diff modal.
 * `yaml` 2.9 raises YAMLParseError with a `linePos` array, which is the only
 * reliable way to point at the failing line in a whitespace-sensitive format.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { formatJson, parseJson, sortKeysDeep } from "./json";

export interface YamlFailure {
  ok: false;
  message: string;
  hint: string;
  line: number | null;
}

export type YamlParseResult = { ok: true; value: unknown } | YamlFailure;

interface YamlErrorShape {
  message: string;
  code?: string;
  linePos?: { line: number; col: number }[];
}

function isYamlError(value: unknown): value is YamlErrorShape {
  if (!(value instanceof Error)) return false;
  const candidate = value as { linePos?: unknown };
  return Array.isArray(candidate.linePos);
}

function hintForYaml(code: string | undefined): string {
  switch (code) {
    case "BAD_INDENT":
    case "TAB_AS_INDENT":
      return "Indentation must be spaces only, consistent, and deeper than the parent key.";
    case "DUPLICATE_KEY":
      return "Two keys share a name at the same level — YAML rejects the second one.";
    case "MULTIPLE_DOCS":
      return "One document per buffer: remove the extra --- separator.";
    case "BAD_DQ_ESCAPE":
      return "A double-quoted scalar contains an invalid escape sequence.";
    case "MISSING_CHAR":
      return "A quote, bracket or comma in a flow collection is not closed.";
    default:
      return "YAML is whitespace sensitive — check indentation, quoting and the colon after each key.";
  }
}

export function parseYamlText(text: string): YamlParseResult {
  if (text.trim().length === 0) {
    return { ok: false, message: "The buffer is empty", hint: "Paste a YAML document or load the sample.", line: 1 };
  }
  try {
    const value: unknown = parseYaml(text);
    if (value === undefined || value === null) {
      return {
        ok: false,
        message: "The YAML document holds no value",
        hint: "A document needs at least a key, a list or a scalar.",
        line: 1,
      };
    }
    return { ok: true, value };
  } catch (error) {
    if (isYamlError(error)) {
      const position = error.linePos?.[0];
      const firstLine = error.message.split("\n")[0] ?? error.message;
      return {
        ok: false,
        message: firstLine.replace(/:$/, ""),
        hint: hintForYaml(error.code),
        line: position ? position.line : null,
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "YAML could not be parsed",
      hint: "Check the document structure.",
      line: null,
    };
  }
}

export function jsonToYaml(value: unknown, indent: 2 | 4): string {
  return stringifyYaml(value, { indent, lineWidth: 0, minContentWidth: 0 });
}

export interface NormalizedText {
  text: string;
  parsed: boolean;
  errorLine: number | null;
  message: string | null;
}

/** Pretty-prints and key-sorts a document so a line diff compares values, not layout. */
export function normalizeForDiff(text: string): NormalizedText {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return { text, parsed: false, errorLine: parsed.error.line, message: parsed.error.message };
  }
  return { text: formatJson(sortKeysDeep(parsed.value), 2), parsed: true, errorLine: null, message: null };
}
