import { addDays, format, isSameDay, parseISO, startOfDay } from "date-fns";

const TITLE_MAX = 24;
const TITLE_WINDOW_MIN = 60;
const DEFAULT_DURATION_MS = 30 * 60_000;

export type TrayEventItem = {
  id: string;
  title: string;
  label: string;
  start: string;
  end: string;
  color: string | null;
  join_url: string | null;
};

export type TraySummaryPayload = {
  title: string | null;
  next: TrayEventItem | null;
  agenda: TrayEventItem[];
  unread: number;
};

type Row = Record<string, unknown>;

type Candidate = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color: string | null;
  joinUrl: string | null;
};

export type IgnoredEvents = {
  eventIds: Set<string>;
  seriesIds: Set<string>;
};

function parse(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function countdown(minutes: number) {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function remaining(minutes: number) {
  return minutes < 1 ? "ending" : `${countdown(minutes)} left`;
}

function truncate(text: string) {
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
}

export function readIgnoredEvents(
  rawEvents: unknown,
  rawSeries: unknown,
): IgnoredEvents {
  const eventIds = new Set<string>();
  const seriesIds = new Set<string>();

  try {
    if (typeof rawEvents === "string" && rawEvents) {
      for (const item of JSON.parse(rawEvents) as { tracking_id?: string }[]) {
        if (item.tracking_id) eventIds.add(item.tracking_id);
      }
    }
  } catch {}

  try {
    if (typeof rawSeries === "string" && rawSeries) {
      for (const item of JSON.parse(rawSeries) as { id?: string }[]) {
        if (item.id) seriesIds.add(item.id);
      }
    }
  } catch {}

  return { eventIds, seriesIds };
}

/** Timed events still relevant today, with ignored ones and duplicates removed. */
export function collectTrayEvents(
  events: Record<string, Row>,
  calendars: Record<string, Row>,
  ignored: IgnoredEvents,
  now: Date,
): Candidate[] {
  const endOfToday = startOfDay(addDays(now, 1));
  const candidates: Candidate[] = [];

  for (const [id, row] of Object.entries(events)) {
    if (row.is_all_day) continue;

    const start = parse(row.started_at);
    if (!start) continue;
    // A missing end would hide the event the moment it began, so assume a
    // short meeting instead of dropping it.
    const end =
      parse(row.ended_at) ?? new Date(start.getTime() + DEFAULT_DURATION_MS);

    // Keeps meetings that began yesterday and run past midnight, and drops
    // anything that already finished or starts tomorrow.
    if (end <= now || start >= endOfToday) continue;

    const trackingId = row.tracking_id_event;
    const seriesId = row.recurrence_series_id;
    if (typeof trackingId === "string" && ignored.eventIds.has(trackingId)) {
      continue;
    }
    if (typeof seriesId === "string" && ignored.seriesIds.has(seriesId)) {
      continue;
    }

    const calendarId = row.calendar_id;
    candidates.push({
      id,
      title: String(row.title || "Untitled event"),
      start,
      end,
      color:
        (typeof calendarId === "string" &&
          (calendars[calendarId]?.color as string | undefined)) ||
        null,
      joinUrl:
        typeof row.meeting_link === "string" && row.meeting_link
          ? row.meeting_link
          : null,
    });
  }

  candidates.sort((a, b) => a.start.getTime() - b.start.getTime());

  // One meeting synced from several calendars is one entry.
  const seen = new Set<string>();
  return candidates.filter((event) => {
    const key = `${event.start.getTime()}-${event.title.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The event to feature is whichever one changes state soonest: a running
 * meeting counts by when it ends, an upcoming one by when it starts. That way
 * an all-afternoon block never hides the meeting about to begin.
 */
function pickFeatured(events: Candidate[], now: Date): Candidate | undefined {
  let best: Candidate | undefined;
  let bestKey = Infinity;
  let bestRunning = false;

  for (const event of events) {
    const running = event.start <= now;
    const key = (running ? event.end : event.start).getTime();
    if (key < bestKey || (key === bestKey && running && !bestRunning)) {
      best = event;
      bestKey = key;
      bestRunning = running;
    }
  }
  return best;
}

export function buildTraySummary(
  events: Candidate[],
  now: Date,
  unread: number,
): TraySummaryPayload {
  const first = pickFeatured(events, now);

  const minutesAway = first
    ? Math.ceil((first.start.getTime() - now.getTime()) / 60_000)
    : null;
  const minutesLeft = first
    ? Math.max(0, Math.ceil((first.end.getTime() - now.getTime()) / 60_000))
    : null;
  const inProgress = !!first && first.start <= now;

  const nextLabel = first
    ? inProgress
      ? `${first.title} · ${remaining(minutesLeft ?? 0)}`
      : `${first.title} · in ${countdown(minutesAway ?? 0)}`
    : null;

  const title =
    first && (inProgress || (minutesAway ?? Infinity) <= TITLE_WINDOW_MIN)
      ? `${truncate(first.title)} · ${
          inProgress ? remaining(minutesLeft ?? 0) : countdown(minutesAway ?? 0)
        }`
      : null;

  const toItem = (event: Candidate, label: string): TrayEventItem => ({
    id: event.id,
    title: event.title,
    label,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    color: event.color,
    join_url: event.joinUrl,
  });

  return {
    title,
    next: first && nextLabel ? toItem(first, nextLabel) : null,
    agenda: events
      .filter((event) => isSameDay(event.start, now) || event.start <= now)
      .map((event) =>
        toItem(
          event,
          event.start <= now
            ? `${event.title} · ${remaining(
                Math.max(
                  0,
                  Math.ceil((event.end.getTime() - now.getTime()) / 60_000),
                ),
              )}`
            : `${format(event.start, "h:mm a")}  ${event.title}`,
        ),
      ),
    unread,
  };
}
