import { describe, expect, test } from "vitest";

import {
  buildTraySummary,
  collectTrayEvents,
  readIgnoredEvents,
} from "./tray-summary";

const at = (hour: number, minute = 0, dayOffset = 0) =>
  new Date(2026, 10, 23 + dayOffset, hour, minute, 0, 0);

const row = (
  title: string,
  start: Date,
  end: Date | null,
  extra: Record<string, unknown> = {},
) => ({
  title,
  started_at: start.toISOString(),
  ...(end ? { ended_at: end.toISOString() } : {}),
  ...extra,
});

const none = readIgnoredEvents(undefined, undefined);

describe("collectTrayEvents", () => {
  test("drops finished, all-day and tomorrow's events", () => {
    const events = {
      done: row("Done", at(8), at(9)),
      allDay: row("Holiday", at(0), at(23), { is_all_day: true }),
      tomorrow: row("Later", at(9, 0, 1), at(10, 0, 1)),
      live: row("Live", at(9), at(11)),
    };
    const result = collectTrayEvents(events, {}, none, at(10));
    expect(result.map((e) => e.title)).toEqual(["Live"]);
  });

  test("keeps a meeting that began yesterday and is still running", () => {
    const events = { late: row("Late call", at(23, 30, -1), at(0, 45)) };
    expect(collectTrayEvents(events, {}, none, at(0, 10))).toHaveLength(1);
  });

  test("assumes a short meeting when the end is missing", () => {
    const events = { open: row("No end", at(10), null) };
    expect(collectTrayEvents(events, {}, none, at(10, 10))).toHaveLength(1);
    expect(collectTrayEvents(events, {}, none, at(11))).toHaveLength(0);
  });

  test("skips ignored events and ignored series", () => {
    const ignored = readIgnoredEvents(
      JSON.stringify([{ tracking_id: "t1" }]),
      JSON.stringify([{ id: "s1" }]),
    );
    const events = {
      a: row("A", at(11), at(12), { tracking_id_event: "t1" }),
      b: row("B", at(11), at(12), { recurrence_series_id: "s1" }),
      c: row("C", at(11), at(12)),
    };
    expect(
      collectTrayEvents(events, {}, ignored, at(10)).map((e) => e.title),
    ).toEqual(["C"]);
  });

  test("merges the same meeting synced from two calendars", () => {
    const events = {
      a: row("Standup", at(11), at(12)),
      b: row("  standup ", at(11), at(12)),
    };
    expect(collectTrayEvents(events, {}, none, at(10))).toHaveLength(1);
  });
});

describe("buildTraySummary", () => {
  const build = (events: Record<string, unknown>[], now: Date) =>
    buildTraySummary(
      collectTrayEvents(
        Object.fromEntries(events.map((e, i) => [`e${i}`, e])),
        {},
        none,
        now,
      ),
      now,
      0,
    );

  test("counts down to an upcoming meeting inside the hour", () => {
    const summary = build([row("Review", at(11), at(12))], at(10, 30));
    expect(summary.title).toBe("Review · 30m");
    expect(summary.next?.label).toBe("Review · in 30m");
  });

  test("shows no title when the next meeting is more than an hour away", () => {
    const summary = build([row("Review", at(13), at(14))], at(10));
    expect(summary.title).toBeNull();
    expect(summary.next?.label).toBe("Review · in 3h 0m");
  });

  test("shows time left for a running meeting", () => {
    const summary = build([row("Review", at(10), at(11))], at(10, 20));
    expect(summary.title).toBe("Review · 40m left");
  });

  test("an all-afternoon block does not hide the next meeting", () => {
    const summary = build(
      [
        row("Focus block", at(9), at(17)),
        row("Design sync", at(11), at(11, 30)),
      ],
      at(10, 45),
    );
    expect(summary.next?.title).toBe("Design sync");
    expect(summary.title).toBe("Design sync · 15m");
  });

  test("a running meeting wins when it ends before the next begins", () => {
    const summary = build(
      [row("Planning", at(10), at(10, 30)), row("Lunch", at(12), at(13))],
      at(10, 10),
    );
    expect(summary.next?.title).toBe("Planning");
  });

  test("clears the title once everything is over", () => {
    const summary = build([row("Review", at(10), at(11))], at(11, 1));
    expect(summary.title).toBeNull();
    expect(summary.next).toBeNull();
    expect(summary.agenda).toEqual([]);
  });

  test("ends a meeting at its last minute", () => {
    const summary = build([row("Review", at(10), at(11))], at(10, 59, 0));
    expect(summary.title).toBe("Review · 1m left");
  });
});
