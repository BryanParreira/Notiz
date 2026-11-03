import { createStore } from "tinybase";
import { beforeEach, describe, expect, it } from "vitest";

import { json2md, md2json, parseJsonContent } from "@notiz/editor/markdown";

import {
  buildEditNoteTool,
  coerceNoteEditMode,
  lastAssistantText,
  normalizeNoteContent,
  proposeNoteText,
  refersToPreviousReply,
  resetRecentNoteProposals,
  resolveNoteId,
} from "./edit-note";
import { usePendingEditStore } from "./pending-edit-store";
import type { ToolDependencies } from "./types";

function setup(markdown = "# Week 1\n\ni have to study for the test") {
  const store = createStore();
  store.setRow("sessions", "s1", {
    title: "Week 1",
    raw_md: JSON.stringify(md2json(markdown)),
  });

  let proposal: { current: string; proposed: string; target?: string } | null =
    null;
  const decide = { approve: true };

  const tool = buildEditNoteTool({
    getStore: () => store as never,
    getSessionId: () => "s1",
    openEditTab: (requestId: string) => {
      const edit = usePendingEditStore.getState().edits.get(requestId)!;
      proposal = {
        current: edit.currentContent,
        proposed: edit.proposedContent,
        target: edit.target,
      };
      queueMicrotask(() =>
        usePendingEditStore.getState().resolveEdit(requestId, decide.approve),
      );
    },
  } as Pick<ToolDependencies, "getStore" | "getSessionId" | "openEditTab">);

  const run = (input: object, messages?: unknown[]) =>
    tool.execute!(input as never, { messages } as never) as Promise<{
      status: string;
      message?: string;
    }>;
  const noteText = () =>
    json2md(
      parseJsonContent(store.getCell("sessions", "s1", "raw_md") as string),
    );

  return { store, run, noteText, decide, proposal: () => proposal };
}

describe("edit_note", () => {
  beforeEach(() => {
    usePendingEditStore.setState({ edits: new Map() });
    resetRecentNoteProposals();
  });

  it("adds to the end of the note once the user approves, keeping the title", async () => {
    const { run, noteText, store, proposal } = setup();

    const result = await run({
      mode: "append",
      content: "- Complete assignment",
    });

    expect(result.status).toBe("applied");
    expect(noteText()).toContain("i have to study for the test");
    expect(noteText()).toContain("Complete assignment");
    expect(noteText().startsWith("# Week 1")).toBe(true);
    expect(store.getCell("sessions", "s1", "title")).toBe("Week 1");
    expect(proposal()?.target).toBe("note");
    expect(proposal()?.proposed).toContain("Complete assignment");
  });

  it("uses the assistant's previous reply for 'add that to my note'", async () => {
    const { run, noteText, proposal } = setup();
    const messages = [
      { role: "user", content: "help me study" },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "## Plan\n- Review chapter 3\n- Practice problems",
          },
        ],
      },
      { role: "user", content: "add that to my note please" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolName: "edit_note" }],
      },
    ];

    const result = await run(
      { mode: "append", use_previous_reply: true },
      messages,
    );

    expect(result.status).toBe("applied");
    expect(noteText()).toContain("Review chapter 3");
    expect(noteText()).toContain("Practice problems");
    expect(proposal()?.proposed).toContain("## Plan");
  });

  it("adds the whole previous reply when the user said 'add that', even if the model retyped part of it", async () => {
    const { run, noteText } = setup();
    const messages = [
      {
        role: "assistant",
        content: "- Review chapter 3\n- Practice problems\n- Sleep early",
      },
      { role: "user", content: "add that to my note please" },
    ];

    await run({ mode: "append", content: "- Practice problems" }, messages);

    expect(noteText()).toContain("Review chapter 3");
    expect(noteText()).toContain("Sleep early");
  });

  it("can add the same text again later, since finished edits are not remembered", async () => {
    const { run, noteText } = setup();

    await run({ mode: "append", content: "- Water the plants" });
    await run({ mode: "append", content: "- Water the plants" });

    expect(noteText().match(/Water the plants/g)).toHaveLength(2);
  });

  it("uses the previous reply when the model sends no content at all", async () => {
    const { run, noteText } = setup();

    await run({ mode: "append" }, [
      { role: "assistant", content: "Buy milk and eggs" },
    ]);

    expect(noteText()).toContain("Buy milk and eggs");
  });

  it("says so when there is nothing to add", async () => {
    const { run } = setup();

    const result = await run({ mode: "append", use_previous_reply: true }, []);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/nothing to add/);
  });

  it("changes nothing when the user declines", async () => {
    const { run, noteText, decide } = setup();
    const before = noteText();
    decide.approve = false;

    const result = await run({ mode: "append", content: "- Sneaky addition" });

    expect(result.status).toBe("declined");
    expect(noteText()).toBe(before);
  });

  it("rewrites the whole note but keeps its title when the new text has none", async () => {
    const { run, noteText, store } = setup();

    const result = await run({
      mode: "replace_all",
      content: "Just this now.",
    });

    expect(result.status).toBe("applied");
    expect(noteText()).toContain("Just this now.");
    expect(noteText()).not.toContain("study for the test");
    expect(store.getCell("sessions", "s1", "title")).toBe("Week 1");
  });

  it("adds to an empty note under its title", async () => {
    const { store, run, noteText } = setup("");
    store.setCell("sessions", "s1", "raw_md", "");

    await run({ mode: "append", content: "First thoughts" });

    expect(noteText()).toContain("Week 1");
    expect(noteText()).toContain("First thoughts");
  });

  it("edits the open note even when the model guesses a made-up id", async () => {
    const { run, noteText } = setup();

    for (const guess of ["week 1 note", "your_note_id", "this note"]) {
      const result = await run({
        sessionId: guess,
        mode: "append",
        content: `added via ${guess}`,
      });
      expect(result.status).toBe("applied");
    }

    expect(noteText()).toContain("added via week 1 note");
    expect(noteText()).toContain("added via this note");
  });

  it("proposes the same change once when the model sends it twice at once", async () => {
    const { run, noteText } = setup();

    const [first, second] = await Promise.all([
      run({ mode: "append", content: "- Complete assignment" }),
      run({ mode: "append", content: "- Complete assignment" }),
    ]);

    expect(first.status).toBe("applied");
    expect(second.status).toBe("applied");
    expect(noteText().match(/Complete assignment/g)).toHaveLength(1);
  });

  it("lets the user ask again after declining", async () => {
    const { run, decide, noteText } = setup();
    decide.approve = false;
    expect((await run({ mode: "append", content: "- Retry me" })).status).toBe(
      "declined",
    );

    decide.approve = true;
    expect((await run({ mode: "append", content: "- Retry me" })).status).toBe(
      "applied",
    );
    expect(noteText()).toContain("Retry me");
  });

  it("refuses when no note is open, or when nothing would change", async () => {
    const empty = buildEditNoteTool({
      getStore: () => createStore() as never,
      getSessionId: () => undefined,
      openEditTab: () => {},
    } as never);
    const missing = (await empty.execute!(
      { mode: "append", content: "x" } as never,
      {} as never,
    )) as { status: string };
    expect(missing.status).toBe("error");

    const { run } = setup("# Week 1\n\nSame text");
    expect(
      (await run({ mode: "replace_all", content: "# Week 1\n\nSame text" }))
        .status,
    ).toBe("error");
  });
});

describe("helpers", () => {
  it("reads loose wording for the edit mode", () => {
    expect(coerceNoteEditMode("add")).toBe("append");
    expect(coerceNoteEditMode("Insert")).toBe("append");
    expect(coerceNoteEditMode(undefined)).toBe("append");
    expect(coerceNoteEditMode("rewrite")).toBe("replace_all");
    expect(coerceNoteEditMode("replace all")).toBe("replace_all");
  });

  it("builds the proposed text without touching the title", () => {
    expect(
      proposeNoteText({
        currentMarkdown: "# Week 1\n\nold",
        title: "Week 1",
        mode: "append",
        content: "new",
      }),
    ).toBe("# Week 1\n\nold\n\nnew");
    expect(
      proposeNoteText({
        currentMarkdown: "# Week 1\n\nold",
        title: "Week 1",
        mode: "replace_all",
        content: "# New title\n\nbody",
      }),
    ).toBe("# New title\n\nbody");
  });
});

describe("resolveNoteId", () => {
  const store = createStore();
  store.setRow("sessions", "abc", { title: "Week 1" });
  store.setRow("sessions", "def", { title: "Weekly planning" });

  it("prefers a real id, then the open note", () => {
    expect(resolveNoteId(store as never, "def", "abc")).toBe("def");
    expect(resolveNoteId(store as never, "nonsense", "abc")).toBe("abc");
    expect(resolveNoteId(store as never, undefined, "abc")).toBe("abc");
  });

  it("matches a note by title when none is open", () => {
    expect(resolveNoteId(store as never, "week 1 note", undefined)).toBe("abc");
    expect(resolveNoteId(store as never, "planning", undefined)).toBe("def");
    expect(resolveNoteId(store as never, "unknown", undefined)).toBeUndefined();
    expect(resolveNoteId(store as never, undefined, undefined)).toBeUndefined();
  });
});

describe("lastAssistantText", () => {
  it("finds the latest assistant message that has words, skipping tool calls", () => {
    expect(
      lastAssistantText([
        { role: "assistant", content: "older" },
        { role: "assistant", content: [{ type: "text", text: "newer" }] },
        { role: "assistant", content: [{ type: "tool-call", toolName: "x" }] },
        { role: "user", content: "ok" },
      ]),
    ).toBe("newer");
  });

  it("returns null when the assistant has said nothing", () => {
    expect(lastAssistantText([{ role: "user", content: "hi" }])).toBeNull();
    expect(lastAssistantText(undefined)).toBeNull();
  });
});

describe("normalizeNoteContent", () => {
  it("turns written-out line breaks back into real ones", () => {
    expect(normalizeNoteContent("- one\\n- two\\n\\t- sub")).toBe(
      "- one\n- two\n  - sub",
    );
  });

  it("leaves properly formatted text alone", () => {
    expect(normalizeNoteContent("- one\n- two\n")).toBe("- one\n- two");
    expect(normalizeNoteContent("a path like C:\\new")).toBe(
      "a path like C:\\new",
    );
  });
});

describe("refersToPreviousReply", () => {
  it("is true when the user means what was just said", () => {
    for (const text of [
      "add that to my note please",
      "put this in the note",
      "can you save it to my note?",
      "write those down in the week 1 note",
      "append the list to my note",
    ]) {
      expect(refersToPreviousReply(text)).toBe(true);
    }
  });

  it("is false when the user gave new content or something else", () => {
    for (const text of [
      "add this to my note: buy milk",
      "add milk to my note",
      "what is in my note?",
      "rename my note",
    ]) {
      expect(refersToPreviousReply(text)).toBe(false);
    }
  });
});
