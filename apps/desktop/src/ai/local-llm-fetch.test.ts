import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLocalLlmFetch,
  LOCAL_LLM_PLACEHOLDER_ORIGIN,
} from "./local-llm-fetch";

describe("createLocalLlmFetch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (body: string | null = "ok") => {
    const start = vi.fn().mockResolvedValue("http://127.0.0.1:5555/v1");
    const stop = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn(async () => new Response(body));
    const localFetch = createLocalLlmFetch({
      start,
      stop,
      send: send as unknown as typeof fetch,
      idleMs: 1000,
    });
    return { start, stop, send, localFetch };
  };

  it("starts the server and points the request at its port", async () => {
    const { start, send, localFetch } = setup();

    const response = await localFetch(
      `${LOCAL_LLM_PLACEHOLDER_ORIGIN}/v1/chat/completions`,
    );
    await response.text();

    expect(start).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      "http://127.0.0.1:5555/v1/chat/completions",
      undefined,
    );
  });

  it("stops the server after it has been idle", async () => {
    const { stop, localFetch } = setup();

    const response = await localFetch(`${LOCAL_LLM_PLACEHOLDER_ORIGIN}/v1/x`);
    await response.text();

    await vi.advanceTimersByTimeAsync(999);
    expect(stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the server while a reply is still streaming", async () => {
    const { stop, localFetch } = setup();

    const response = await localFetch(`${LOCAL_LLM_PLACEHOLDER_ORIGIN}/v1/x`);

    await vi.advanceTimersByTimeAsync(5000);
    expect(stop).not.toHaveBeenCalled();

    await response.text();
    await vi.advanceTimersByTimeAsync(1001);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("still counts a failed start toward idle shutdown", async () => {
    const { start, stop, localFetch } = setup();
    start.mockRejectedValueOnce(new Error("Model not downloaded"));

    await expect(
      localFetch(`${LOCAL_LLM_PLACEHOLDER_ORIGIN}/v1/x`),
    ).rejects.toThrow("Model not downloaded");

    await vi.advanceTimersByTimeAsync(1001);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("warms the model ahead of a request and still unloads it when unused", async () => {
    const { start, stop, localFetch } = setup();

    localFetch.warm();
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("ignores a failed warm-up", async () => {
    const { start, localFetch } = setup();
    start.mockRejectedValueOnce(new Error("Model not downloaded"));

    expect(() => localFetch.warm()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});
