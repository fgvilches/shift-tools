import type {
  ApiRequestSpec,
  ApiResponseData,
  AuthKind,
  BodyKind,
  HttpAuth,
  HttpMethod,
} from "@/lib/types";

/* --------------------------------- Vocabulary -------------------------------- */

export type Tone = "neutral" | "primary" | "success" | "warning" | "error" | "tertiary";

export const METHODS: { value: HttpMethod; label: string }[] = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
  { value: "DELETE", label: "DELETE" },
  { value: "HEAD", label: "HEAD" },
  { value: "OPTIONS", label: "OPTIONS" },
];

export const METHOD_TEXT: Record<HttpMethod, string> = {
  GET: "text-secondary",
  POST: "text-tertiary",
  PUT: "text-primary-soft",
  PATCH: "text-warning",
  DELETE: "text-error",
  HEAD: "text-on-variant",
  OPTIONS: "text-on-variant",
};

export const BODY_KINDS: { value: BodyKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "json", label: "JSON" },
  { value: "text", label: "Text" },
  { value: "form", label: "Form" },
  { value: "urlencoded", label: "URL-encoded" },
];

export const AUTH_KINDS: { value: AuthKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "basic", label: "Basic" },
  { value: "bearer", label: "Bearer" },
  { value: "apiKey", label: "API key" },
];

export const BODY_PLACEHOLDER: Record<BodyKind, string> = {
  none: "",
  json: '{\n  "key": "value"\n}',
  text: "Plain text payload…",
  form: "field=value\nother=value",
  urlencoded: "key=value&other=value",
};

export const BODY_HINT: Record<BodyKind, string> = {
  none: "",
  json: "Content-Type defaults to application/json when you have not set one.",
  text: "Content-Type defaults to text/plain; charset=utf-8.",
  form: "The buffer is sent verbatim with a multipart/form-data content type — add a boundary header yourself if the server needs one.",
  urlencoded: "Content-Type defaults to application/x-www-form-urlencoded. Write pairs joined with &.",
};

export const COMMON_HEADERS = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Type",
  "Cookie",
  "Idempotency-Key",
  "If-None-Match",
  "Origin",
  "Referer",
  "User-Agent",
  "X-Api-Version",
  "X-Request-Id",
  "X-API-Key",
];

export const HEADER_NAMES_ID = "api-tester-header-names";

/* ---------------------------------- Status ---------------------------------- */

export function statusTone(status: number | null): Tone {
  if (status === null) return "neutral";
  if (status >= 500) return "error";
  if (status >= 400) return "warning";
  if (status >= 300) return "neutral";
  if (status >= 200) return "success";
  return "neutral";
}

export function statusText(status: number | null, text?: string | null): string {
  if (status === null) return "no response";
  return text && text.trim().length > 0 ? `${status} ${text}` : `${status}`;
}

/* ----------------------------------- Draft ---------------------------------- */

export interface HeaderRow {
  id: string;
  key: string;
  value: string;
}

export interface Draft {
  method: HttpMethod;
  url: string;
  headers: HeaderRow[];
  bodyKind: BodyKind;
  body: string;
  auth: HttpAuth;
  timeoutMs: number;
  followRedirects: boolean;
  insecure: boolean;
}

let rowSeq = 0;

export function newHeaderRow(key = "", value = ""): HeaderRow {
  rowSeq += 1;
  return { id: `hdr-${rowSeq}`, key, value };
}

export function emptyAuth(kind: AuthKind = "none"): HttpAuth {
  return { kind, username: null, password: null, token: null, headerName: null, inQuery: false };
}

export function blankSpec(): ApiRequestSpec {
  return {
    method: "GET",
    url: "",
    headers: [],
    body: null,
    bodyKind: "none",
    auth: emptyAuth(),
    timeoutMs: 30000,
    followRedirects: true,
    insecure: false,
  };
}

export function draftFromSpec(spec: ApiRequestSpec): Draft {
  return {
    method: spec.method,
    url: spec.url,
    headers: spec.headers.map(([key, value]) => newHeaderRow(key, value)),
    bodyKind: spec.bodyKind,
    body: spec.body ?? "",
    auth: { ...spec.auth },
    timeoutMs: spec.timeoutMs,
    followRedirects: spec.followRedirects,
    insecure: spec.insecure,
  };
}

export function clampTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 30000;
  return Math.min(600000, Math.max(1000, Math.round(value)));
}

function nil(value: string | null): string | null {
  return value !== null && value.trim().length > 0 ? value : null;
}

/** Turn editor state into the payload the Rust core expects. Empty header names are dropped. */
export function specFromDraft(draft: Draft): ApiRequestSpec {
  const headers: [string, string][] = draft.headers
    .map((row): [string, string] => [row.key.trim(), row.value])
    .filter(([key]) => key.length > 0);

  const body = draft.bodyKind === "none" || draft.body.length === 0 ? null : draft.body;
  const auth: HttpAuth = {
    kind: draft.auth.kind,
    username: nil(draft.auth.username),
    password: nil(draft.auth.password),
    token: nil(draft.auth.token),
    headerName: nil(draft.auth.headerName) ?? (draft.auth.kind === "apiKey" ? "X-API-Key" : null),
    inQuery: draft.auth.inQuery,
  };

  return {
    method: draft.method,
    url: draft.url.trim(),
    headers,
    body,
    bodyKind: draft.bodyKind,
    auth,
    timeoutMs: clampTimeout(draft.timeoutMs),
    followRedirects: draft.followRedirects,
    insecure: draft.insecure,
  };
}

/** Keep the auth shape (so the editor restores) but never persist a secret. */
export function sanitizeSpec(spec: ApiRequestSpec): ApiRequestSpec {
  return {
    ...spec,
    auth: { ...spec.auth, username: null, password: null, token: null },
  };
}

export function sameRequest(a: ApiRequestSpec, b: ApiRequestSpec): boolean {
  return a.method === b.method && a.url === b.url;
}

/* ---------------------------------- Display --------------------------------- */

export function urlName(url: string): string {
  const raw = url.trim();
  if (!raw) return "Untitled request";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const query = parsed.search ? parsed.search : "";
    const label = `${parsed.host}${path}${query}`;
    return label.length > 72 ? `${label.slice(0, 69)}…` : label;
  } catch {
    return raw.length > 72 ? `${raw.slice(0, 69)}…` : raw;
  }
}

/* ----------------------------------- JSON ----------------------------------- */

export type JsonCheck = { ok: true } | { ok: false; message: string; line: number | null };

/** null means "nothing to validate" (empty buffer). */
export function validateJson(text: string): JsonCheck | null {
  if (!text.trim()) return null;
  try {
    JSON.parse(text);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    const match = /position (\d+)/.exec(message);
    let line: number | null = null;
    if (match && match[1]) {
      const position = Number(match[1]);
      if (Number.isFinite(position)) line = text.slice(0, position).split("\n").length;
    }
    return { ok: false, message, line };
  }
}

export function formatJson(text: string): { ok: true; value: string } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.stringify(JSON.parse(text), null, 2) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

export function isJsonResponse(response: ApiResponseData): boolean {
  const type = (response.contentType ?? "").toLowerCase();
  if (type.includes("json")) return true;
  const trimmed = response.body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Body as the inspector should show it: pretty JSON when possible, raw otherwise. */
export function displayBody(response: ApiResponseData): string {
  if (!isJsonResponse(response)) return response.body;
  try {
    return JSON.stringify(JSON.parse(response.body), null, 2);
  } catch {
    return response.body;
  }
}

export function bodyExtension(response: ApiResponseData): string {
  const type = (response.contentType ?? "").toLowerCase();
  if (isJsonResponse(response)) return "json";
  if (type.includes("html")) return "html";
  if (type.includes("xml")) return "xml";
  if (type.includes("css")) return "css";
  if (type.includes("javascript")) return "js";
  if (type.includes("csv")) return "csv";
  if (type.startsWith("image/")) return "bin";
  return "txt";
}

/* ----------------------------------- cURL ----------------------------------- */

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Local computation only — nothing leaves the app when you copy this. */
export function curlCommand(spec: ApiRequestSpec): string {
  const parts: string[] = [`curl -X ${spec.method} ${shellQuote(spec.url)}`];
  for (const [key, value] of spec.headers) {
    parts.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
  }
  const auth = spec.auth;
  if (auth.kind === "basic") {
    parts.push(`  -u ${shellQuote(`${auth.username ?? ""}:${auth.password ?? ""}`)}`);
  } else if (auth.kind === "bearer" && auth.token) {
    parts.push(`  -H ${shellQuote(`Authorization: Bearer ${auth.token}`)}`);
  } else if (auth.kind === "apiKey" && auth.token) {
    const name = auth.headerName ?? "X-API-Key";
    parts.push(
      auth.inQuery
        ? `  # ${name} and its value are appended to the query string by the request`
        : `  -H ${shellQuote(`${name}: ${auth.token}`)}`,
    );
  }
  if (spec.body) parts.push(`  --data-raw ${shellQuote(spec.body)}`);
  if (spec.followRedirects) parts.push("  -L");
  if (spec.insecure) parts.push("  -k");
  parts.push(`  --max-time ${Math.max(1, Math.ceil(spec.timeoutMs / 1000))}`);
  return parts.join(" \\\n");
}
