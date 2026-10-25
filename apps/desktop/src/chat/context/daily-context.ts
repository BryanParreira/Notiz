import { resolveScheduleRange } from "../tools/list-schedule";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 30;

type EventRow = Record<string, unknown>;

type EventsStore = {
  getTable: (tableId: "events") => Record<string, EventRow>;
};

export type DayRange = { from: Date; to: Date; label: string };

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(startOfDay(date).getTime() + DAY_MS - 1);
}

function time(date: Date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

// Reads the days a question is about. Without any hint the answer covers today
// and tomorrow, which is what most "what's on" questions mean.
export function rangeForMessage(text: string, now = new Date()): DayRange {
  const lower = text.toLowerCase();
  const today = startOfDay(now);

  if (/\bnext week\b/.test(lower)) {
    return { ...resolveScheduleRange("next_week", now), label: "next week" };
  }
  if (/\b(this week|rest of the week|the week|my week)\b/.test(lower)) {
    return { ...resolveScheduleRange("this_week", now), label: "this week" };
  }

  const weekday = WEEKDAYS.findIndex((name) => lower.includes(name));
  if (weekday !== -1) {
    const ahead = (weekday - today.getDay() + 7) % 7;
    const day = new Date(today.getTime() + ahead * DAY_MS);
    return { from: day, to: endOfDay(day), label: dayLabel(day) };
  }

  if (/\btomorrow\b/.test(lower) && !/\btoday\b/.test(lower)) {
    return { ...resolveScheduleRange("tomorrow", now), label: "tomorrow" };
  }
  if (/\b(today|tonight)\b/.test(lower) && !/\btomorrow\b/.test(lower)) {
    return { ...resolveScheduleRange("today", now), label: "today" };
  }

  return {
    from: today,
    to: endOfDay(new Date(today.getTime() + DAY_MS)),
    label: "today and tomorrow",
  };
}

function describeEvent(row: EventRow, start: Date) {
  const title = String(row.title);
  const where =
    typeof row.location === "string" && row.location.trim()
      ? ` (${row.location.trim()})`
      : "";

  if (row.is_all_day === true) {
    return `All day: ${title}${where}`;
  }

  const end =
    typeof row.ended_at === "string" ? new Date(row.ended_at) : undefined;
  const span =
    end && !Number.isNaN(end.getTime()) && end > start
      ? `${time(start)}-${time(end)}`
      : time(start);
  return `${span} ${title}${where}`;
}

// The calendar for the days a question is about, written for the model to read.
// The app fetches it, so a small model never has to call a tool to see it.
export function buildScheduleContext(
  store: EventsStore,
  range: DayRange,
  now = new Date(),
): string {
  const events = Object.values(store.getTable("events") ?? {})
    .flatMap((row) => {
      if (typeof row.title !== "string" || !row.title.trim()) return [];
      if (typeof row.started_at !== "string") return [];
      const start = new Date(row.started_at);
      const startMs = start.getTime();
      if (
        Number.isNaN(startMs) ||
        startMs < range.from.getTime() ||
        startMs > range.to.getTime()
      ) {
        return [];
      }
      return [{ row, start }];
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const nowText = now.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const header = `It is ${nowText}. The user's calendar for ${range.label}:`;

  if (events.length === 0) return `${header}\nNothing is scheduled.`;

  const lines: string[] = [];
  let currentDay = "";
  for (const { row, start } of events.slice(0, MAX_EVENTS)) {
    const day = dayLabel(start);
    if (day !== currentDay) {
      currentDay = day;
      lines.push(`${day}:`);
    }
    lines.push(`- ${describeEvent(row, start)}`);
  }
  const more = events.length - MAX_EVENTS;
  if (more > 0) lines.push(`(and ${more} more)`);

  return `${header}\n${lines.join("\n")}`;
}
