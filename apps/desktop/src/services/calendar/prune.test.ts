import { createMergeableStore } from "tinybase";
import { describe, expect, test } from "vitest";

import { pruneStaleCalendarEvents } from "./prune";

import type { Store } from "~/store/tinybase/store/main";

function makeStore() {
  const store = createMergeableStore() as unknown as Store;
  store.setRow("calendars", "live", { name: "Work", enabled: true });
  store.setRow("calendars", "off", { name: "Off", enabled: false });
  return store;
}

const event = (calendar_id: string, created_at: string, extra = {}) => ({
  calendar_id,
  created_at,
  tracking_id_event: "e1",
  started_at: "2026-11-10T08:00:00Z",
  title: "CIS 121",
  ...extra,
});

describe("pruneStaleCalendarEvents", () => {
  test("removes events whose calendar is gone, off, or missing", () => {
    const store = makeStore();
    store.setRow("events", "ok", event("live", "2026-11-01"));
    store.setRow("events", "orphan", event("deleted-calendar", "2026-11-02"));
    store.setRow("events", "off", event("off", "2026-11-02"));
    store.setRow("events", "none", { title: "x", tracking_id_event: "z" });

    expect(pruneStaleCalendarEvents(store)).toBe(3);
    expect(store.getRowIds("events")).toEqual(["ok"]);
  });

  test("keeps the oldest copy of a repeated event in one calendar", () => {
    const store = makeStore();
    store.setRow("events", "new", event("live", "2026-11-09"));
    store.setRow("events", "old", event("live", "2026-11-01"));

    expect(pruneStaleCalendarEvents(store)).toBe(1);
    expect(store.getRowIds("events")).toEqual(["old"]);
  });

  test("keeps different occurrences of the same recurring event", () => {
    const store = makeStore();
    store.setRow("events", "a", event("live", "2026-11-01"));
    store.setRow(
      "events",
      "b",
      event("live", "2026-11-01", { started_at: "2026-11-11T08:00:00Z" }),
    );

    expect(pruneStaleCalendarEvents(store)).toBe(0);
    expect(store.getRowIds("events").sort()).toEqual(["a", "b"]);
  });
});
