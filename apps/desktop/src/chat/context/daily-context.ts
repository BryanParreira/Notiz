const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_DAY = 8;

type EventRow = Record<string, unknown>;

type EventsStore = {
  getTable: (tableId: "events") => Record<string, EventRow>;
};

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function time(date: Date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
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

function listDay(rows: EventRow[], from: Date, label: string) {
  const to = from.getTime() + DAY_MS;

  const events = rows
    .flatMap((row) => {
      if (typeof row.title !== "string" || !row.title.trim()) return [];
      if (typeof row.started_at !== "string") return [];
      const start = new Date(row.started_at);
      const startMs = start.getTime();
      if (Number.isNaN(startMs) || startMs < from.getTime() || startMs >= to) {
        return [];
      }
      return [{ row, start }];
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (events.length === 0) return `${label}: nothing scheduled.`;

  const lines = events
    .slice(0, MAX_PER_DAY)
    .map(({ row, start }) => `- ${describeEvent(row, start)}`);
  const more = events.length - MAX_PER_DAY;
  if (more > 0) lines.push(`- and ${more} more`);

  return `${label}:\n${lines.join("\n")}`;
}

// A short, always-available picture of the user's day, so questions like "what
// is my day like" are answered from the prompt instead of hoping a small model
// remembers to call a tool. Only the calendar goes here; email is read when
// the user asks about it.
export function buildDailyContext(
  store: EventsStore,
  now = new Date(),
): string {
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const rows = Object.values(store.getTable("events") ?? {});

  const nowText = now.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return [
    `It is ${nowText}.`,
    "The user's calendar (use list_schedule for other days):",
    listDay(rows, today, "Today"),
    listDay(rows, tomorrow, "Tomorrow"),
  ].join("\n");
}
