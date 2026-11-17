import {
  HARD_TIMEOUT_MS,
  evaluate,
  evaluationTimeout,
  looksCatastrophic,
  replaceAllMatches,
  replacementTimeout,
} from "./engine";
import type { EvalFailure, EvalResult, ReplaceFailure, ReplaceResult, WorkerRequest, WorkerResponse } from "./engine";

export type EngineMode = "worker" | "inline";

type Pending =
  | { kind: "evaluate"; timer: number; resolve: (result: EvalResult) => void }
  | { kind: "replace"; timer: number; resolve: (result: ReplaceResult) => void };

function evalFailure(message: string): EvalFailure {
  return { ok: false, error: message, elapsedMs: 0, timedOut: false, partialMatches: 0, hitLimit: false };
}

function replaceFailure(message: string): ReplaceFailure {
  return { ok: false, error: message, elapsedMs: 0, timedOut: false };
}

/**
 * Owns the RegExp worker. One worker is enough: a request that is superseded
 * (newer pattern/text) is simply dropped from the pending table, and a request
 * that outlives HARD_TIMEOUT_MS gets the worker terminated — the only reliable
 * way to stop a catastrophic backtracking regex in JavaScript.
 */
class RegexRunner {
  private worker: Worker | null = null;
  private unavailable = false;
  private seq = 0;
  private pending = new Map<number, Pending>();

  mode(): EngineMode {
    return this.unavailable || typeof Worker === "undefined" ? "inline" : "worker";
  }

  evaluate(pattern: string, flags: string, text: string): Promise<EvalResult> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(this.inlineEvaluate(pattern, flags, text));

    const id = ++this.seq;
    this.cancel("evaluate");

    return new Promise<EvalResult>((resolve) => {
      const timer = window.setTimeout(() => this.handleTimeout(id), HARD_TIMEOUT_MS);
      this.pending.set(id, { kind: "evaluate", timer, resolve });
      const request: WorkerRequest = { id, kind: "evaluate", pattern, flags, text };
      worker.postMessage(request);
    });
  }

  replace(pattern: string, flags: string, text: string, template: string): Promise<ReplaceResult> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(this.inlineReplace(pattern, flags, text, template));

    const id = ++this.seq;
    this.cancel("replace");

    return new Promise<ReplaceResult>((resolve) => {
      const timer = window.setTimeout(() => this.handleTimeout(id), HARD_TIMEOUT_MS);
      this.pending.set(id, { kind: "replace", timer, resolve });
      const request: WorkerRequest = { id, kind: "replace", pattern, flags, text, template };
      worker.postMessage(request);
    });
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.unavailable || typeof Worker === "undefined") return null;

    try {
      const worker = new Worker(new URL("./regex.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
      worker.onerror = () => this.fail("The pattern worker crashed while loading the RegExp engine.");
      this.worker = worker;
      return worker;
    } catch {
      this.unavailable = true;
      return null;
    }
  }

  private handleMessage(message: WorkerResponse): void {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    window.clearTimeout(entry.timer);

    if (entry.kind === "evaluate" && message.kind === "evaluate") {
      entry.resolve(message.result);
      return;
    }
    if (entry.kind === "replace" && message.kind === "replace") {
      entry.resolve(message.result);
      return;
    }
    if (entry.kind === "evaluate") entry.resolve(evalFailure("The pattern engine returned an unexpected response."));
    else entry.resolve(replaceFailure("The pattern engine returned an unexpected response."));
  }

  private handleTimeout(id: number): void {
    if (!this.pending.has(id)) return;
    // A worker stuck inside one `exec` cannot be interrupted from the outside.
    this.killWorker();
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      window.clearTimeout(entry.timer);
      if (entry.kind === "evaluate") entry.resolve(evaluationTimeout(HARD_TIMEOUT_MS));
      else entry.resolve(replacementTimeout(HARD_TIMEOUT_MS));
    }
  }

  private fail(message: string): void {
    this.killWorker();
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      window.clearTimeout(entry.timer);
      if (entry.kind === "evaluate") entry.resolve(evalFailure(message));
      else entry.resolve(replaceFailure(message));
    }
  }

  private cancel(kind: Pending["kind"]): void {
    for (const [id, entry] of this.pending) {
      if (entry.kind !== kind) continue;
      window.clearTimeout(entry.timer);
      this.pending.delete(id);
    }
  }

  private killWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private inlineEvaluate(pattern: string, flags: string, text: string): EvalResult {
    if (looksCatastrophic(pattern)) return evalFailure(INLINE_UNSAFE);
    return evaluate(pattern, flags, text);
  }

  private inlineReplace(pattern: string, flags: string, text: string, template: string): ReplaceResult {
    if (looksCatastrophic(pattern)) return replaceFailure(INLINE_UNSAFE);
    return replaceAllMatches(pattern, flags, text, template);
  }
}

const INLINE_UNSAFE =
  "Web Workers are unavailable in this webview, so a pattern with nested quantifiers cannot be stopped once it starts backtracking. Simplify the pattern or run the tool in the native app.";

export const runner = new RegexRunner();
