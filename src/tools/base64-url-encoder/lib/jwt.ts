/**
 * Minimal JWS (RFC 7519) reader: splits the compact serialisation, decodes the
 * header and payload with base64url + UTF-8 + JSON validation, and evaluates the
 * registered time claims. The signature is never verified — this is a decoder.
 */

import { toBase64 } from "@/tools/base64-url-encoder/lib/codec";

export interface ParsedSegment {
  segment: string;
  json: string;
  value: Record<string, unknown>;
  bytes: number;
}

export interface JwtSignature {
  segment: string;
  bytes: number | null;
}

export type JwtResult =
  | {
      ok: true;
      header: ParsedSegment;
      payload: ParsedSegment;
      signature: JwtSignature;
      algorithm: string;
      type: string;
      warnings: string[];
    }
  | { ok: false; message: string; hint?: string };

class JwtError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "JwtError";
    this.hint = hint;
  }
}

function base64UrlBytes(segment: string, name: string): Uint8Array {
  if (segment.length === 0) {
    throw new JwtError(`${name} segment is empty`, "A JWS token is header.payload.signature, dot-separated.");
  }
  if (!/^[A-Za-z0-9\-_]+={0,2}$/.test(segment)) {
    const bad = /[^A-Za-z0-9\-_=]/.exec(segment);
    throw new JwtError(
      `${name} segment is not base64url`,
      bad
        ? `The character ${JSON.stringify(bad[0])} at offset ${bad.index} is outside the base64url alphabet (A–Z a–z 0–9 - _). A standard Base64 token must have '+' and '/' converted first.`
        : "base64url accepts A–Z, a–z, 0–9, '-' and '_' with optional '=' padding.",
    );
  }
  const unpadded = segment.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) {
    throw new JwtError(`${name} segment is truncated`, "A base64url body cannot end one character past a 4-character boundary.");
  }
  const padded = unpadded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new JwtError(`${name} segment is not decodable`, "The base64url payload could not be decoded.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeSegment(segment: string, name: "Header" | "Payload"): ParsedSegment {
  const bytes = base64UrlBytes(segment, name);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new JwtError(`${name} is not valid UTF-8`, "JOSE headers and payloads must be UTF-8 encoded JSON.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new JwtError(
      `${name} is not valid JSON`,
      error instanceof Error ? error.message : "The decoded segment is not a JSON document.",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new JwtError(`${name} is not a JSON object`, "Both JOSE header and payload must be JSON objects.");
  }

  return {
    segment,
    json: JSON.stringify(parsed, null, 2),
    value: parsed as Record<string, unknown>,
    bytes: bytes.length,
  };
}

export function parseJwt(input: string): JwtResult {
  const token = input.trim().replace(/^bearer\s+/i, "");
  if (!token) return { ok: false, message: "No token in the buffer", hint: "Paste a compact JWS token to inspect it." };

  if (/\s/.test(token)) {
    return {
      ok: false,
      message: "Token contains whitespace",
      hint: "Compact serialisation must be a single line. Remove line breaks or spaces, or paste only the token after 'Bearer'.",
    };
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    return {
      ok: false,
      message: `Expected 3 segments, found ${segments.length}`,
      hint:
        segments.length === 5
          ? "This looks like a JWE (five segments). Only signed JWS tokens can be decoded here."
          : "A JWS token has the form header.payload.signature, separated by two dots.",
    };
  }

  try {
    const headerSegment = segments[0] ?? "";
    const payloadSegment = segments[1] ?? "";
    const signatureSegment = segments[2] ?? "";
    const header = decodeSegment(headerSegment, "Header");
    const payload = decodeSegment(payloadSegment, "Payload");

    const warnings: string[] = [];
    let signatureBytes: number | null = null;
    if (signatureSegment.length === 0) {
      warnings.push("Signature segment is empty — the token is unsigned and cannot be trusted.");
    } else {
      try {
        signatureBytes = base64UrlBytes(signatureSegment, "Signature").length;
      } catch {
        warnings.push("Signature segment is not valid base64url and was left unread.");
      }
    }

    const algorithm = typeof header.value.alg === "string" ? header.value.alg : "unspecified";
    if (algorithm.toLowerCase() === "none") {
      warnings.push("Header declares alg: none — the token is unsecured by design.");
    }

    return {
      ok: true,
      header,
      payload,
      signature: { segment: signatureSegment, bytes: signatureBytes },
      algorithm,
      type: typeof header.value.typ === "string" ? header.value.typ : "unspecified",
      warnings,
    };
  } catch (error) {
    if (error instanceof JwtError) return { ok: false, message: error.message, hint: error.hint };
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The token could not be parsed.",
      hint: "Check that the token is complete and unmodified.",
    };
  }
}

export function numericClaim(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export type ExpiryTone = "success" | "warning" | "error" | "neutral";

export interface ExpiryState {
  tone: ExpiryTone;
  label: string;
  detail: string;
}

/** Human-readable elapsed/remaining time, e.g. "42m", "3.2h", "1.4y". */
export function formatSpan(milliseconds: number): string {
  const seconds = Math.abs(milliseconds) / 1000;
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  const days = seconds / 86_400;
  if (days < 30) return `${days.toFixed(1)}d`;
  if (days < 365) return `${(days / 30.4375).toFixed(1)}mo`;
  return `${(days / 365.25).toFixed(1)}y`;
}

export function formatClaimDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

export function evaluateExpiry(payload: Record<string, unknown>, now: number): ExpiryState {
  const exp = numericClaim(payload, "exp");
  const nbf = numericClaim(payload, "nbf");

  if (payload.exp !== undefined && exp === null) {
    return { tone: "warning", label: "BAD EXP", detail: "exp is not a numeric epoch" };
  }
  if (nbf !== null && nbf * 1000 > now) {
    return { tone: "warning", label: "NOT YET VALID", detail: `nbf reached in ${formatSpan(nbf * 1000 - now)}` };
  }
  if (exp === null) {
    return { tone: "neutral", label: "NO EXPIRY", detail: "no exp claim" };
  }
  const remaining = exp * 1000 - now;
  if (remaining <= 0) {
    return { tone: "error", label: "EXPIRED", detail: `expired ${formatSpan(remaining)} ago` };
  }
  return { tone: "success", label: "VALID", detail: `expires in ${formatSpan(remaining)}` };
}

/** Unsigned demo token: 2030-01-01 expiry, HS256 header, fake signature. */
export const SAMPLE_JWT = [
  toBase64(
    JSON.stringify({ alg: "HS256", typ: "JWT", kid: "shift-devtools-sample" }),
    true,
  ),
  toBase64(
    JSON.stringify({
      iss: "https://auth.shift.tools",
      sub: "usr_9f408ce8-769a-4f51-b952",
      aud: ["shift-tools", "web"],
      exp: 1_893_456_000,
      iat: 1_767_225_600,
      nbf: 1_767_225_600,
      scope: ["read:system", "write:network"],
      jti: "9f4c1e2a73b04d18",
    }),
    true,
  ),
  "s5H8kQ2Zt7o4Jm1nXq9cLr6vB3dF8gW0yA7pN2hT4eU",
].join(".");
