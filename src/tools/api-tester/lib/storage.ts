import type {
  ApiHistoryEntry,
  ApiRequestSpec,
  AuthKind,
  BodyKind,
  HttpAuth,
  HttpMethod,
} from "@/lib/types";
import { clampTimeout } from "./request";

const DRAFT_KEY = "shift-tools.api-tester.draft.v1";
const HISTORY_KEY = "shift-tools.api-tester.history.v1";

const METHOD_SET = new Set<string>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const BODY_SET = new Set<string>(["none", "json", "text", "form", "urlencoded"]);
const AUTH_SET = new Set<string>(["none", "basic", "bearer", "apiKey"]);

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or a locked-down WebView: the tool still works, it just forgets.
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function coerceSpec(value: unknown): ApiRequestSpec | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const method: HttpMethod =
    typeof raw.method === "string" && METHOD_SET.has(raw.method) ? (raw.method as HttpMethod) : "GET";
  const bodyKind: BodyKind =
    typeof raw.bodyKind === "string" && BODY_SET.has(raw.bodyKind) ? (raw.bodyKind as BodyKind) : "none";

  const headers: [string, string][] = [];
  if (Array.isArray(raw.headers)) {
    for (const item of raw.headers) {
      if (Array.isArray(item) && typeof item[0] === "string" && typeof item[1] === "string") {
        headers.push([item[0], item[1]]);
      }
    }
  }

  const authRaw = raw.auth && typeof raw.auth === "object" ? (raw.auth as Record<string, unknown>) : {};
  const kind: AuthKind =
    typeof authRaw.kind === "string" && AUTH_SET.has(authRaw.kind) ? (authRaw.kind as AuthKind) : "none";
  const auth: HttpAuth = {
    kind,
    username: asString(authRaw.username),
    password: asString(authRaw.password),
    token: asString(authRaw.token),
    headerName: asString(authRaw.headerName),
    inQuery: authRaw.inQuery === true,
  };

  const timeout = typeof raw.timeoutMs === "number" ? raw.timeoutMs : 30000;

  return {
    method,
    url: asString(raw.url) ?? "",
    headers,
    body: asString(raw.body),
    bodyKind,
    auth,
    timeoutMs: clampTimeout(timeout),
    followRedirects: raw.followRedirects !== false,
    insecure: raw.insecure === true,
  };
}

export function loadDraft(): ApiRequestSpec | null {
  return coerceSpec(readJson(DRAFT_KEY));
}

export function saveDraft(spec: ApiRequestSpec): void {
  writeJson(DRAFT_KEY, spec);
}

export function loadHistory(): ApiHistoryEntry[] {
  const raw = readJson(HISTORY_KEY);
  if (!Array.isArray(raw)) return [];
  const entries: ApiHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const spec = coerceSpec(record.spec);
    if (!spec) continue;
    const id = asString(record.id);
    const name = asString(record.name);
    const createdAt = asString(record.createdAt);
    if (!id || !name || !createdAt) continue;
    const status = typeof record.lastStatus === "number" ? record.lastStatus : null;
    entries.push({ id, name, spec, createdAt, lastStatus: status });
  }
  return entries.slice(0, 50);
}

export function saveHistory(entries: ApiHistoryEntry[]): void {
  writeJson(HISTORY_KEY, entries.slice(0, 50));
}

export function newEntryId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // fall through to the timestamp id
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
