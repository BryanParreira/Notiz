import { describe, expect, it } from "vitest";

import { buildScheduleContext, rangeForMessage } from "./daily-context";

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();

const storeWith = (events: Record<string, Record<string, unknown>>) => ({
  getTable: () => events,
});

// Saturday, 24 Oct 2026, 5:46 PM.
const now = new Date(2026, 9, 24, 17, 46);

describe("rangeForMessage", () => {
  it("reads the days a question is about", () => {
    expect(rangeForMessage("what do i have this week?", now).label).toBe(
      "this week",
    );
    expect(rangeForMessage("anything next week", now).label).toBe("next week");
    expect(rangeForMessage("am i free tomorrow", now).label).toBe("tomorrow");
    expect(rangeForMessage("what's on today", now).label).toBe("today");
  });

  it("finds the next given weekday", () => {
    const range = rangeForMessage("what do i have on friday?", now);

    expect(range.from.getDate()).toBe(30);
    expect(range.label).toContain("Friday");
  });

  it("falls back to today and tomorrow", () => {
    const range = rangeForMessage("what's my schedule", now);

    expect(range.label).toBe("today and tomorrow");
    expect(range.from.getDate()).toBe(24);
    expect(range.to.getDate()).toBe(25);
  });
});

describe("buildScheduleContext", () => {
  it("lists events in the range, grouped by day in time order", () => {
    const text = buildScheduleContext(
      storeWith({
        b: { title: "Demo", started_at: at(25, 9), ended_at: at(25, 10) },
        a: {
          title: "Standup",
          started_at: at(24, 18),
          ended_at: at(24, 18, 30),
          location: "Room 2",
        },
        c: { title: "Offsite", started_at: at(30, 9) },
      }),
      rangeForMessage("what's my schedule", now),
      now,
    );

    expect(text).toContain("Saturday, October 24, 2026");
    expect(text).toContain("calendar for today and tomorrow");
    expect(text).toMatch(
      /Saturday, Oct 24:\n- 6:00 PM-6:30 PM Standup \(Room 2\)/,
    );
    expect(text).toMatch(/Sunday, Oct 25:\n- 9:00 AM-10:00 AM Demo/);
    expect(text).not.toContain("Offsite");
  });

  it("says plainly when nothing is scheduled and handles all-day events", () => {
    const empty = buildScheduleContext(
      storeWith({}),
      rangeForMessage("today", now),
      now,
    );
    expect(empty).toContain("Nothing is scheduled.");

    const allDay = buildScheduleContext(
      storeWith({
        a: { title: "Holiday", started_at: at(25, 0), is_all_day: true },
      }),
      rangeForMessage("tomorrow", now),
      now,
    );
    expect(allDay).toContain("All day: Holiday");
  });

  it("ignores events without a title or a valid start", () => {
    const text = buildScheduleContext(
      storeWith({
        a: { title: "", started_at: at(24, 18) },
        b: { title: "Bad", started_at: "not a date" },
      }),
      rangeForMessage("today", now),
      now,
    );

    expect(text).toContain("Nothing is scheduled.");
  });
});
