import type { InboxEmail } from "../tools/types";

export type Inbox = { connected: boolean; messages: InboxEmail[] };

const FRESH_MS = 2 * 60 * 1000;

// Reading mail takes a moment (and can ask macOS for the Keychain), so chat must
// never wait on it for long. This keeps the last result, refreshes it in the
// background, and hands back what it has if the mail server is slow.
export function createInboxCache(
  fetchInbox: () => Promise<Inbox>,
  now: () => number = Date.now,
) {
  let cached: { at: number; inbox: Inbox } | null = null;
  let inflight: Promise<Inbox> | null = null;

  const refresh = (): Promise<Inbox> => {
    inflight ??= fetchInbox()
      .then((inbox) => {
        cached = { at: now(), inbox };
        return inbox;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const get = async (
    waitMs: number,
  ): Promise<{ inbox: Inbox | null; error?: string }> => {
    if (cached && now() - cached.at < FRESH_MS) {
      return { inbox: cached.inbox };
    }

    const pending = refresh();
    // A slow load that finishes later still fills the cache for next time.
    pending.catch(() => {});

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const inbox = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("the mail server is slow to answer")),
            waitMs,
          );
        }),
      ]);
      return { inbox };
    } catch (error) {
      return {
        inbox: cached?.inbox ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  };

  return { get, refresh };
}
