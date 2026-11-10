import { describe, expect, test } from "vitest";

import { resolveCalendarColor } from "./calendar-color";

describe("resolveCalendarColor", () => {
  test("keeps a real colour", () => {
    expect(resolveCalendarColor("rgb(10, 20, 30)", "a")).toBe(
      "rgb(10, 20, 30)",
    );
  });

  test("replaces missing or placeholder colours with a stable palette colour", () => {
    const first = resolveCalendarColor("", "calendar-1");
    expect(first).toMatch(/^#/);
    expect(resolveCalendarColor(null, "calendar-1")).toBe(first);
    expect(resolveCalendarColor("#888", "calendar-1")).toBe(first);
  });

  test("different calendars can get different colours", () => {
    const colors = new Set(
      ["a", "b", "c", "d", "e", "f"].map((k) => resolveCalendarColor("", k)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
