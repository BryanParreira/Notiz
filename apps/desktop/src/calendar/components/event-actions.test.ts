import { describe, expect, it } from "vitest";

import { friendlyCalendarError } from "./event-actions";

describe("friendlyCalendarError", () => {
  it("explains a missing event", () => {
    expect(friendlyCalendarError("event not found")).toMatch(
      /can't find that event/,
    );
  });

  it("explains missing calendar access", () => {
    expect(friendlyCalendarError("calendar access denied")).toMatch(
      /full Calendar access/,
    );
  });

  it("explains read-only calendars", () => {
    expect(
      friendlyCalendarError(
        "objective-c exception: Calendar doesn't allow modifications",
      ),
    ).toMatch(/read-only/);
  });

  it("passes through anything else", () => {
    expect(friendlyCalendarError("something odd")).toBe("something odd");
  });
});
