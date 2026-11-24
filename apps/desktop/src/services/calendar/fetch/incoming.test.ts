import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Ctx } from "../ctx";
import { fetchIncomingEvents } from "./incoming";

const { listEvents } = vi.hoisted(() => ({ listEvents: vi.fn() }));

vi.mock("@notiz/plugin-calendar", () => ({
  commands: { listEvents, parseMeetingLink: vi.fn(async () => null) },
}));

const event = (id: string, calendar: string) => ({
  id,
  calendar_id: calendar,
  title: id,
  started_at: "2026-11-23T10:00:00Z",
  ended_at: "2026-11-23T11:00:00Z",
  description: null,
  location: null,
  meeting_link: null,
  organizer: null,
  attendees: [],
  recurring_event_id: null,
  has_recurrence_rules: false,
  is_all_day: false,
  status: "confirmed",
});

const ctxWith = (...trackingIds: string[]) =>
  ({
    provider: "apple",
    connectionId: "c1",
    from: new Date("2026-11-17T00:00:00Z"),
    to: new Date("2026-11-25T00:00:00Z"),
    calendarTrackingIdToId: new Map(trackingIds.map((id) => [id, `row-${id}`])),
  }) as unknown as Ctx;

describe("fetchIncomingEvents", () => {
  beforeEach(() => {
    listEvents.mockReset();
  });

  test("one unreadable calendar does not block the others", async () => {
    listEvents.mockImplementation(async (_p, _c, { calendar_tracking_id }) =>
      calendar_tracking_id === "bad"
        ? { status: "error", error: "offline" }
        : { status: "ok", data: [event("e1", "good")] },
    );

    const result = await fetchIncomingEvents(ctxWith("good", "bad"));

    expect(result.events.map((e) => e.tracking_id_event)).toEqual(["e1"]);
    expect(result.failedCalendarTrackingIds).toEqual(["bad"]);
  });

  test("throws when no calendar could be read", async () => {
    listEvents.mockResolvedValue({ status: "error", error: "offline" });

    await expect(fetchIncomingEvents(ctxWith("a", "b"))).rejects.toThrow(
      /offline/,
    );
  });

  test("cancelled meetings are not synced", async () => {
    listEvents.mockResolvedValue({
      status: "ok",
      data: [
        event("keep", "cal"),
        { ...event("gone", "cal"), status: "cancelled" },
      ],
    });

    const result = await fetchIncomingEvents(ctxWith("cal"));

    expect(result.events.map((e) => e.tracking_id_event)).toEqual(["keep"]);
  });
});
