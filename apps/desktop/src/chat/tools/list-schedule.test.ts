import { asSchema } from "ai";
import { describe, expect, it } from "vitest";

import {
  buildListScheduleTool,
  coerceScheduleRange,
  resolveScheduleRange,
} from "./list-schedule";
import {
  buildSearchSessionsTool,
  coerceSearchFilters,
} from "./search-sessions";
import type { ToolDependencies } from "./types";

// Saturday, 24 Oct 2026.
const saturday = new Date(2026, 9, 24, 15, 30);

describe("resolveScheduleRange", () => {
  it("runs this week from today to Sunday night", () => {
    const { from, to } = resolveScheduleRange("this_week", saturday);

    expect(from).toEqual(new Date(2026, 9, 24));
    expect(to.getDate()).toBe(25);
    expect(to.getHours()).toBe(23);
  });

  it("starts next week on Monday and ends the following Sunday", () => {
    const { from, to } = resolveScheduleRange("next_week", saturday);

    expect(from).toEqual(new Date(2026, 9, 26));
    expect(to.getMonth()).toBe(10);
    expect(to.getDate()).toBe(1);
  });

  it("covers a single day for today and tomorrow", () => {
    expect(resolveScheduleRange("today", saturday).to.getDate()).toBe(24);
    expect(resolveScheduleRange("tomorrow", saturday).from.getDate()).toBe(25);
  });
});

describe("list_schedule", () => {
  it("returns only events in range, soonest first", async () => {
    const event = (id: string, startedAt: string) => ({
      id,
      title: id,
      startedAt,
      endedAt: null,
      location: null,
      meetingLink: null,
      description: null,
      participantCount: 0,
      linkedSessionId: null,
    });
    const deps = {
      getCalendarEventSearchResults: async () => [
        event("later", new Date(2026, 9, 25, 10).toISOString()),
        event("outside", new Date(2026, 10, 20, 10).toISOString()),
        event("sooner", new Date(2026, 9, 24, 18).toISOString()),
      ],
    } as unknown as ToolDependencies;

    const result = (await buildListScheduleTool(deps).execute!(
      { range: "next_7_days" },
      {} as never,
    )) as { results: Array<{ id: string }> };

    expect(result.results.map((r) => r.id)).toEqual(["sooner", "later"]);
  });
});

describe("coerceSearchFilters", () => {
  it("repairs the string filter a small model sent", () => {
    expect(
      coerceSearchFilters("{'kind': 'relative', 'recent_days': 7}"),
    ).toEqual({ created_at: { kind: "relative", recent_days: 7 } });
  });

  it("wraps a filter that is missing created_at", () => {
    expect(coerceSearchFilters({ kind: "relative", recent_days: 3 })).toEqual({
      created_at: { kind: "relative", recent_days: 3 },
    });
  });

  it("drops filters it cannot read instead of failing", () => {
    expect(coerceSearchFilters("not json")).toBeUndefined();
    expect(coerceSearchFilters(42)).toBeUndefined();
  });

  it("accepts the exact input that failed in the app", async () => {
    const schema = buildSearchSessionsTool({} as ToolDependencies)
      .inputSchema as { safeParse: (v: unknown) => { success: boolean } };

    expect(
      schema.safeParse({
        query: "this week",
        filters: "{'kind': 'relative', 'recent_days': 7}",
      }).success,
    ).toBe(true);
  });

  it("still produces a JSON schema for the model", () => {
    const tool = buildSearchSessionsTool({} as ToolDependencies);
    const json = asSchema(tool.inputSchema).jsonSchema as {
      properties?: Record<string, unknown>;
    };

    expect(json.properties).toHaveProperty("filters");
  });
});

describe("coerceScheduleRange", () => {
  it("reads the range the model meant, however it is written", () => {
    expect(coerceScheduleRange("this week")).toBe("this_week");
    expect(coerceScheduleRange("This Week")).toBe("this_week");
    expect(coerceScheduleRange("next week")).toBe("next_week");
    expect(coerceScheduleRange("next 7 days")).toBe("next_7_days");
    expect(coerceScheduleRange("tomorrow")).toBe("tomorrow");
    expect(coerceScheduleRange("tonight")).toBe("today");
    expect(coerceScheduleRange("whenever")).toBeUndefined();
    expect(coerceScheduleRange(7)).toBeUndefined();
  });
});
