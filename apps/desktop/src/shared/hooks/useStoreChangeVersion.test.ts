import { act, renderHook } from "@testing-library/react";
import { createStore } from "tinybase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ignoreCurrentNoteText,
  useStoreChangeVersion,
} from "./useStoreChangeVersion";

const TABLES = ["sessions", "enhanced_notes"] as const;

function setup(sessionId = "current") {
  const store = createStore();
  store.setRow("sessions", "current", { title: "Mine", raw_md: "" });
  store.setRow("sessions", "other", { title: "Other", raw_md: "" });
  store.setRow("enhanced_notes", "mine-note", {
    session_id: "current",
    content: "",
  });
  store.setRow("enhanced_notes", "other-note", {
    session_id: "other",
    content: "",
  });

  const hook = renderHook(() =>
    useStoreChangeVersion(store as never, TABLES, {
      ignore: ignoreCurrentNoteText(sessionId) as never,
    }),
  );
  return { store, hook };
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 5)));

describe("useStoreChangeVersion", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
      setTimeout(cb, 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("updates when another note changes", async () => {
    const { store, hook } = setup();
    const before = hook.result.current;

    store.setCell("sessions", "other", "title", "Renamed");
    await flush();

    expect(hook.result.current).toBeGreaterThan(before);
  });

  it("ignores typing in the current note", async () => {
    const { store, hook } = setup();
    const before = hook.result.current;

    for (const text of ["h", "he", "hel", "hell", "hello"]) {
      store.setCell("sessions", "current", "raw_md", text);
    }
    await flush();

    expect(hook.result.current).toBe(before);
  });

  it("ignores the current note's AI notes streaming in", async () => {
    const { store, hook } = setup();
    const before = hook.result.current;

    store.setCell("enhanced_notes", "mine-note", "content", "streamed text");
    await flush();

    expect(hook.result.current).toBe(before);
  });

  it("still reacts to the current note's title, and to other notes' AI notes", async () => {
    const { store, hook } = setup();
    let seen = hook.result.current;

    store.setCell("sessions", "current", "title", "New title");
    await flush();
    expect(hook.result.current).toBeGreaterThan(seen);

    seen = hook.result.current;
    store.setCell("enhanced_notes", "other-note", "content", "summary");
    await flush();
    expect(hook.result.current).toBeGreaterThan(seen);
  });

  it("collapses a burst of changes into one update", async () => {
    const { store, hook } = setup();
    const before = hook.result.current;

    store.transaction(() => {
      store.setCell("sessions", "other", "title", "a");
      store.setCell("sessions", "other", "title", "b");
    });
    store.setCell("sessions", "other", "title", "c");
    await flush();

    expect(hook.result.current).toBe(before + 1);
  });
});
