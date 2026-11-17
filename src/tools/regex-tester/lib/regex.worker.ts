import { evaluate, replaceAllMatches } from "./engine";
import type { WorkerRequest, WorkerResponse } from "./engine";

/**
 * RegExp runs here, off the UI thread. A catastrophic pattern only hangs this
 * worker; the view terminates it after HARD_TIMEOUT_MS and surfaces a warning.
 */
const ctx = self as unknown as {
  postMessage: (message: WorkerResponse) => void;
  addEventListener: (type: "message", listener: (event: MessageEvent<WorkerRequest>) => void) => void;
};

ctx.addEventListener("message", (event) => {
  const request = event.data;

  if (request.kind === "evaluate") {
    ctx.postMessage({
      id: request.id,
      kind: "evaluate",
      result: evaluate(request.pattern, request.flags, request.text),
    });
    return;
  }

  ctx.postMessage({
    id: request.id,
    kind: "replace",
    result: replaceAllMatches(request.pattern, request.flags, request.text, request.template),
  });
});
