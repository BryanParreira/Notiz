import { tool } from "ai";
import { z } from "zod";

import { commands as calendarCommands } from "@notiz/plugin-calendar";

import { resolveDay, resolveTimeOfDay } from "./event-time";
import { lenientBoolean, lenientInt } from "./lenient";
import type { ToolDependencies } from "./types";

import { usePendingEditStore } from "~/chat/tools/pending-edit-store";
import { id } from "~/shared/utils";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// A model writes a time many ways. ISO 8601 is the aim; a missing offset means
// the user's local time, which is what "tomorrow at 3pm" means to them.
export function parseEventTime(text: string): Date | null {
  const value = text.trim();
  if (!value) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  const local =
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (local) {
    const [, y, m, d, h, min, sec] = local;
    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(h),
      Number(min),
      Number(sec ?? 0),
    );
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Small models fill optional fields with "None", "null" or a guess. Those are
// treated as not given.
export function cleanOptional(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return /^(none|null|n\/a|na|undefined|unknown|-)$/i.test(text)
    ? undefined
    : text;
}

type CalendarRow = Record<string, unknown>;

const READ_ONLY_NAMES = /birthday|holiday|subscribed|siri/i;

// The Apple calendar to add to: the one the user named, otherwise the first
// switched-on calendar that looks writable (not Birthdays, Holidays, or a
// subscription, which macOS will not let anything be saved into).
export function pickAppleCalendar(
  calendars: Record<string, CalendarRow>,
  requestedName?: string,
): { trackingId: string; name: string } | null {
  const apple = Object.values(calendars).filter(
    (row) =>
      row.provider === "apple" &&
      row.enabled !== false &&
      typeof row.tracking_id_calendar === "string" &&
      row.tracking_id_calendar,
  );

  const wanted = requestedName?.trim().toLowerCase();
  const named = wanted
    ? (apple.find((row) => String(row.name ?? "").toLowerCase() === wanted) ??
      apple.find((row) =>
        String(row.name ?? "")
          .toLowerCase()
          .includes(wanted),
      ))
    : undefined;

  const chosen =
    named ??
    apple.find(
      (row) =>
        !READ_ONLY_NAMES.test(String(row.name ?? "")) &&
        !READ_ONLY_NAMES.test(String(row.source ?? "")),
    );

  return chosen
    ? {
        trackingId: String(chosen.tracking_id_calendar),
        name: String(chosen.name ?? "Calendar"),
      }
    : null;
}

function describeWhen(start: Date, end: Date, allDay: boolean) {
  const day = start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  if (allDay) return `${day}, all day`;

  const time = (date: Date) =>
    date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time(start)} to ${time(end)}`;
}

type EventResult = { status: string; message?: string; when?: string };

const RECENT_WINDOW_MS = 60_000;
const recentEvents = new Map<
  string,
  { at: number; result: Promise<EventResult> }
>();

export function resetRecentEvents() {
  recentEvents.clear();
}

export const buildCreateCalendarEventTool = (
  deps: Pick<ToolDependencies, "getStore" | "openEditTab">,
) =>
  tool({
    description: `
Add an event to the user's Apple Calendar. This opens a review that shows the event with its real date, and the user approves or declines it, so nothing is created until they approve.
Copy the day and time from the user's own words into "day" and "time" ("tomorrow", "friday", "next monday", "Oct 28"; "3pm", "noon"). Do not work out dates yourself; the app does. Leave "time" out only for an all-day event.
Only Apple Calendar can be written to. Existing events cannot be changed or deleted from here. Never tell the user an event was created unless this returns status "created". Call this once per event.
`.trim(),
    inputSchema: z.object({
      title: z.string().min(1).describe("The event title"),
      day: z
        .string()
        .optional()
        .describe(
          'The day, copied from the user\'s words: "today", "tomorrow", "friday", "next monday", "Oct 28" or 2026-10-28',
        ),
      time: z
        .string()
        .optional()
        .describe(
          'The start time, copied from the user\'s words: "3pm", "15:00", "noon". Leave out for an all-day event.',
        ),
      duration_minutes: lenientInt(5, 1440).describe(
        "How long it lasts, in minutes. Defaults to 60.",
      ),
      all_day: lenientBoolean().describe("True for an all-day event"),
      start: z
        .string()
        .optional()
        .describe("Only if day and time cannot be used: ISO 8601 date-time"),
      end: z.string().optional().describe("Only with start: ISO 8601 end"),
      location: z.string().optional().describe("Where it happens"),
      notes: z.string().optional().describe("Notes or a description"),
      calendar: z
        .string()
        .optional()
        .describe("Name of the Apple calendar. Leave out to use the main one."),
    }),
    execute: async (params: {
      title: string;
      day?: string;
      time?: string;
      duration_minutes?: number;
      start?: string;
      end?: string;
      all_day?: boolean;
      location?: string;
      notes?: string;
      calendar?: string;
    }): Promise<EventResult> => {
      const store = deps.getStore();
      if (!store) {
        return {
          status: "error",
          message: "The calendar is not available right now.",
        };
      }

      const dayText = cleanOptional(params.day);
      const timeText = cleanOptional(params.time);
      const startText = cleanOptional(params.start);

      let start: Date | null = null;
      let allDay = params.all_day === true;

      if (dayText) {
        const day = resolveDay(dayText);
        if (!day) {
          return {
            status: "error",
            message: `Could not work out which day "${dayText}" is. Ask the user which day.`,
          };
        }

        if (timeText && !allDay) {
          const time = resolveTimeOfDay(timeText);
          if (!time) {
            return {
              status: "error",
              message: `Could not read the time "${timeText}". Ask the user what time it starts.`,
            };
          }
          start = new Date(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            time.hours,
            time.minutes,
          );
        } else if (!timeText || allDay) {
          // A day with no time is an all-day event.
          allDay = true;
          start = day;
        }
      } else if (startText) {
        start = parseEventTime(startText);
        if (!start) {
          return {
            status: "error",
            message:
              "Could not read the start. Give a day and a time, such as day tomorrow and time 3pm.",
          };
        }
      } else {
        return {
          status: "error",
          message:
            "Say which day, and what time, the event is on. Ask the user if you do not know.",
        };
      }

      if (!start) {
        return {
          status: "error",
          message: "Could not work out when the event starts.",
        };
      }

      const explicitEnd = cleanOptional(params.end);
      const parsedEnd = explicitEnd ? parseEventTime(explicitEnd) : null;
      const minutes = params.duration_minutes ?? 60;
      const end = allDay
        ? new Date(
            new Date(
              start.getFullYear(),
              start.getMonth(),
              start.getDate(),
            ).getTime() + DAY_MS,
          )
        : parsedEnd && parsedEnd > start
          ? parsedEnd
          : new Date(start.getTime() + minutes * 60 * 1000);

      const location = cleanOptional(params.location);
      const notes = cleanOptional(params.notes);
      const calendar = pickAppleCalendar(
        store.getTable("calendars") as Record<string, CalendarRow>,
        cleanOptional(params.calendar),
      );
      if (!calendar) {
        return {
          status: "error",
          message:
            "No writable Apple Calendar is connected. Events can only be added to Apple Calendar, and it must be switched on in the Calendar page.",
        };
      }

      const when = describeWhen(start, end, allDay);
      // Same title at the same start is the same event, however the other
      // details were guessed, so a model repeating itself creates one event.
      const key = `${params.title.trim().toLowerCase()}|${start.toISOString()}`;
      const now = Date.now();
      for (const [other, entry] of recentEvents) {
        if (now - entry.at > RECENT_WINDOW_MS) recentEvents.delete(other);
      }
      const shared = recentEvents.get(key);
      if (shared) return shared.result;

      const outcome = (async (): Promise<EventResult> => {
        const proposal = [
          `**${params.title.trim()}**`,
          "",
          `When: ${when}`,
          `Calendar: ${calendar.name}`,
          ...(location ? [`Where: ${location}`] : []),
          ...(notes ? ["", notes] : []),
        ].join("\n");

        const requestId = id();
        const approved = await new Promise<boolean>((resolve) => {
          usePendingEditStore.getState().addEdit({
            requestId,
            sessionId: "",
            target: "event",
            currentContent: "",
            proposedContent: proposal,
            resolve,
          });
          deps.openEditTab(requestId);
        });

        if (!approved) {
          return {
            status: "declined",
            message: "The user declined. No event was created.",
          };
        }

        const result = await calendarCommands.createEvent("apple", {
          calendar_tracking_id: calendar.trackingId,
          title: params.title.trim(),
          started_at: start.toISOString(),
          ended_at: end.toISOString(),
          is_all_day: allDay,
          location: location ?? null,
          notes: notes ?? null,
          url: null,
        });

        if (result.status === "error") {
          return {
            status: "error",
            message: `Apple Calendar would not save the event: ${result.error}`,
          };
        }

        // No refresh needed: macOS reports the change and the app's calendar
        // sync picks the new event up straight away (and every minute anyway).
        return {
          status: "created",
          when,
          message: `Added "${params.title.trim()}" to the user's Apple Calendar (${when}). Tell them it was added.`,
        };
      })();

      recentEvents.set(key, { at: now, result: outcome });
      const result = await outcome;
      // Only a created event is remembered; a declined or failed one can be asked for again.
      if (result.status !== "created") recentEvents.delete(key);
      return result;
    },
  });
