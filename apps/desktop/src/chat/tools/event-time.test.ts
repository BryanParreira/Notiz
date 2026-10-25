import { describe, expect, it } from "vitest";

import { resolveDay, resolveTimeOfDay } from "./event-time";

// Sunday, 25 Oct 2026.
const sunday = new Date(2026, 9, 25, 17, 0);
// Wednesday, 28 Oct 2026.
const wednesday = new Date(2026, 9, 28, 9, 0);

const ymd = (date: Date | null) =>
  date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : null;

describe("resolveDay", () => {
  it("reads today, tomorrow and the day after", () => {
    expect(ymd(resolveDay("today", sunday))).toBe("2026-10-25");
    expect(ymd(resolveDay("tonight", sunday))).toBe("2026-10-25");
    expect(ymd(resolveDay("tomorrow", sunday))).toBe("2026-10-26");
    expect(ymd(resolveDay("the day after tomorrow", sunday))).toBe(
      "2026-10-27",
    );
  });

  it("finds the next given weekday, counting today", () => {
    expect(ymd(resolveDay("friday", sunday))).toBe("2026-10-30");
    expect(ymd(resolveDay("on Friday", sunday))).toBe("2026-10-30");
    expect(ymd(resolveDay("monday", sunday))).toBe("2026-10-26");
    expect(ymd(resolveDay("wed", wednesday))).toBe("2026-10-28");
    expect(ymd(resolveDay("fri", wednesday))).toBe("2026-10-30");
  });

  it("reads 'next <weekday>' as the week after this one", () => {
    expect(ymd(resolveDay("next monday", wednesday))).toBe("2026-11-02");
    expect(ymd(resolveDay("next friday", wednesday))).toBe("2026-11-06");
    // On a Sunday this week is over, so next Monday is tomorrow.
    expect(ymd(resolveDay("next monday", sunday))).toBe("2026-10-26");
  });

  it("reads written dates, rolling a past date into next year", () => {
    expect(ymd(resolveDay("2026-12-05", sunday))).toBe("2026-12-05");
    expect(ymd(resolveDay("Oct 28", sunday))).toBe("2026-10-28");
    expect(ymd(resolveDay("28th of October", sunday))).toBe("2026-10-28");
    expect(ymd(resolveDay("March 3", sunday))).toBe("2027-03-03");
  });

  it("does not mistake other words for a day", () => {
    expect(resolveDay("whenever", sunday)).toBeNull();
    expect(resolveDay("next month", sunday)).toBeNull();
    expect(resolveDay("", sunday)).toBeNull();
  });
});

describe("resolveTimeOfDay", () => {
  it("reads times with and without am/pm", () => {
    expect(resolveTimeOfDay("3pm")).toEqual({ hours: 15, minutes: 0 });
    expect(resolveTimeOfDay("3:30 PM")).toEqual({ hours: 15, minutes: 30 });
    expect(resolveTimeOfDay("10am")).toEqual({ hours: 10, minutes: 0 });
    expect(resolveTimeOfDay("12am")).toEqual({ hours: 0, minutes: 0 });
    expect(resolveTimeOfDay("12pm")).toEqual({ hours: 12, minutes: 0 });
    expect(resolveTimeOfDay("15:45")).toEqual({ hours: 15, minutes: 45 });
    expect(resolveTimeOfDay("at 9:00")).toEqual({ hours: 9, minutes: 0 });
  });

  it("reads noon and midnight", () => {
    expect(resolveTimeOfDay("noon")).toEqual({ hours: 12, minutes: 0 });
    expect(resolveTimeOfDay("midnight")).toEqual({ hours: 0, minutes: 0 });
  });

  it("assumes the afternoon for a bare small hour", () => {
    expect(resolveTimeOfDay("at 3")).toEqual({ hours: 15, minutes: 0 });
    expect(resolveTimeOfDay("9")).toEqual({ hours: 9, minutes: 0 });
  });

  it("rejects what it cannot read", () => {
    expect(resolveTimeOfDay("sometime")).toBeNull();
    expect(resolveTimeOfDay("")).toBeNull();
    expect(resolveTimeOfDay("99:99")).toBeNull();
  });
});
