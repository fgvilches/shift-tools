import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** True only inside the Tauri WebView (native window). */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

export class IpcError extends Error {
  readonly command: string;
  constructor(command: string, message: string) {
    super(message);
    this.name = "IpcError";
    this.command = command;
  }
}

function normalize(command: string, raw: unknown): IpcError {
  if (raw instanceof Error) {
    return new IpcError(command, raw.message);
  }
  if (typeof raw === "string") {
    return new IpcError(command, raw);
  }
  if (raw && typeof raw === "object" && "message" in raw) {
    const msg = (raw as { message?: unknown }).message;
    return new IpcError(command, typeof msg === "string" ? msg : JSON.stringify(raw));
  }
  return new IpcError(command, "Unknown backend error");
}

/**
 * Invoke a Rust command. Errors follow protocol: every command resolves to a
 * typed payload or rejects with IpcError carrying the Rust `Err(String)` text.
 */
export async function cmd<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    throw new IpcError(command, "This tool needs the native app. Launch it with `npm run app`.");
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalize(command, error);
  }
}

/** Subscribe to a backend event stream. Returns an unsubscribe function. */
export function onEvent<T>(name: string, handler: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;
  void listen<T>(name, (event) => handler(event.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof IpcError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected error";
}
