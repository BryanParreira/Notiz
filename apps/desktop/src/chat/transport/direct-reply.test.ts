import { readUIMessageStream } from "ai";
import { describe, expect, it, vi } from "vitest";

import type { NotizUIMessage } from "../types";
import { CustomChatTransport, type DataContext } from "./index";

const user: NotizUIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "what about my email?" }],
};

// A model that fails the test if it is ever asked to answer.
const model = {
  specificationVersion: "v3",
  provider: "test",
  modelId: "never",
  doStream: vi.fn(() => {
    throw new Error("the model must not be called for a card-only reply");
  }),
  doGenerate: vi.fn(() => {
    throw new Error("the model must not be called for a card-only reply");
  }),
  supportedUrls: {},
};

async function reply(data: DataContext | null) {
  const transport = new CustomChatTransport(
    model as never,
    {},
    "system",
    undefined,
    async () => data,
  );
  const stream = await transport.sendMessages({
    chatId: "c",
    trigger: "submit-message",
    messageId: undefined,
    messages: [user],
    abortSignal: undefined,
  });

  let last: NotizUIMessage | undefined;
  for await (const message of readUIMessageStream<NotizUIMessage>({
    stream: stream as never,
  })) {
    last = message;
  }
  return last;
}

describe("direct replies", () => {
  it("shows cards without calling the model", async () => {
    const message = await reply({
      direct: true,
      text: null,
      emailCards: [
        {
          id: "a:1",
          from: "Stripe",
          subject: "Fraud",
          date: null,
          unread: true,
        },
      ],
    });

    expect(model.doStream).not.toHaveBeenCalled();
    expect(message?.role).toBe("assistant");
    expect(message?.parts.filter((part) => part.type === "text")).toHaveLength(
      0,
    );
    expect(message?.metadata?.emailCards?.[0].from).toBe("Stripe");
  });

  it("says a plain sentence when there is nothing to draw", async () => {
    const message = await reply({
      direct: true,
      text: "Nothing is scheduled today and tomorrow.",
    });

    expect(model.doStream).not.toHaveBeenCalled();
    expect(message?.parts).toEqual([
      expect.objectContaining({
        type: "text",
        text: "Nothing is scheduled today and tomorrow.",
      }),
    ]);
  });

  it("carries an agenda card too", async () => {
    const message = await reply({
      direct: true,
      text: null,
      agenda: [
        {
          label: "Monday, Oct 26",
          events: [{ title: "CIS 121", time: "8:00 AM" }],
        },
      ],
    });

    expect(message?.metadata?.agenda?.[0].events[0].title).toBe("CIS 121");
  });
});
