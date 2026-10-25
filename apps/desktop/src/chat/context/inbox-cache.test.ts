import { describe, expect, it, vi } from "vitest";

import { createInboxCache, type Inbox } from "./inbox-cache";

const inbox: Inbox = { connected: true, messages: [] };

describe("createInboxCache", () => {
  it("reuses a recent result instead of reading mail again", async () => {
    const fetchInbox = vi.fn().mockResolvedValue(inbox);
    const cache = createInboxCache(fetchInbox);

    await cache.get(1000);
    const second = await cache.get(1000);

    expect(fetchInbox).toHaveBeenCalledTimes(1);
    expect(second.inbox).toBe(inbox);
  });

  it("reads again once the result is old", async () => {
    let time = 0;
    const fetchInbox = vi.fn().mockResolvedValue(inbox);
    const cache = createInboxCache(fetchInbox, () => time);

    await cache.get(1000);
    time = 3 * 60 * 1000;
    await cache.get(1000);

    expect(fetchInbox).toHaveBeenCalledTimes(2);
  });

  it("does not make chat wait for a slow mail server", async () => {
    vi.useFakeTimers();
    const fetchInbox = vi.fn(() => new Promise<Inbox>(() => {}));
    const cache = createInboxCache(fetchInbox);

    const pending = cache.get(1500);
    await vi.advanceTimersByTimeAsync(1600);
    const result = await pending;
    vi.useRealTimers();

    expect(result.inbox).toBeNull();
    expect(result.error).toMatch(/slow/);
  });

  it("falls back to the last good result when mail fails", async () => {
    let time = 0;
    const fetchInbox = vi
      .fn()
      .mockResolvedValueOnce(inbox)
      .mockRejectedValueOnce(new Error("login failed"));
    const cache = createInboxCache(fetchInbox, () => time);

    await cache.get(1000);
    time = 3 * 60 * 1000;
    const result = await cache.get(1000);

    expect(result.inbox).toBe(inbox);
    expect(result.error).toBe("login failed");
  });

  it("shares one read between callers that ask at the same time", async () => {
    const fetchInbox = vi.fn().mockResolvedValue(inbox);
    const cache = createInboxCache(fetchInbox);

    await Promise.all([cache.get(1000), cache.get(1000), cache.refresh()]);

    expect(fetchInbox).toHaveBeenCalledTimes(1);
  });
});
