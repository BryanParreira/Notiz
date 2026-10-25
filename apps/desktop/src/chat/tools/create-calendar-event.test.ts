import { createStore } from "tinybase";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createEvent } = vi.hoisted(() => ({ createEvent: vi.fn() }));

vi.mock("@notiz/plugin-calendar", () => ({
  commands: { createEvent },
}));

import {
  buildCreateCalendarEventTool,
  cleanOptional,
  parseEventTime,
  pickAppleCalendar,
  resetRecentEvents,
} from "./create-calendar-event";
import { usePendingEditStore } from "./pending-edit-store";

const calendars = {
  birthdays: {
    provider: "apple",
    enabled: true,
    name: "Birthdays",
    source: "Other",
    tracking_id_calendar: "cal-birthdays",
  },
  work: {
    provider: "apple",
    enabled: true,
    name: "Work",
    source: "iCloud",
    tracking_id_calendar: "cal-work",
  },
  home: {
    provider: "apple",
    enabled: true,
    name: "Home",
    source: "iCloud",
    tracking_id_calendar: "cal-home",
  },
  off: {
    provider: "apple",
    enabled: false,
    name: "Off",
    source: "iCloud",
    tracking_id_calendar: "cal-off",
  },
  google: {
    provider: "google",
    enabled: true,
    name: "Gmail",
    source: "Google",
    tracking_id_calendar: "cal-google",
  },
};

function setup(rows: Record<string, Record<string, unknown>> = calendars) {
  const store = createStore();
  for (const [rowId, row] of Object.entries(rows)) {
    store.setRow("calendars", rowId, row as never);
  }

  const reviews: string[] = [];
  const decide = { approve: true };
  const tool = buildCreateCalendarEventTool({
    getStore: () => store as never,
    openEditTab: (requestId: string) => {
      reviews.push(
        usePendingEditStore.getState().edits.get(requestId)!.proposedContent,
      );
      queueMicrotask(() =>
        usePendingEditStore.getState().resolveEdit(requestId, decide.approve),
      );
    },
  });

  const run = (input: object) =>
    tool.execute!(input as never, {} as never) as Promise<{
      status: string;
      message?: string;
      when?: string;
    }>;

  return { run, reviews, decide };
}

describe("parseEventTime", () => {
  it("reads ISO times, local times and plain dates", () => {
    expect(parseEventTime("2026-10-28T15:00")).toEqual(
      new Date(2026, 9, 28, 15, 0),
    );
    expect(parseEventTime("2026-10-28 15:30")).toEqual(
      new Date(2026, 9, 28, 15, 30),
    );
    expect(parseEventTime("2026-10-28")).toEqual(new Date(2026, 9, 28));
    expect(parseEventTime("2026-10-28T15:00:00Z")?.toISOString()).toBe(
      "2026-10-28T15:00:00.000Z",
    );
  });

  it("returns null for text it cannot read", () => {
    expect(parseEventTime("sometime soon")).toBeNull();
    expect(parseEventTime("")).toBeNull();
  });
});

describe("pickAppleCalendar", () => {
  it("skips read-only, switched-off and non-Apple calendars", () => {
    expect(pickAppleCalendar(calendars as never)?.name).toBe("Work");
  });

  it("uses the calendar the user named", () => {
    expect(pickAppleCalendar(calendars as never, "home")?.trackingId).toBe(
      "cal-home",
    );
    expect(pickAppleCalendar(calendars as never, "off")?.name).toBe("Work");
  });

  it("finds nothing when there is no writable Apple calendar", () => {
    expect(pickAppleCalendar({ google: calendars.google } as never)).toBeNull();
  });
});

describe("create_calendar_event", () => {
  beforeEach(() => {
    usePendingEditStore.setState({ edits: new Map() });
    resetRecentEvents();
    createEvent.mockReset();
    createEvent.mockResolvedValue({ status: "ok", data: "event-id" });
  });

  it("works out the date in code from the words the model copied", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 25, 17, 0)); // Sunday
    try {
      const { run, reviews } = setup();

      const result = await run({
        title: "Study session",
        day: "tomorrow",
        time: "3pm",
        duration_minutes: 90,
      });

      expect(result.status).toBe("created");
      expect(result.when).toContain("Monday, October 26");
      expect(reviews[0]).toContain("Monday, October 26, 3:00 PM to 4:30 PM");
      expect(createEvent.mock.calls[0][1]).toMatchObject({
        started_at: new Date(2026, 9, 26, 15, 0).toISOString(),
        ended_at: new Date(2026, 9, 26, 16, 30).toISOString(),
      });

      createEvent.mockClear();
      await run({ title: "Lunch", day: "on Friday", time: "noon" });
      expect(createEvent.mock.calls[0][1].started_at).toBe(
        new Date(2026, 9, 30, 12, 0).toISOString(),
      );

      createEvent.mockClear();
      await run({ title: "Call Sam", day: "next monday", time: "10am" });
      expect(createEvent.mock.calls[0][1].started_at).toBe(
        new Date(2026, 9, 26, 10, 0).toISOString(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes a day with no time an all-day event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 25, 17, 0));
    try {
      const { run } = setup();

      await run({ title: "Day off", day: "friday" });

      expect(createEvent.mock.calls[0][1]).toMatchObject({
        is_all_day: true,
        started_at: new Date(2026, 9, 30).toISOString(),
        ended_at: new Date(2026, 9, 31).toISOString(),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for what it cannot work out instead of guessing", async () => {
    const { run, reviews } = setup();

    expect(
      (await run({ title: "x", day: "whenever", time: "3pm" })).message,
    ).toMatch(/which day/);
    expect(
      (await run({ title: "x", day: "friday", time: "sometime" })).message,
    ).toMatch(/what time/);
    expect((await run({ title: "x" })).message).toMatch(/which day/);
    expect(reviews).toHaveLength(0);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("creates the event in Apple Calendar once the user approves", async () => {
    const { run, reviews } = setup();

    const result = await run({
      title: "Study session",
      start: "2026-10-28T15:00",
      end: "2026-10-28T16:30",
      location: "Library",
    });

    expect(result.status).toBe("created");
    expect(reviews[0]).toContain("**Study session**");
    expect(reviews[0]).toContain("Library");
    expect(createEvent).toHaveBeenCalledWith(
      "apple",
      expect.objectContaining({
        calendar_tracking_id: "cal-work",
        title: "Study session",
        started_at: new Date(2026, 9, 28, 15, 0).toISOString(),
        ended_at: new Date(2026, 9, 28, 16, 30).toISOString(),
        is_all_day: false,
        location: "Library",
      }),
    );
  });

  it("defaults to an hour, and handles all-day events", async () => {
    const { run } = setup();

    await run({ title: "Call", start: "2026-10-28T09:00" });
    expect(createEvent.mock.calls[0][1].ended_at).toBe(
      new Date(2026, 9, 28, 10, 0).toISOString(),
    );

    createEvent.mockClear();
    await run({ title: "Holiday", start: "2026-10-29", all_day: true });
    expect(createEvent.mock.calls[0][1]).toMatchObject({
      is_all_day: true,
      started_at: new Date(2026, 9, 29).toISOString(),
      ended_at: new Date(2026, 9, 30).toISOString(),
    });
  });

  it("accepts the text values a small model sends for yes and no", () => {
    const tool = buildCreateCalendarEventTool({
      getStore: () => undefined,
      openEditTab: () => {},
    });
    const schema = tool.inputSchema as {
      safeParse: (v: unknown) => {
        success: boolean;
        data?: { all_day?: boolean };
      };
    };

    const parsed = schema.safeParse({
      title: "Holiday",
      start: "2026-10-29",
      all_day: "true",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.all_day).toBe(true);
  });

  it("creates nothing when the user declines", async () => {
    const { run, decide } = setup();
    decide.approve = false;

    const result = await run({ title: "Nope", start: "2026-10-28T15:00" });

    expect(result.status).toBe("declined");
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("explains problems instead of failing silently", async () => {
    const noCalendar = setup({ google: calendars.google });
    expect(
      (await noCalendar.run({ title: "x", start: "2026-10-28T15:00" })).message,
    ).toMatch(/Apple Calendar/);
    expect(noCalendar.reviews).toHaveLength(0);

    const { run } = setup();
    expect((await run({ title: "x", start: "tomorrow-ish" })).message).toMatch(
      /day and a time/,
    );

    createEvent.mockResolvedValue({ status: "error", error: "read only" });
    const failed = await run({ title: "x", start: "2026-10-28T15:00" });
    expect(failed.status).toBe("error");
    expect(failed.message).toContain("read only");
  });

  it("ignores the junk a model puts in optional fields", async () => {
    const { run, reviews } = setup();

    await run({
      title: "Lunch",
      start: "2026-10-28T12:00",
      location: "None",
      notes: "null",
      calendar: "main",
    });

    expect(createEvent.mock.calls[0][1]).toMatchObject({
      calendar_tracking_id: "cal-work",
      location: null,
      notes: null,
    });
    expect(reviews[0]).not.toContain("None");
    expect(cleanOptional(" N/A ")).toBeUndefined();
    expect(cleanOptional("Library")).toBe("Library");
  });

  it("treats the same title and start as one event whatever else it guessed", async () => {
    const { run } = setup();

    const results = await Promise.all([
      run({ title: "Study session", start: "2026-10-26T15:00" }),
      run({
        title: "Study session",
        start: "2026-10-26T15:00",
        end: "2026-10-26T16:00",
      }),
      run({ title: "Study session", start: "2026-10-26T15:00", all_day: true }),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "created",
      "created",
      "created",
    ]);
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it("creates one event when the model sends the same call twice", async () => {
    const { run } = setup();
    const input = { title: "Lunch", start: "2026-10-28T12:00" };

    const [first, second] = await Promise.all([run(input), run(input)]);

    expect(first.status).toBe("created");
    expect(second.status).toBe("created");
    expect(createEvent).toHaveBeenCalledTimes(1);
  });
});
