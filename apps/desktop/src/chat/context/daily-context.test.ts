import { describe, expect, it } from "vitest";

import {
  buildAgenda,
  buildScheduleContext,
  rangeForMessage,
} from "./daily-context";

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();

const storeWith = (
  events: Record<string, Record<string, unknown>>,
  calendars: Record<string, Record<string, unknown>> = {},
) => ({
  getTable: (tableId: "events" | "calendars") =>
    tableId === "events" ? events : calendars,
});

// Saturday, 24 Oct 2026, 5:46 PM.
const now = new Date(2026, 9, 24, 17, 46);

describe("rangeForMessage", () => {
  it("reads the days a question is about", () => {
    expect(rangeForMessage("anything next week", now).label).toBe("next week");
    expect(rangeForMessage("am i free tomorrow", now).label).toBe("tomorrow");
    expect(rangeForMessage("what's on today", now).label).toBe("today");
  });

  it("reads 'upcoming week' as the next seven days", () => {
    const range = rangeForMessage(
      "what do i have to do this upcoming week?",
      now,
    );

    expect(range.label).toBe("the next 7 days");
    expect(range.from.getDate()).toBe(24);
    expect(range.to.getDate()).toBe(30);
  });

  it("treats 'this week' on a weekend as the week about to start", () => {
    const range = rangeForMessage("what do i have this week?", now);

    expect(range.label).toBe("the coming week");
    expect(range.to.getDate()).toBe(30);
  });

  it("keeps 'this week' as the rest of the week on a weekday", () => {
    const wednesday = new Date(2026, 9, 28, 9);

    expect(rangeForMessage("this week", wednesday).label).toBe("this week");
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
    expect(empty).toContain("No calendar events are synced yet");

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

  it("skips events from calendars the user has switched off", () => {
    const text = buildScheduleContext(
      storeWith(
        {
          a: { title: "Class", started_at: at(25, 9), calendar_id: "on" },
          b: { title: "Birthday", started_at: at(25, 10), calendar_id: "off" },
        },
        { on: { enabled: true }, off: { enabled: false } },
      ),
      rangeForMessage("tomorrow", now),
      now,
    );

    expect(text).toContain("Class");
    expect(text).not.toContain("Birthday");
  });

  it("tells the assistant when no calendar is synced at all", () => {
    const text = buildScheduleContext(
      storeWith({}),
      rangeForMessage("today", now),
      now,
    );

    expect(text).toContain("No calendar events are synced yet");
  });

  it("shows what is coming up when today and tomorrow are empty", () => {
    const text = buildScheduleContext(
      storeWith({
        a: { title: "CIS 121", started_at: at(26, 8), ended_at: at(26, 9) },
        b: { title: "Far away", started_at: at(30, 8) },
        c: {
          title: "Months away",
          started_at: new Date(2027, 2, 1).toISOString(),
        },
      }),
      rangeForMessage("check my calendar", now),
      now,
    );

    expect(text).toContain(
      "Nothing is scheduled today and tomorrow. Coming up next:",
    );
    expect(text).toContain("CIS 121");
    expect(text).toContain("Far away");
    expect(text).not.toContain("Months away");
  });

  it("does not look ahead when a specific day was asked about", () => {
    const text = buildScheduleContext(
      storeWith({ a: { title: "CIS 121", started_at: at(26, 8) } }),
      rangeForMessage("what do i have tomorrow", now),
      now,
    );

    expect(text).toContain("Nothing is scheduled.");
    expect(text).not.toContain("CIS 121");
  });
});

describe("buildAgenda", () => {
  const events = {
    a: { title: "CIS 121", started_at: at(26, 8), ended_at: at(26, 9, 50) },
    b: { title: "Gym", started_at: at(26, 17), location: "Rec centre" },
    c: { title: "MATH 115", started_at: at(27, 14), ended_at: at(27, 14, 50) },
    d: { title: "Elsewhere", started_at: at(28, 9), calendar_id: "off" },
  };

  it("groups events by day in time order, as the card needs them", () => {
    const days = buildAgenda(
      storeWith(events, { off: { enabled: false } }),
      rangeForMessage("what do i have this upcoming week", now),
    );

    expect(days.map((day) => day.label)).toEqual([
      "Monday, Oct 26",
      "Tuesday, Oct 27",
    ]);
    expect(days[0].events).toEqual([
      { title: "CIS 121", time: "8:00 AM-9:50 AM" },
      { title: "Gym", time: "5:00 PM", location: "Rec centre" },
    ]);
  });

  it("is empty when nothing is scheduled", () => {
    expect(buildAgenda(storeWith({}), rangeForMessage("today", now))).toEqual(
      [],
    );
  });

  it("tells the model the app draws the list, when asked to", () => {
    const text = buildScheduleContext(
      storeWith(events),
      rangeForMessage("this upcoming week", now),
      now,
      true,
    );

    expect(text).toContain("agenda card under your reply");
    expect(text).toContain("Monday, Oct 26: 2 events, first at 8:00 AM");
    expect(text).toContain(
      "In total: 4 events across 3 days (Monday, Tuesday, Wednesday).",
    );
    expect(text).toContain("Event names: CIS 121, Gym, MATH 115, Elsewhere");
    expect(text).not.toContain("- 8:00 AM-9:50 AM CIS 121");
  });
});
