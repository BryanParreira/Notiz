import { describe, expect, it, vi } from "vitest";

import { CustomChatTransport, shouldForceAnswer } from "./index";
import { appendFileContextToolGuidance } from "./use-transport";

describe("chat transport prompt guidance", () => {
  it("keeps tools for questions that need notes, and off for small talk", () => {
    const prompt = appendFileContextToolGuidance("Base prompt");

    expect(prompt).toContain("Base prompt");
    expect(prompt).toContain(
      "When the user asks about their meetings or notes",
    );
    expect(prompt).toContain("use search_sessions");
    expect(prompt).toContain("greetings, small talk");
    expect(prompt).toContain("do not call any tool");
    expect(prompt).toContain("Never call the same tool twice");
  });
});

describe("shouldForceAnswer", () => {
  const call = (toolName: string, input: unknown) => ({
    type: "tool-call",
    toolName,
    input,
  });

  it("allows the first tool step", () => {
    expect(shouldForceAnswer([], 0)).toBe(false);
    expect(
      shouldForceAnswer(
        [{ content: [call("search_sessions", { q: "a" })] }],
        1,
      ),
    ).toBe(false);
  });

  it("stops offering tools after a failed tool call", () => {
    expect(
      shouldForceAnswer(
        [{ content: [call("read_current_note", {}), { type: "tool-error" }] }],
        1,
      ),
    ).toBe(true);
  });

  it("stops offering tools when the same call repeats", () => {
    expect(
      shouldForceAnswer(
        [
          { content: [call("read_current_note", {})] },
          { content: [call("read_current_note", {})] },
        ],
        2,
      ),
    ).toBe(true);
  });

  it("forces an answer on the last allowed step", () => {
    expect(shouldForceAnswer([], 3)).toBe(true);
  });
});

describe("context loading", () => {
  it("answers without context when loading a note fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = new CustomChatTransport(
      {} as never,
      {},
      undefined,
      async () => {
        throw new Error("fs unavailable");
      },
    );

    const block = await (
      transport as unknown as {
        renderContextBlock: (
          refs: unknown[],
          cache: Map<string, string | null>,
        ) => Promise<string | null>;
      }
    ).renderContextBlock(
      [
        {
          kind: "session",
          key: "session:1",
          source: "tool",
          sessionId: "1",
        },
      ],
      new Map(),
    );

    expect(block).toBeNull();
  });
});
