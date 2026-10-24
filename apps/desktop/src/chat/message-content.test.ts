import { describe, expect, it } from "vitest";

import { hasRenderableParts, isStrayToolCallText } from "./message-content";

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
