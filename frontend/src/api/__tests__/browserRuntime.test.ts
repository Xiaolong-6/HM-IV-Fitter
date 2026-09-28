// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserCall,
  resetBrowserRuntime,
} from "../browserRuntime";

type PostedMessage = {
  id: number;
  method: string;
  payload: unknown;
  baseUrl: string;
};

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: PostedMessage[] = [];

  constructor(
    _url: string | URL,
    _options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: PostedMessage) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(result: unknown) {
    const request = this.posted.at(-1);
    if (!request) throw new Error("No request to respond to.");
    this.onmessage?.(
      new MessageEvent("message", {
        data: {
          id: request.id,
          ok: true,
          result,
        },
      }),
    );
  }
}

describe("browser runtime worker lifecycle", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
    resetBrowserRuntime();
  });

  afterEach(() => {
    resetBrowserRuntime();
    vi.unstubAllGlobals();
  });

  it("keeps the worker alive when a non-fit request is aborted", async () => {
    const controller = new AbortController();
    const firstCall = browserCall("component_registry", null, controller.signal);

    expect(FakeWorker.instances).toHaveLength(1);
    const firstWorker = FakeWorker.instances[0];

    controller.abort();

    await expect(firstCall).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker.terminated).toBe(false);

    const secondCall = browserCall<{ ready: boolean }>("equations", {
      core: [],
      series: [],
      parallel: [],
      temperature_K: 300,
      version: "test",
    });

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]).toBe(firstWorker);

    firstWorker.respond({ ready: true });
    await expect(secondCall).resolves.toEqual({ ready: true });
  });

  it("terminates a fit worker on abort and creates a fresh worker for the next call", async () => {
    const controller = new AbortController();
    const firstCall = browserCall("fit", { sample: true }, controller.signal);

    expect(FakeWorker.instances).toHaveLength(1);
    const firstWorker = FakeWorker.instances[0];
    expect(firstWorker.posted.at(-1)?.method).toBe("fit");

    controller.abort();

    await expect(firstCall).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker.terminated).toBe(true);

    const secondCall = browserCall<{ ready: boolean }>(
      "component_registry",
      null,
    );

    expect(FakeWorker.instances).toHaveLength(2);
    const secondWorker = FakeWorker.instances[1];
    expect(secondWorker).not.toBe(firstWorker);
    expect(secondWorker.terminated).toBe(false);

    secondWorker.respond({ ready: true });

    await expect(secondCall).resolves.toEqual({ ready: true });
  });
});
