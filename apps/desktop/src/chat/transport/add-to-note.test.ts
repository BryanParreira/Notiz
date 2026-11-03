import { readUIMessageStream } from "ai";
import { describe, expect, it, vi } from "vitest";

import type { NotizUIMessage } from "../types";
import { CustomChatTransport } from "./index";

const model = {
  specificationVersion: "v3",
  provider: "test",
  modelId: "never",
  doStream: vi.fn(() => {
    throw new Error("the model must not be called");
  }),
  doGenerate: vi.fn(() => {
    throw new Error("the model must not be called");
  }),
  supportedUrls: {},
};

async function run(userText: string, status: string, history = true) {
  const execute = vi.fn(async () => ({ status }));
  const transport = new CustomChatTransport(
    model as never,
    { edit_note: { execute } } as never,
    "system",
    undefined,
    async () => null,
  );
  const stream = await transport.sendMessages({
    chatId: "c",
    trigger: "submit-message",
    messageId: undefined,
    abortSignal: undefined,
    messages: [
      ...(history
        ? [
            {
              id: "u0",
              role: "user",
              parts: [{ type: "text", text: "plan?" }],
            },
            {
              id: "a0",
              role: "assistant",
              parts: [{ type: "text", text: "# Plan\n\n- study" }],
            },
          ]
        : []),
      { id: "u1", role: "user", parts: [{ type: "text", text: userText }] },
    ] as NotizUIMessage[],
  });
  let last: NotizUIMessage | undefined;
  for await (const message of readUIMessageStream<NotizUIMessage>({
    stream: stream as never,
  })) {
    last = message;
  }
  return { execute, last };
}

describe("add the previous reply to a note", () => {
  it("runs the edit without asking the model to retype it", async () => {
    const { execute, last } = await run(
      "add that to my note please",
      "applied",
    );

    expect(model.doStream).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      { mode: "append", use_previous_reply: true },
      expect.objectContaining({ messages: expect.any(Array) }),
    );
    expect(last?.parts.some((part) => part.type === "tool-edit_note")).toBe(
      true,
    );
    expect(JSON.stringify(last?.parts)).toContain("added it to your note");
  });

  it("says so when the user declines", async () => {
    const { last } = await run("put that in my note", "declined");
    expect(JSON.stringify(last?.parts)).toContain("left your note");
  });

  it("does not invent anything when there is no earlier reply", async () => {
    const { execute, last } = await run(
      "add that to my notes please",
      "applied",
      false,
    );

    expect(model.doStream).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(last?.parts)).toContain("nothing to add yet");
  });
});
