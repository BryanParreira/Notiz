import { describe, expect, it } from "vitest";

import {
  describeCards,
  hasRenderableContent,
  hasRenderableParts,
  isStrayToolCallText,
  stripStrayToolCalls,
} from "./message-content";
import type { NotizUIMessage } from "./types";

describe("isStrayToolCallText", () => {
  it("detects a tool call printed as text", () => {
    expect(
      isStrayToolCallText(
        '{"name": "search_contacts", "parameters": {"query": "hello", "limit": "1"}}',
      ),
    ).toBe(true);
  });

  it("leaves normal replies and other JSON alone", () => {
    expect(isStrayToolCallText("Hi! How can I help?")).toBe(false);
    expect(isStrayToolCallText('{"colour": "red"}')).toBe(false);
    expect(isStrayToolCallText("{not json}")).toBe(false);
  });

  it("does not count a stray tool call as renderable content", () => {
    expect(
      hasRenderableParts([
        { type: "text", text: '{"name":"x","parameters":{}}' },
      ]),
    ).toBe(false);
    expect(hasRenderableParts([{ type: "text", text: "Hello" }])).toBe(true);
  });
});

describe("stripStrayToolCalls", () => {
  it("cuts a tool call printed in the middle of a sentence", () => {
    expect(
      stripStrayToolCalls(
        'I could not read it. I will try again. {"name": "list_inbox", "parameters": {"limit": "10", "unread_only": "true"}}',
      ),
    ).toBe("I could not read it. I will try again.");
  });

  it("keeps ordinary braces and JSON that is not a tool call", () => {
    const text = 'Use {"colour": "red"} or a block { like this }.';

    expect(stripStrayToolCalls(text)).toBe(text);
  });

  it("returns nothing when the whole text was a tool call", () => {
    expect(stripStrayToolCalls('{"name": "x", "parameters": {"a": "}"}}')).toBe(
      "",
    );
  });
});

describe("card replies", () => {
  const card = {
    id: "a:1",
    from: "Stripe",
    subject: "Fraud protection",
    date: null,
    unread: true,
  };
  const day = {
    label: "Monday, Oct 26",
    events: [{ title: "CIS 121", time: "8:00 AM" }],
  };

  it("counts a message that is only cards as content", () => {
    const cardsOnly: NotizUIMessage = {
      id: "m",
      role: "assistant",
      parts: [],
      metadata: { emailCards: [card] },
    };
    const empty: NotizUIMessage = { id: "e", role: "assistant", parts: [] };

    expect(hasRenderableContent(cardsOnly)).toBe(true);
    expect(
      hasRenderableContent({ ...cardsOnly, metadata: { agenda: [day] } }),
    ).toBe(true);
    expect(hasRenderableContent(empty)).toBe(false);
  });

  it("describes what a card reply showed for the conversation history", () => {
    expect(describeCards({ emailCards: [card, card] })).toBe(
      "(Showed the user 2 of their emails.)",
    );
    expect(describeCards({ agenda: [day] })).toBe(
      "(Showed the user their schedule (1 events).)",
    );
    expect(describeCards({})).toBeNull();
  });
});
