import { describe, expect, it } from "vitest";

import { buildDailyContext } from "./daily-context";

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();

const storeWith = (events: Record<string, Record<string, unknown>>) => ({
  getTable: () => events,
});

// Saturday, 24 Oct 2026, 5:46 PM.
const now = new Date(2026, 9, 24, 17, 46);

describe("buildDailyContext", () => {
  it("lists today's and tomorrow's events in time order", () => {
    const text = buildDailyContext(
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
      now,
    );

    expect(text).toContain("Saturday, October 24, 2026");
    expect(text).toMatch(/Today:\n- 6:00 PM-6:30 PM Standup \(Room 2\)/);
    expect(text).toMatch(/Tomorrow:\n- 9:00 AM-10:00 AM Demo/);
    expect(text).not.toContain("Offsite");
  });

  it("says when nothing is scheduled and handles all-day events", () => {
    const text = buildDailyContext(
      storeWith({
        a: {
          title: "Holiday",
          started_at: at(25, 0),
          is_all_day: true,
        },
      }),
      now,
    );

    expect(text).toContain("Today: nothing scheduled.");
    expect(text).toContain("All day: Holiday");
  });

  it("ignores events without a title or a valid start", () => {
    const text = buildDailyContext(
      storeWith({
        a: { title: "", started_at: at(24, 18) },
        b: { title: "Bad", started_at: "not a date" },
      }),
      now,
    );

    expect(text).toContain("Today: nothing scheduled.");
  });
});
