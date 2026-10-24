// The built-in model holds gigabytes of RAM and GPU memory while it runs, so
// it is started by the first request that needs it and stopped again once
// nothing has used it for a while. The port changes on every start, so the
// model is built against a placeholder origin that is swapped per request.
export const LOCAL_LLM_PLACEHOLDER_ORIGIN = "http://local-llm.notiz";
export const LOCAL_LLM_IDLE_MS = 5 * 60 * 1000;

export function createLocalLlmFetch({
  start,
  stop,
  send,
  idleMs = LOCAL_LLM_IDLE_MS,
}: {
  start: () => Promise<string>;
  stop: () => Promise<unknown>;
  send: typeof fetch;
  idleMs?: number;
}): typeof fetch {
  let inFlight = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const armIdleStop = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (inFlight === 0) void stop().catch(console.error);
    }, idleMs);
  };

  const release = () => {
    inFlight -= 1;
    armIdleStop();
  };

  return async (input, init) => {
    inFlight += 1;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    try {
      const origin = new URL(await start()).origin;
      const original = input instanceof Request ? input.url : String(input);
      const target = original.replace(LOCAL_LLM_PLACEHOLDER_ORIGIN, origin);
      const response = await send(
        input instanceof Request ? new Request(target, input) : target,
        init,
      );
      return releaseWhenDone(response, release);
    } catch (error) {
      release();
      throw error;
    }
  };
}

// A reply streams for a while after the headers arrive, so the model counts as
// busy until the body has been read or cancelled.
function releaseWhenDone(response: Response, release: () => void): Response {
  if (!response.body) {
    release();
    return response;
  }

  const reader = response.body.getReader();
  let released = false;
  const once = () => {
    if (!released) {
      released = true;
      release();
    }
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          once();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        once();
        controller.error(error);
      }
    },
    cancel(reason) {
      once();
      return reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
