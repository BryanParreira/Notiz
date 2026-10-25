import { describe, expect, it, vi } from "vitest";

import { buildToolGuidance } from "./guidance";
import {
  isSmallTalk,
  toolGroupsForMessage,
  toolGroupsUsedIn,
  toolNamesForGroups,
} from "./helpers";
import { CustomChatTransport, shouldForceAnswer } from "./index";

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

describe("toolGroupsForMessage", () => {
  it("offers no tools for conversation, greetings and general questions", () => {
    for (const text of [
      "hello",
      "Hello!",
      "thanks",
      "how are you?",
      "explain how a binary tree works",
      "write a haiku about autumn",
      "what is the capital of France",
    ]) {
      expect(toolGroupsForMessage(text)).toEqual([]);
    }
  });

  it("recognises the kind of question, so the right data is fetched", () => {
    expect(
      toolGroupsForMessage("hello can u tell what do i have this week?"),
    ).toEqual(["calendar"]);
    expect(toolGroupsForMessage("anything important in my email?")).toEqual([
      "inbox",
    ]);
    expect(toolGroupsForMessage("what's unread in my inbox")).toEqual([
      "inbox",
    ]);
    expect(toolGroupsForMessage("did we decide on pricing")).toEqual(["notes"]);
    expect(toolGroupsForMessage("what's on my calendar tomorrow")).toEqual([
      "calendar",
    ]);
  });

  it("combines groups when a message spans them", () => {
    expect(
      toolGroupsForMessage("summarize my meeting and check my email"),
    ).toEqual(["inbox", "notes"]);
  });
});

describe("toolGroupsUsedIn", () => {
  it("keeps the groups already used so follow-ups still work", () => {
    expect(
      toolGroupsUsedIn([
        { parts: [{ type: "text" }] },
        { parts: [{ type: "tool-search_sessions" }, { type: "text" }] },
      ]),
    ).toEqual(["notes"]);
    expect(toolGroupsUsedIn([{ parts: [{ type: "text" }] }])).toEqual([]);
  });
});

describe("toolNamesForGroups", () => {
  it("offers no tools for calendar and email, which are fetched by the app", () => {
    expect(toolNamesForGroups(["calendar", "inbox"])).toEqual([]);
  });

  it("lists each tool once for the groups that use tools", () => {
    expect(toolNamesForGroups(["contacts", "notes", "contacts"])).toEqual([
      "search_contacts",
      "search_sessions",
      "read_note",
      "read_current_note",
      "grep_notes",
      "list_related_notes",
      "apply_session_correction",
      "edit_summary",
    ]);
  });
});

describe("buildToolGuidance", () => {
  it("is just the assistant brief when nothing is offered", () => {
    const text = buildToolGuidance([]);

    expect(text).toContain("personal assistant");
    expect(text).toContain("Never invent");
    expect(text).toContain("draft an email");
    expect(text).toContain(
      "never say you cannot access their calendar or email",
    );
    expect(text).not.toContain("Tool rules");
  });

  it("has no tool rules for calendar and email, which need no tools", () => {
    const text = buildToolGuidance(["calendar", "inbox"]);

    expect(text).toContain("calendar is given below");
    expect(text).toContain("email is given below");
    expect(text).not.toContain("Tool rules");
  });

  it("only mentions the tools on offer", () => {
    const text = buildToolGuidance(["notes"]);

    expect(text).toContain("search_sessions");
    expect(text).toContain("never call the same tool twice");
    expect(text).not.toContain("web_search");
  });

  it("stays small enough for a model with a few thousand tokens", () => {
    const all = buildToolGuidance(["calendar", "inbox", "notes", "contacts"]);

    expect(all.length / 4).toBeLessThan(750);
  });
});

describe("isSmallTalk", () => {
  it("recognises greetings so they get no calendar or inbox attached", () => {
    for (const text of [
      "hello",
      "Hello!",
      "hey there",
      "thanks",
      "good morning",
      "how are you?",
    ]) {
      expect(isSmallTalk(text)).toBe(true);
    }
  });

  it("does not treat real requests as small talk", () => {
    for (const text of [
      "hello, what do i have tomorrow?",
      "thanks, now draft a reply",
      "plan my day",
      "",
    ]) {
      expect(isSmallTalk(text)).toBe(false);
    }
  });
});
