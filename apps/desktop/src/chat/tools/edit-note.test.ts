import { createStore } from "tinybase";
import { beforeEach, describe, expect, it } from "vitest";

import { json2md, md2json, parseJsonContent } from "@notiz/editor/markdown";

import {
  buildEditNoteTool,
  coerceNoteEditMode,
  proposeNoteText,
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

  const run = (input: object) =>
    tool.execute!(input as never, {} as never) as Promise<{
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
