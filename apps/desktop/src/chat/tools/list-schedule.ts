import { tool } from "ai";
import { z } from "zod";

import { lenientInt } from "./lenient";
import type { ToolDependencies } from "./types";

const RANGES = [
  "today",
  "tomorrow",
  "this_week",
  "next_week",
  "next_7_days",
] as const;

type ScheduleRange = (typeof RANGES)[number];

// Models write "this week" or "Next 7 days" instead of the enum value. Read the
// intent rather than failing the call.
export function coerceScheduleRange(value: unknown): unknown {
  if (typeof value !== "string") return undefined;

  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if ((RANGES as readonly string[]).includes(key)) return key;
  if (key.includes("next") && key.includes("week")) return "next_week";
  if (key.includes("week")) return "this_week";
  if (key.includes("tomorrow")) return "tomorrow";
  if (key.includes("today") || key.includes("tonight")) return "today";
  return undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(startOfDay(date).getTime() + DAY_MS - 1);
}

// Weeks run Monday to Sunday, and "this week" starts from today so it lists
// what is still ahead rather than days that are over.
export function resolveScheduleRange(range: ScheduleRange, now = new Date()) {
  const today = startOfDay(now);
  const daysUntilSunday = (7 - today.getDay()) % 7;

  switch (range) {
    case "today":
      return { from: today, to: endOfDay(today) };
    case "tomorrow": {
      const tomorrow = new Date(today.getTime() + DAY_MS);
      return { from: tomorrow, to: endOfDay(tomorrow) };
    }
    case "this_week":
      return {
        from: today,
        to: endOfDay(new Date(today.getTime() + daysUntilSunday * DAY_MS)),
      };
    case "next_week": {
      const nextMonday = new Date(
        today.getTime() + (daysUntilSunday + 1) * DAY_MS,
      );
      return {
        from: nextMonday,
        to: endOfDay(new Date(nextMonday.getTime() + 6 * DAY_MS)),
      };
    }
    case "next_7_days":
      return {
        from: today,
        to: endOfDay(new Date(today.getTime() + 6 * DAY_MS)),
      };
  }
}

function describe(date: Date) {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const buildListScheduleTool = (deps: ToolDependencies) =>
  tool({
    description: `
List the user's calendar events for a time range, oldest first.
Use this for questions like "what do I have today", "what's on this week", "am I free tomorrow" or "what's my schedule".
Use search_calendar_events instead to find one specific event by name.
`.trim(),
    inputSchema: z.object({
      range: z
        .preprocess(coerceScheduleRange, z.enum(RANGES).optional())
        .describe("Which days to list. Defaults to next_7_days."),
      limit: lenientInt(1, 50).describe("Maximum number of events to return"),
    }),
    execute: async (params: { range?: ScheduleRange; limit?: number }) => {
      const range = params.range ?? "next_7_days";
      const { from, to } = resolveScheduleRange(range);
      const events = await deps.getCalendarEventSearchResults("", 500);

      const results = events
        .flatMap((event) => {
          const startMs = event.startedAt ? Date.parse(event.startedAt) : NaN;
          if (!Number.isFinite(startMs) || startMs < from.getTime()) return [];
          if (startMs > to.getTime()) return [];
          return [{ event, startMs }];
        })
        .sort((a, b) => a.startMs - b.startMs)
        .slice(0, params.limit ?? 25)
        .map(({ event, startMs }) => ({
          id: event.id,
          title: event.title,
          when: describe(new Date(startMs)),
          startedAt: event.startedAt,
          endedAt: event.endedAt,
          location: event.location,
          meetingLink: event.meetingLink,
          participantCount: event.participantCount,
        }));

      return {
        range,
        from: describe(from),
        to: describe(to),
        results,
        ...(results.length === 0
          ? { message: "No events are scheduled in this range." }
          : {}),
      };
    },
  });
