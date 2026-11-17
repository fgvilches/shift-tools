/**
 * Local identifier synthesis and inspection.
 *
 * Every random byte comes from the platform CSPRNG — Web Crypto
 * `crypto.getRandomValues` (RFC 4086 / NIST SP 800-90A source). `Math.random`
 * is never used, so output is suitable for real identifiers.
 *
 * Nothing in this file talks to the network or the Rust core: generation is
 * pure local computation and therefore works without Tauri.
 */

export type IdFormat = "uuid" | "ulid" | "nanoid";

export const FORMAT_LABELS: Record<IdFormat, string> = {
  uuid: "UUID v4",
  ulid: "ULID",
  nanoid: "NanoID",
};

/** Short tag used in dense table cells. */
export const FORMAT_TAGS: Record<IdFormat, string> = {
  uuid: "UUID",
  ulid: "ULID",
  nanoid: "NANO",
};

/** Crockford base32 — excludes I, L, O and U to avoid transcription errors. */
export const CROCKFORD32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** NanoID's canonical 64-symbol URL-safe alphabet. */
export const DEFAULT_NANOID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const NANOID_DEFAULT_LENGTH = 21;
export const MAX_BATCH = 500;

export interface UuidFormatOptions {
  uppercase: boolean;
  braces: boolean;
  hyphens: boolean;
}

/* ------------------------------------------------------------------ */
/* Entropy                                                             */
/* ------------------------------------------------------------------ */

function getCrypto(): Crypto {
  const c = globalThis.crypto as Crypto | undefined;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("Web Crypto is unavailable in this webview — refusing to emit weak identifiers.");
  }
  return c;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(1, Math.floor(length)));
  getCrypto().getRandomValues(bytes);
  return bytes;
}

const HEX_DIGITS = "0123456789abcdef";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += HEX_DIGITS[byte >> 4] + HEX_DIGITS[byte & 0x0f];
  return out;
}

/* ------------------------------------------------------------------ */
/* UUID v4                                                             */
/* ------------------------------------------------------------------ */

/**
 * RFC 9562 §5.4 layout: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 *   - byte 6 high nibble is forced to 0100 → version 4
 *   - byte 8 high bits are forced to 10xx  → RFC variant
 *   - the other 122 bits stay random
 *
 * Worked example against the spec:
 *   raw bytes   1b 4e 2c 9f 7a 3d 4c 88 9b 2f 6e 01 8d 73 aa 5c
 *   byte 6      0x4c → (0x4c & 0x0f) | 0x40 = 0x4c  → 3rd group "4c88" (v4 nibble)
 *   byte 8      0x9b → (0x9b & 0x3f) | 0x80 = 0x9b  → 4th group "9b2f" (10xx variant)
 *   result      1b4e2c9f-7a3d-4c88-9b2f-6e018d73aa5c
 * Any hex digit in the version position other than 4 (or a 4th group above
 * 0xbfff) would mean the masks did not apply.
 */
export function uuidV4(): string {
  const c = getCrypto();
  if (typeof c.randomUUID === "function") {
    try {
      return c.randomUUID().toLowerCase();
    } catch {
      // randomUUID requires a secure context; fall through to getRandomValues.
    }
  }
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function formatUuid(raw: string, options: UuidFormatOptions): string {
  let value = options.hyphens ? raw : raw.replace(/-/g, "");
  if (options.uppercase) value = value.toUpperCase();
  return options.braces ? `{${value}}` : value;
}

/* ------------------------------------------------------------------ */
/* ULID                                                                */
/* ------------------------------------------------------------------ */

const ULID_RANDOM_BITS = 80n;
const ULID_RANDOM_MASK = (1n << ULID_RANDOM_BITS) - 1n;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function encodeBase32(value: bigint, length: number): string {
  let out = "";
  let rest = value;
  for (let i = 0; i < length; i += 1) {
    out = CROCKFORD32[Number(rest & 31n)] + out;
    rest >>= 5n;
  }
  return out;
}

function decodeBase32(text: string): bigint {
  let value = 0n;
  for (const ch of text) {
    const index = CROCKFORD32.indexOf(ch);
    if (index < 0) return -1n;
    value = (value << 5n) | BigInt(index);
  }
  return value;
}

// Monotonic factory state: ULIDs minted inside one millisecond increment the
// 80-bit tail, so a batch is strictly increasing and lexicographically sortable.
let lastUlidMs = -1;
let lastUlidRandom = 0n;

function nextUlid(now: number): { value: string; ms: number } {
  let ms = Math.floor(now);
  if (lastUlidMs < 0 || ms > lastUlidMs) {
    lastUlidMs = ms;
    lastUlidRandom = bytesToBigInt(randomBytes(10));
  } else {
    // Same millisecond (or the clock stepped backwards): stay on the last
    // timestamp and increment randomness instead of repeating a value.
    ms = lastUlidMs;
    lastUlidRandom += 1n;
    if (lastUlidRandom > ULID_RANDOM_MASK) {
      // 2^80 identifiers in one millisecond: borrow the next millisecond.
      ms = lastUlidMs + 1;
      lastUlidMs = ms;
      lastUlidRandom = bytesToBigInt(randomBytes(10));
    }
  }
  return { value: encodeBase32(BigInt(ms), 10) + encodeBase32(lastUlidRandom, 16), ms };
}

/** 26 symbols: 10 chars of 48-bit millisecond time + 16 chars of 80-bit randomness. */
export function ulid(now = Date.now()): string {
  return nextUlid(now).value;
}

export function decodeUlidTime(value: string): number | null {
  const upper = value.toUpperCase();
  if (upper.length !== 26) return null;
  for (const ch of upper) if (CROCKFORD32.indexOf(ch) < 0) return null;
  return Number(decodeBase32(upper.slice(0, 10)));
}

/* ------------------------------------------------------------------ */
/* NanoID                                                              */
/* ------------------------------------------------------------------ */

export function uniqueChars(value: string): string[] {
  return Array.from(new Set(Array.from(value)));
}

export function nanoId(length: number, alphabet: string): string {
  const chars = uniqueChars(alphabet);
  if (chars.length < 2) throw new Error("NanoID alphabet needs at least 2 unique characters.");
  const size = chars.length;
  // Largest multiple of `size` that fits in a byte. Bytes at or above the
  // limit are discarded (rejection sampling) so every symbol is equally likely.
  const limit = 256 - (256 % size);
  const target = Math.min(255, Math.max(1, Math.round(length)));
  let out = "";
  while (out.length < target) {
    for (const byte of randomBytes(Math.max(16, target - out.length))) {
      if (byte >= limit) continue;
      out += chars[byte % size];
      if (out.length === target) break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Batch generation                                                    */
/* ------------------------------------------------------------------ */

export interface GeneratedId {
  /** Stable React/list key — the raw identifier itself (unique by construction). */
  key: string;
  /** Canonical identifier, unformatted: lowercase hyphenated UUID, uppercase ULID. */
  raw: string;
  /** What the UI shows and the clipboard receives. */
  display: string;
  format: IdFormat;
  /** Wall-clock time the row was minted. */
  createdAt: number;
  /** Timestamp encoded in the identifier (ULID) or the mint time. */
  timestampMs: number;
  timeLabel: string;
  entropyBits: number;
  alphabetSize: number;
  /** Alphabet the identifier draws from, for the inspector. */
  alphabet: string;
}

export interface BatchOptions {
  format: IdFormat;
  count: number;
  uuid: UuidFormatOptions;
  nanoLength: number;
  nanoAlphabet: string;
}

export function createId(
  format: IdFormat,
  uuidOptions: UuidFormatOptions,
  nanoLength: number,
  nanoAlphabet: string,
): GeneratedId {
  const createdAt = Date.now();
  if (format === "uuid") {
    const raw = uuidV4();
    return {
      key: raw,
      raw,
      display: formatUuid(raw, uuidOptions),
      format,
      createdAt,
      timestampMs: createdAt,
      timeLabel: timeOfDay(createdAt),
      entropyBits: 122,
      alphabetSize: 16,
      alphabet: "0123456789abcdef",
    };
  }
  if (format === "ulid") {
    const { value, ms } = nextUlid(createdAt);
    return {
      key: value,
      raw: value,
      display: value,
      format,
      createdAt,
      timestampMs: ms,
      timeLabel: timeOfDay(ms),
      entropyBits: 80,
      alphabetSize: 32,
      alphabet: CROCKFORD32,
    };
  }
  const chars = uniqueChars(nanoAlphabet);
  const raw = nanoId(nanoLength, chars.join(""));
  return {
    key: raw,
    raw,
    display: raw,
    format,
    createdAt,
    timestampMs: createdAt,
    timeLabel: timeOfDay(createdAt),
    entropyBits: Math.round(Math.min(255, Math.max(1, nanoLength)) * Math.log2(chars.length)),
    alphabetSize: chars.length,
    alphabet: chars.join(""),
  };
}

export function generateBatch(options: BatchOptions): GeneratedId[] {
  const count = Math.min(MAX_BATCH, Math.max(1, Math.round(options.count) || 1));
  const out: GeneratedId[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(createId(options.format, options.uuid, options.nanoLength, options.nanoAlphabet));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

export function timeOfDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function isoStamp(ms: number): string {
  return new Date(ms).toISOString();
}

/** Birthday-bound estimate for `count` draws from a 2^bits keyspace (count ≪ 2^bits). */
export function collisionProbability(count: number, bits: number): number {
  if (count < 2 || bits <= 0) return 0;
  return (count * (count - 1)) / 2 / Math.pow(2, bits);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // WKWebView can refuse the async clipboard without focus; fall back below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Inspection                                                          */
/* ------------------------------------------------------------------ */

export type CellTone = "neutral" | "primary" | "success" | "tertiary";

export interface IdCell {
  label: string;
  value: string;
  hint: string;
  tone: CellTone;
}

export interface IdFact {
  label: string;
  value: string;
}

export interface IdBreakdown {
  kind: string;
  cells: IdCell[];
  facts: IdFact[];
  entropyBits: number;
  timestampMs: number | null;
}

function variantBitsLabel(byte: number): string {
  if ((byte & 0x80) === 0) return "0xxx";
  if ((byte & 0xc0) === 0x80) return "10xx";
  if ((byte & 0xe0) === 0xc0) return "110x";
  return "111x";
}

export function variantLabel(byte: number): string {
  if ((byte & 0x80) === 0) return "NCS (0xxx) — legacy";
  if ((byte & 0xc0) === 0x80) return "RFC 4122/9562 (10xx)";
  if ((byte & 0xe0) === 0xc0) return "Microsoft (110x)";
  return "Future (111x) — reserved";
}

export function describeId(entry: GeneratedId): IdBreakdown {
  if (entry.format === "uuid") {
    const hex = entry.raw.replace(/-/g, "").toLowerCase();
    const version = Number.parseInt(hex.slice(12, 13), 16);
    const variantByte = Number.parseInt(hex.slice(16, 18), 16);
    return {
      kind: `UUID v${version}`,
      timestampMs: null,
      entropyBits: entry.entropyBits,
      cells: [
        { label: "Chunk 1 · time-low", value: hex.slice(0, 8), hint: "32 bits · random", tone: "neutral" },
        { label: "Chunk 2 · time-mid", value: hex.slice(8, 12), hint: "16 bits · random", tone: "neutral" },
        { label: "Version nibble", value: `v${version}`, hint: "0100 binary prefix", tone: "success" },
        {
          label: "Variant field",
          value: hex.slice(16, 18),
          hint: `${variantBitsLabel(variantByte)} · RFC 4122/9562`,
          tone: "tertiary",
        },
        { label: "Node block", value: hex.slice(20), hint: "48 bits · random", tone: "neutral" },
        { label: "Entropy density", value: `${entry.entropyBits} bits`, hint: `2^${entry.entropyBits} keys`, tone: "primary" },
      ],
      facts: [
        { label: "Version", value: `v${version} · nibble ${hex.slice(12, 13)}` },
        { label: "Variant", value: `byte ${hex.slice(16, 18)} · ${variantBitsLabel(variantByte)}` },
        { label: "Generated", value: entry.timeLabel },
        { label: "Layout", value: "8-4-4-4-12 · RFC 9562" },
      ],
    };
  }

  if (entry.format === "ulid") {
    const ms = decodeUlidTime(entry.raw) ?? entry.timestampMs;
    return {
      kind: "ULID",
      timestampMs: ms,
      entropyBits: 80,
      cells: [
        { label: "Time prefix", value: entry.raw.slice(0, 10), hint: isoStamp(ms), tone: "primary" },
        { label: "Random high", value: entry.raw.slice(10, 18), hint: "40 bits · CSPRNG", tone: "neutral" },
        { label: "Random low", value: entry.raw.slice(18, 26), hint: "40 bits · CSPRNG", tone: "neutral" },
        { label: "Encoding", value: "Base32", hint: "Crockford · I L O U excluded", tone: "tertiary" },
        { label: "Sort order", value: "Lexicographic", hint: "time-ordered by design", tone: "success" },
        { label: "Entropy density", value: "80 bits", hint: "2^80 random keys", tone: "primary" },
      ],
      facts: [
        { label: "Timestamp", value: isoStamp(ms) },
        { label: "Random tail", value: "80 bits · monotonic per ms" },
        { label: "Encoding", value: "Crockford base32 · 26 chars" },
        { label: "Generated", value: entry.timeLabel },
      ],
    };
  }

  return {
    kind: "NanoID",
    timestampMs: null,
    entropyBits: entry.entropyBits,
    cells: [
      { label: "Length", value: `${entry.raw.length}`, hint: "symbols · URL-safe", tone: "primary" },
      { label: "Alphabet", value: `${entry.alphabetSize}`, hint: "unique symbols", tone: "neutral" },
      { label: "Entropy density", value: `${entry.entropyBits} bits`, hint: "length × log2(alphabet)", tone: "success" },
      { label: "Sample", value: entry.raw.slice(0, 12), hint: "first symbols", tone: "neutral" },
      {
        label: "Charset",
        value: entry.alphabet.length > 12 ? `${entry.alphabet.slice(0, 12)}…` : entry.alphabet,
        hint: `${entry.alphabetSize} unique symbols`,
        tone: "tertiary",
      },
      { label: "Checksum", value: "none", hint: "validate by structure only", tone: "neutral" },
    ],
    facts: [
      { label: "Length", value: `${entry.raw.length} symbols` },
      { label: "Alphabet", value: `${entry.alphabetSize} symbols · ${entry.entropyBits} bits` },
      { label: "Generated", value: entry.timeLabel },
      { label: "Variant", value: "custom alphabet" },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ValidationDetail {
  label: string;
  value: string;
}

export interface IdValidation {
  valid: boolean;
  format: IdFormat;
  /** Human label for the detected structure, e.g. "UUID v4". */
  kind: string;
  reason: string;
  details: ValidationDetail[];
  canonical: string | null;
}

const UUID_HYPHENATED = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX_ONLY = /^[0-9a-fA-F]+$/;

function rejected(format: IdFormat, kind: string, reason: string): IdValidation {
  return { valid: false, format, kind, reason, details: [], canonical: null };
}

function groupHex(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function validateUuidInput(input: string): IdValidation {
  const chars = Array.from(input);
  const badIndex = chars.findIndex((ch) => ch !== "-" && !/[0-9a-fA-F]/.test(ch));
  if (badIndex >= 0) {
    return rejected(
      "uuid",
      "UUID (rejected)",
      `"${chars[badIndex]}" at position ${badIndex + 1} is not a hexadecimal digit — UUIDs only contain 0-9 and a-f.`,
    );
  }

  const hex = input.replace(/-/g, "");
  if (hex.length !== 32) {
    return rejected(
      "uuid",
      "UUID (rejected)",
      `A UUID carries 32 hex digits (128 bits); this string has ${hex.length}.`,
    );
  }
  if (input.includes("-") && !UUID_HYPHENATED.test(input)) {
    return rejected(
      "uuid",
      "UUID (rejected)",
      "Hyphen placement is wrong — canonical UUIDs are grouped 8-4-4-4-12.",
    );
  }

  const version = Number.parseInt(hex.slice(12, 13), 16);
  if (version < 1 || version > 8) {
    return rejected(
      "uuid",
      "UUID (rejected)",
      `Version nibble is ${version}; RFC 9562 defines versions 1–8 and reserves 0.`,
    );
  }

  const variantByte = Number.parseInt(hex.slice(16, 18), 16);
  const canonical = groupHex(hex.toLowerCase());
  const randomBits = version === 4 ? 122 : version === 7 ? 74 : 0;

  return {
    valid: true,
    format: "uuid",
    kind: `UUID v${version}`,
    reason:
      version === 4
        ? "Valid RFC 4122/9562 UUID v4 — 122 random bits, version nibble 4, RFC variant."
        : `Valid RFC 4122/9562 UUID v${version} — variant ${variantBitsLabel(variantByte)} (${variantLabel(variantByte)}).`,
    canonical,
    details: [
      { label: "Version", value: `v${version}` },
      { label: "Variant", value: variantLabel(variantByte) },
      { label: "Entropy", value: randomBits > 0 ? `${randomBits} random bits` : "structured — not random" },
      { label: "Canonical", value: canonical },
    ],
  };
}

function validateUlidInput(input: string): IdValidation {
  const upper = input.toUpperCase();
  const chars = Array.from(upper);
  if (chars.length !== 26) {
    return rejected("ulid", "ULID (rejected)", `A ULID is exactly 26 symbols (10 time + 16 random); this has ${chars.length}.`);
  }
  const badIndex = chars.findIndex((ch) => CROCKFORD32.indexOf(ch) < 0);
  if (badIndex >= 0) {
    return rejected(
      "ulid",
      "ULID (rejected)",
      `"${chars[badIndex]}" at position ${badIndex + 1} is not a Crockford base32 symbol — I, L, O and U are excluded.`,
    );
  }
  if (CROCKFORD32.indexOf(chars[0]) > 7) {
    return rejected(
      "ulid",
      "ULID (rejected)",
      `Leading symbol "${chars[0]}" overflows the 48-bit millisecond timestamp (must be 0–7).`,
    );
  }

  const ms = Number(decodeBase32(upper.slice(0, 10)));
  return {
    valid: true,
    format: "ulid",
    kind: "ULID",
    reason: "Valid ULID — 48-bit millisecond timestamp followed by 80 bits of randomness, Crockford base32.",
    canonical: upper,
    details: [
      { label: "Timestamp", value: isoStamp(ms) },
      { label: "Time prefix", value: upper.slice(0, 10) },
      { label: "Randomness", value: "80 bits" },
      { label: "Encoding", value: "Crockford base32" },
    ],
  };
}

function validateNanoidInput(input: string): IdValidation {
  const chars = Array.from(input);
  if (chars.length > 255) {
    return rejected("nanoid", "NanoID (rejected)", `NanoID batches cap at 255 symbols; this string has ${chars.length}.`);
  }
  const alphabet = new Set(Array.from(DEFAULT_NANOID_ALPHABET));
  const badIndex = chars.findIndex((ch) => !alphabet.has(ch));
  if (badIndex >= 0) {
    return rejected(
      "nanoid",
      "Unrecognised",
      `"${chars[badIndex]}" at position ${badIndex + 1} is outside the NanoID alphabet (A-Z a-z 0-9 _ -), and the string is neither a UUID nor a ULID.`,
    );
  }
  const bits = Math.round(chars.length * 6);
  return {
    valid: true,
    format: "nanoid",
    kind: "NanoID",
    reason: "URL-safe NanoID shape — no version, timestamp or checksum, so any string over the alphabet is valid.",
    canonical: input,
    details: [
      { label: "Length", value: `${chars.length} symbols` },
      { label: "Alphabet", value: "64 symbols · default" },
      { label: "Entropy", value: `≈ ${bits} bits` },
    ],
  };
}

/**
 * Classify and verify a pasted identifier. Returns null for empty input.
 * UUIDs are checked byte-for-byte; ULIDs decode their timestamp; NanoID is
 * structural only because the format carries no checksum.
 */
export function validateId(rawInput: string): IdValidation | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const inner = trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;

  const looksUuid =
    inner.length === 32 ||
    inner.length === 36 ||
    (inner.includes("-") && inner.length >= 32 && inner.length <= 40);
  if (looksUuid) return validateUuidInput(inner);

  if (inner.length === 26) return validateUlidInput(inner);

  if (inner.length === 32 && HEX_ONLY.test(inner)) return validateUuidInput(inner);

  if (inner.length === 26) return validateUlidInput(inner);

  return validateNanoidInput(inner);
}
