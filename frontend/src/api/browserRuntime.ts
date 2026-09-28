type BrowserWorkerResponse = {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  cleanup?: () => void;
};

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function staticBaseUrl(): string {
  const configured = import.meta.env.BASE_URL || "./";
  return new URL(configured, window.location.href).toString();
}

function workerUrl(): string {
  return new URL("browser-runtime.worker.js", staticBaseUrl()).toString();
}

function abortError(): DOMException {
  return new DOMException("Operation aborted.", "AbortError");
}

function failPending(reason: unknown) {
  for (const request of pending.values()) {
    request.cleanup?.();
    request.reject(reason);
  }
  pending.clear();
}

function disposeWorker(reason?: unknown) {
  worker?.terminate();
  worker = null;
  if (reason !== undefined) failPending(reason);
}

function ensureWorker(): Worker {
  if (worker) return worker;

  const next = new Worker(workerUrl());
  next.onmessage = (event: MessageEvent<BrowserWorkerResponse>) => {
    const message = event.data;
    const request = pending.get(message.id);
    if (!request) return;

    pending.delete(message.id);
    request.cleanup?.();

    if (message.ok) {
      request.resolve(message.result);
      return;
    }
    request.reject(new Error(message.error || "Browser numerical runtime failed."));
  };
  next.onerror = (event) => {
    const reason = new Error(
      event.message || "Browser numerical runtime worker crashed.",
    );
    disposeWorker(reason);
  };
  worker = next;
  return next;
}

export function browserRuntimeEnabled(): boolean {
  return (
    import.meta.env.MODE === "static" ||
    String(import.meta.env.VITE_IVFITTER_RUNTIME || "").toLowerCase() === "browser"
  );
}

export function browserCall<T>(
  method: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());

  const activeWorker = ensureWorker();
  const id = nextRequestId++;

  return new Promise<T>((resolve, reject) => {
    const request: PendingRequest = {
      resolve: (value) => resolve(value as T),
      reject,
    };

    if (signal) {
      const onAbort = () => {
        const current = pending.get(id);
        if (!current) return;
        pending.delete(id);
        current.cleanup?.();

        if (method === "fit") {
          disposeWorker();
        }
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      request.cleanup = () => signal.removeEventListener("abort", onAbort);
    }

    pending.set(id, request);
    activeWorker.postMessage({
      id,
      method,
      payload,
      baseUrl: staticBaseUrl(),
    });
  });
}

export function resetBrowserRuntime() {
  disposeWorker(new Error("Browser numerical runtime was reset."));
}
