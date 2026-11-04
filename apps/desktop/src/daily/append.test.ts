import { createStore } from "tinybase";
import { describe, expect, test } from "vitest";

import { appendToDailyNote } from "./append";

import type * as main from "~/store/tinybase/store/main";

function makeStore() {
  const store = createStore();
  store.setValue("user_id", "user-1");
  return store as unknown as main.Store;
}

function read(store: main.Store, date: string) {
  return JSON.parse(String(store.getCell("daily_notes", date, "content")));
}

describe("appendToDailyNote", () => {
  test("creates the day's note with the added line", () => {
    const store = makeStore();

    appendToDailyNote(store, "2026-11-04", "**9:41 PM** call the dentist");

    const doc = read(store, "2026-11-04");
    expect(doc.type).toBe("doc");
    expect(JSON.stringify(doc)).toContain("call the dentist");
    expect(store.getCell("daily_notes", "2026-11-04", "date")).toBe(
      "2026-11-04",
    );
    expect(store.getCell("daily_notes", "2026-11-04", "user_id")).toBe(
      "user-1",
    );
  });

  test("appends after what is already there without dropping it", () => {
    const store = makeStore();

    appendToDailyNote(store, "2026-11-04", "first thought");
    appendToDailyNote(store, "2026-11-04", "second thought");

    const text = JSON.stringify(read(store, "2026-11-04"));
    expect(text.indexOf("first thought")).toBeGreaterThan(-1);
    expect(text.indexOf("second thought")).toBeGreaterThan(
      text.indexOf("first thought"),
    );
  });

  test("a checkbox line becomes a real task item", () => {
    const store = makeStore();

    appendToDailyNote(store, "2026-11-04", "- [ ] Reply to Sam: Invoice");

    const text = JSON.stringify(read(store, "2026-11-04"));
    expect(text).toContain("taskItem");
    expect(text).toContain("Reply to Sam: Invoice");
  });

  test("different days stay separate", () => {
    const store = makeStore();

    appendToDailyNote(store, "2026-11-04", "today only");
    appendToDailyNote(store, "2026-11-05", "tomorrow only");

    expect(JSON.stringify(read(store, "2026-11-04"))).not.toContain(
      "tomorrow only",
    );
    expect(JSON.stringify(read(store, "2026-11-05"))).not.toContain(
      "today only",
    );
  });
});
