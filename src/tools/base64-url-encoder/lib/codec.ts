/**
 * Text codecs used by the Base64 / URL Encoder view.
 * Pure functions only: every transform runs in the renderer, no IPC involved.
 */

import { plural } from "@/lib/format";

export type TextMode = "base64" | "url" | "html";
export type Operation = "encode" | "decode";

/** Expected, user-facing failure — message is shown verbatim, hint explains the fix. */
export class CodecError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "CodecError";
    this.hint = hint;
  }
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split("\n").length;
}

function binaryFromBytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + CHUNK)));
  }
  return binary;
}

/** UTF-8 text → Base64 (standard or URL-safe alphabet, unpadded). */
export function toBase64(input: string, urlSafe: boolean): string {
  const encoded = btoa(binaryFromBytes(new TextEncoder().encode(input)));
  if (!urlSafe) return encoded;
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const URLSAFE_ALPHABET = /^[A-Za-z0-9\-_]*$/;
const STANDARD_ALPHABET = /^[A-Za-z0-9+/]*$/;

/** Base64 / Base64url → UTF-8 text, with strict alphabet, padding and UTF-8 checks. */
export function fromBase64(input: string, urlSafe: boolean): string {
  const cleaned = input.replace(/\s+/g, "");
  if (!cleaned) throw new CodecError("Nothing to decode", "Paste a Base64 string into the input buffer.");

  const body = cleaned.replace(/=+$/, "");
  const padding = cleaned.slice(body.length);
  if (body.includes("=")) {
    throw new CodecError(
      "Misplaced padding",
      "The '=' character may only appear as trailing padding, at most twice.",
    );
  }
  if (padding.length > 2) {
    throw new CodecError("Too much padding", "Base64 padding is 0–2 '=' characters at the very end of the payload.");
  }

  const alphabet = urlSafe ? URLSAFE_ALPHABET : STANDARD_ALPHABET;
  if (!alphabet.test(body)) {
    const characters = Array.from(body);
    const invalid = characters.filter((character) => !alphabet.test(character));
    const index = characters.indexOf(invalid[0] ?? "");
    const character = invalid[0] ?? "?";
    const hint =
      invalid.length > 1
        ? `${plural(invalid.length, "character")} fall outside the ${urlSafe ? "base64url" : "Base64"} alphabet — this buffer reads as plain text, not encoded data. Switch the operation to Encode, or paste a complete payload.`
        : urlSafe && (character === "+" || character === "/")
          ? "This is standard Base64 (+ and /). Turn the URL-safe switch off to decode it."
          : !urlSafe && (character === "-" || character === "_")
            ? "This looks like Base64url (- and _). Turn the URL-safe switch on to decode it."
            : "Remove the character, or check that the payload was copied completely.";
    throw new CodecError(`Unexpected character ${JSON.stringify(character)} at offset ${index}`, hint);
  }

  if (body.length % 4 === 1) {
    throw new CodecError(
      "Truncated Base64 payload",
      "A Base64 body cannot end one character past a 4-character boundary. A character is likely missing.",
    );
  }

  const canonical = body.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(body.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(canonical);
  } catch {
    throw new CodecError("Malformed Base64 payload", "The string could not be decoded. Check its length and padding.");
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CodecError(
      "Decoded bytes are not UTF-8",
      `The payload decodes to ${plural(bytes.length, "byte")} that are not valid UTF-8 — it is probably binary data or text in another charset.`,
    );
  }
}

export function urlEncode(input: string): string {
  try {
    return encodeURIComponent(input);
  } catch {
    throw new CodecError(
      "Cannot percent-encode this buffer",
      "The input contains a lone UTF-16 surrogate (an unpaired \\uD800–\\uDFFF unit), which has no UTF-8 representation. Remove or replace that character.",
    );
  }
}

export function urlDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    const stray = /%(?![0-9A-Fa-f]{2})/.exec(input);
    if (stray) {
      throw new CodecError(
        "Malformed percent-encoding",
        `A '%' at offset ${stray.index} is not followed by two hexadecimal digits. Percent escapes are exactly %XX.`,
      );
    }
    const broken = /%[0-9A-Fa-f]{2}/.exec(input);
    throw new CodecError(
      "Escapes do not decode to UTF-8",
      broken
        ? `The escape ${JSON.stringify(broken[0])} at offset ${broken.index} — or one after it — produces bytes that are not valid UTF-8. This happens with Latin-1 or GBK payloads.`
        : "The escapes produce bytes that are not valid UTF-8.",
    );
  }
}

export interface EntityOutcome {
  text: string;
  replacements: number;
  unknown: string[];
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

const ENTITY_PATTERN = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

export function escapeEntities(input: string): EntityOutcome {
  let replacements = 0;
  const text = input.replace(/[&<>"']/g, (character) => {
    replacements += 1;
    return HTML_ESCAPES[character] ?? character;
  });
  return { text, replacements, unknown: [] };
}

export function unescapeEntities(input: string): EntityOutcome {
  const unknown: string[] = [];
  let replacements = 0;
  const text = input.replace(ENTITY_PATTERN, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hexadecimal = body[1] === "x" || body[1] === "X";
      const code = hexadecimal ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      const valid =
        Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      if (!valid) {
        unknown.push(whole);
        return whole;
      }
      replacements += 1;
      return String.fromCodePoint(code);
    }
    const hit = HTML_ENTITIES[body.toLowerCase()];
    if (hit === undefined) {
      unknown.push(whole);
      return whole;
    }
    replacements += 1;
    return hit;
  });
  return { text, replacements, unknown };
}

export function countPercentEscapes(input: string): number {
  return input.match(/%[0-9A-Fa-f]{2}/g)?.length ?? 0;
}

export type DetectedFormat = "jwt" | "base64" | "base64url" | "url" | "entities" | "text";

/** Cheap signature heuristics for the "detected format" chip — never destructive. */
export function detectFormat(input: string): DetectedFormat {
  const value = input.trim().replace(/^bearer\s+/i, "");
  if (!value) return "text";

  const segments = value.split(".");
  if (segments.length === 3 && segments[0]?.startsWith("eyJ") === true) return "jwt";
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length >= 16 && value.length % 4 === 0) return "base64";
  if (/^[A-Za-z0-9\-_]+={0,2}$/.test(value) && /[-_]/.test(value) && value.length >= 16) return "base64url";
  if (/%[0-9A-Fa-f]{2}/.test(value)) return "url";
  if (/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/.test(value)) return "entities";
  return "text";
}

export type TransformOutcome =
  | { status: "idle"; text: ""; label: string }
  | { status: "ok"; text: string; label: string; note?: string; warning?: string }
  | { status: "error"; text: ""; label: string; message: string; hint?: string };

export const IDLE_OUTCOME: TransformOutcome = { status: "idle", text: "", label: "Awaiting input" };

const MODE_LABELS: Record<TextMode, Record<Operation, string>> = {
  base64: { encode: "Base64 encoded", decode: "Base64 decoded" },
  url: { encode: "URI escaped", decode: "URI unescaped" },
  html: { encode: "Entities escaped", decode: "Entities unescaped" },
};

/** Run one text transform; malformed input becomes an error outcome, never an exception. */
export function transformText(
  mode: TextMode,
  input: string,
  direction: Operation,
  urlSafe: boolean,
): TransformOutcome {
  if (input.length === 0) return IDLE_OUTCOME;

  try {
    if (mode === "base64") {
      const label = urlSafe
        ? direction === "encode"
          ? "Base64url encoded"
          : "Base64url decoded"
        : MODE_LABELS.base64[direction];

      if (direction === "encode") {
        const text = toBase64(input, urlSafe);
        return {
          status: "ok",
          text,
          label,
          note: urlSafe
            ? "URL-safe alphabet (- and _) · padding stripped"
            : "RFC 4648 alphabet (+ and /) · padding retained",
        };
      }

      const text = fromBase64(input, urlSafe);
      return {
        status: "ok",
        text,
        label,
        note: `${plural(utf8Length(text), "byte")} decoded · UTF-8`,
      };
    }

    if (mode === "url") {
      if (direction === "encode") {
        const text = urlEncode(input);
        return {
          status: "ok",
          text,
          label: MODE_LABELS.url.encode,
          note: `${plural(countPercentEscapes(text), "escape")} emitted · ${plural(utf8Length(input), "byte")} → ${plural(utf8Length(text), "byte")}`,
        };
      }
      const text = urlDecode(input);
      return {
        status: "ok",
        text,
        label: MODE_LABELS.url.decode,
        note: `${plural(countPercentEscapes(input), "escape")} resolved · ${plural(utf8Length(input), "byte")} → ${plural(utf8Length(text), "byte")}`,
        warning: input.includes("+")
          ? "Literal '+' characters are preserved: this is URI component decoding, not application/x-www-form-urlencoded."
          : undefined,
      };
    }

    if (direction === "encode") {
      const outcome = escapeEntities(input);
      return {
        status: "ok",
        text: outcome.text,
        label: MODE_LABELS.html.encode,
        note:
          outcome.replacements === 0
            ? "No & < > \" ' characters present — nothing to escape"
            : `${plural(outcome.replacements, "character")} escaped as named entities`,
      };
    }

    const outcome = unescapeEntities(input);
    const unknownNote =
      outcome.unknown.length > 0
        ? `${plural(outcome.unknown.length, "unrecognised entity", "unrecognised entities")} left literal: ${outcome.unknown.slice(0, 3).join(", ")}${outcome.unknown.length > 3 ? "…" : ""}`
        : undefined;
    return {
      status: "ok",
      text: outcome.text,
      label: MODE_LABELS.html.decode,
      note:
        outcome.replacements === 0
          ? "No recognised entity references found"
          : `${plural(outcome.replacements, "entity", "entities")} decoded`,
      warning: unknownNote,
    };
  } catch (error) {
    if (error instanceof CodecError) {
      return { status: "error", text: "", label: "Transform failed", message: error.message, hint: error.hint };
    }
    return {
      status: "error",
      text: "",
      label: "Transform failed",
      message: error instanceof Error ? error.message : "The transform failed unexpectedly.",
      hint: "Adjust the input buffer and run the transform again.",
    };
  }
}
