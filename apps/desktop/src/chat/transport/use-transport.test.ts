import { describe, expect, it, vi } from "vitest";

import { buildToolGuidance } from "./guidance";
import {
  isSmallTalk,
  wantsCardOnly,
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

  it("offers the calendar tool only for the events group", () => {
    expect(toolNamesForGroups(["events"])).toEqual(["create_calendar_event"]);
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
      "edit_note",
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

describe("wantsCardOnly", () => {
  it("answers plain 'show me' questions with a card alone", () => {
    for (const text of [
      "what about my email?",
      "anything important in my email?",
      "what's unread?",
      "check my calendar for me please",
      "what do i have to do this upcoming week?",
      "what do i have tomorrow",
    ]) {
      expect(wantsCardOnly(text)).toBe(true);
    }
  });

  it("leaves questions that need judgement or writing to the model", () => {
    for (const text of [
      "draft a short reply to the latest email",
      "what is the latest email about?",
      "help me plan tomorrow",
      "summarize my week",
      "should i reply to stripe?",
      "prepare me for my meeting",
    ]) {
      expect(wantsCardOnly(text)).toBe(false);
    }
  });
});

describe("messages about a note are not about the calendar", () => {
  const request = "add those information into the week 1 note please";

  it("does not mistake the word 'week' for a calendar question", () => {
    expect(toolGroupsForMessage(request)).not.toContain("calendar");
    expect(toolGroupsForMessage("rename the week 2 note")).not.toContain(
      "calendar",
    );
    expect(toolGroupsForMessage("what do i have this upcoming week")).toContain(
      "calendar",
    );
  });

  it("never answers requests that change or mention notes with a card", () => {
    for (const text of [
      request,
      "put this in my notes for today",
      "check my notes from last week",
      "save the agenda to the note",
      "update tomorrow's plan in the note",
    ]) {
      expect(wantsCardOnly(text)).toBe(false);
    }
  });

  it("needs a request to look before it draws a card", () => {
    expect(wantsCardOnly("calendar")).toBe(false);
    expect(wantsCardOnly("my email is long")).toBe(false);
    expect(wantsCardOnly("show me my calendar")).toBe(true);
  });
});

describe("adding events to the calendar", () => {
  it("offers the calendar tool only when asked to add something", () => {
    for (const text of [
      "schedule a study session tomorrow at 3pm",
      "add a meeting with Sam on Friday to my calendar",
      "book lunch with Ana next week",
      "create an event for the team call",
    ]) {
      expect(toolGroupsForMessage(text)).toContain("events");
    }

    for (const text of [
      "what do i have tomorrow?",
      "add those to the week 1 note",
      "what's on my schedule",
      "check my calendar",
    ]) {
      expect(toolGroupsForMessage(text)).not.toContain("events");
    }
  });

  it("never answers a request to add or book something with a card", () => {
    expect(wantsCardOnly("schedule a meeting tomorrow at 3")).toBe(false);
    expect(wantsCardOnly("book lunch on friday, what time works?")).toBe(false);
    expect(wantsCardOnly("what's my schedule tomorrow")).toBe(true);
  });
});

describe("stopping after a change", () => {
  const result = (toolName: string, status: string) => ({
    content: [{ type: "tool-result", toolName, output: { status } }],
  });

  it("makes the model report back once a change went through or was declined", () => {
    for (const [tool, status] of [
      ["create_calendar_event", "created"],
      ["edit_note", "applied"],
      ["edit_note", "declined"],
    ] as const) {
      expect(shouldForceAnswer([result(tool, status)], 1)).toBe(true);
    }
  });

  it("lets the model keep going after reading or after a failed change", () => {
    expect(shouldForceAnswer([result("search_sessions", "ok")], 1)).toBe(false);
    expect(shouldForceAnswer([result("edit_note", "error")], 1)).toBe(false);
  });
});
