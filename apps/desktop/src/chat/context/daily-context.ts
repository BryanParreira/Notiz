import { resolveScheduleRange } from "../tools/list-schedule";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 30;

type EventRow = Record<string, unknown>;

type EventsStore = {
  getTable: (tableId: "events" | "calendars") => Record<string, EventRow>;
};

export type DayRange = {
  from: Date;
  to: Date;
  label: string;
  // When the days asked about are empty, also show what is coming up next.
  lookahead?: boolean;
};

const LOOKAHEAD_DAYS = 14;
const LOOKAHEAD_EVENTS = 8;

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

  if (
    /\b(upcoming|coming up|coming week|week ahead|next 7 days|next seven days)\b/.test(
      lower,
    )
  ) {
    return {
      ...resolveScheduleRange("next_7_days", now),
      label: "the next 7 days",
    };
  }
  if (/\bnext week\b/.test(lower)) {
    return { ...resolveScheduleRange("next_week", now), label: "next week" };
  }
  if (/\b(this week|rest of the week|the week|my week)\b/.test(lower)) {
    // On a weekend "this week" would be one or two days, and what people mean
    // is the week that is about to start.
    if (today.getDay() === 0 || today.getDay() === 6) {
      return {
        ...resolveScheduleRange("next_7_days", now),
        label: "the coming week",
      };
    }
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
    lookahead: true,
  };
}

function describeEvent(row: EventRow, start: Date) {
  const title = String(row.title);
  const where =
    typeof row.location === "string" && row.location.trim()
      ? ` (${row.location.trim()})`
      : "";

  return row.is_all_day === true
    ? `All day: ${title}${where}`
    : `${eventTime(row, start)} ${title}${where}`;
}

function eventTime(row: EventRow, start: Date) {
  if (row.is_all_day === true) return "All day";

  const end =
    typeof row.ended_at === "string" ? new Date(row.ended_at) : undefined;
  return end && !Number.isNaN(end.getTime()) && end > start
    ? `${time(start)}-${time(end)}`
    : time(start);
}

type Dated = { row: EventRow; start: Date };

function datedEvents(rows: EventRow[]): Dated[] {
  return rows.flatMap((row) => {
    if (typeof row.title !== "string" || !row.title.trim()) return [];
    if (typeof row.started_at !== "string") return [];
    const start = new Date(row.started_at);
    return Number.isNaN(start.getTime()) ? [] : [{ row, start }];
  });
}

// Which events a question is about. Only calendars the user has switched on
// count, the same ones the Calendar page shows (a calendar missing from the
// list is kept). If the days asked about are empty and look-ahead is allowed,
// it falls back to what is coming up next.
function selectEvents(store: EventsStore, range: DayRange) {
  const calendars = store.getTable("calendars") ?? {};
  const allRows = Object.values(store.getTable("events") ?? {}).filter(
    (row) => {
      const calendar =
        typeof row.calendar_id === "string"
          ? calendars[row.calendar_id]
          : undefined;
      return !calendar || calendar.enabled !== false;
    },
  );
  const dated = datedEvents(allRows).sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  const inRange = dated.filter(
    ({ start }) =>
      start.getTime() >= range.from.getTime() &&
      start.getTime() <= range.to.getTime(),
  );
  if (inRange.length > 0 || !range.lookahead) {
    return { events: inRange, upcoming: false, synced: allRows.length > 0 };
  }

  const horizon = range.to.getTime() + LOOKAHEAD_DAYS * DAY_MS;
  const upcoming = dated
    .filter(
      ({ start }) =>
        start.getTime() > range.to.getTime() && start.getTime() <= horizon,
    )
    .slice(0, LOOKAHEAD_EVENTS);

  return { events: upcoming, upcoming: true, synced: allRows.length > 0 };
}

export type AgendaDay = {
  label: string;
  events: Array<{ title: string; time: string; location?: string }>;
};

// The same events as a structure, for the app to draw as a card under the
// assistant's answer.
export function buildAgenda(store: EventsStore, range: DayRange): AgendaDay[] {
  const { events } = selectEvents(store, range);
  const days: AgendaDay[] = [];

  for (const { row, start } of events.slice(0, MAX_EVENTS)) {
    const label = dayLabel(start);
    let day = days[days.length - 1];
    if (!day || day.label !== label) {
      day = { label, events: [] };
      days.push(day);
    }
    day.events.push({
      title: String(row.title),
      time: eventTime(row, start),
      ...(typeof row.location === "string" && row.location.trim()
        ? { location: row.location.trim() }
        : {}),
    });
  }

  return days;
}

// The calendar for the days a question is about, written for the model to read.
// The app fetches it, so a small model never has to call a tool to see it.
export function buildScheduleContext(
  store: EventsStore,
  range: DayRange,
  now = new Date(),
  listShownByApp = false,
): string {
  const { events, upcoming, synced } = selectEvents(store, range);

  const nowText = now.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const header = `It is ${nowText}. The user's calendar for ${range.label}:`;

  if (!synced) {
    return `${header}\nNo calendar events are synced yet. If the user has a calendar, they can connect it from the Calendar page.`;
  }
  if (events.length === 0) return `${header}\nNothing is scheduled.`;

  // When the app draws the agenda itself, the model only gets a digest. Given the
  // full list it copies it out line by line, which is slow and adds nothing.
  if (listShownByApp) {
    const days = buildAgenda(store, range);
    const digest = days.map((day) => {
      const first = day.events[0]?.time.split("-")[0];
      const count = day.events.length;
      return `- ${day.label}: ${count} event${count === 1 ? "" : "s"}${first ? `, first at ${first}` : ""}`;
    });
    const names = [
      ...new Set(days.flatMap((day) => day.events.map((event) => event.title))),
    ].join(", ");

    return [
      header,
      ...(upcoming
        ? [`Nothing is scheduled ${range.label}. Coming up next:`]
        : []),
      digest.join("\n"),
      `In total: ${days.reduce((sum, day) => sum + day.events.length, 0)} events across ${days.length} day${days.length === 1 ? "" : "s"} (${days.map((day) => day.label.split(",")[0]).join(", ")}).`,
      `Event names: ${names}.`,
      "The app shows the full schedule as an agenda card under your reply, so do not list the events. Reply in one or two sentences: what stands out (the busiest day, an early start, a free stretch) and one useful next step.",
    ].join("\n");
  }

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

  return [
    header,
    ...(upcoming
      ? [`Nothing is scheduled ${range.label}. Coming up next:`]
      : []),
    lines.join("\n"),
  ].join("\n");
}
