import type { Store } from "~/store/tinybase/store/main";

// Synced events can be left behind when their calendar row is recreated with a
// new id (the old events then point at a calendar that no longer exists) and
// then added again under the new one. That shows every event twice. This drops
// events whose calendar is gone or switched off, plus repeated copies of the
// same event within one calendar.
export function pruneStaleCalendarEvents(store: Store): number {
  const enabled = new Set<string>();
  for (const id of store.getRowIds("calendars")) {
    if (store.getCell("calendars", id, "enabled")) enabled.add(id);
  }

  const seen = new Map<string, { id: string; createdAt: string }>();
  const toDelete: string[] = [];

  for (const id of store.getRowIds("events")) {
    const event = store.getRow("events", id);
    const calendarId = event.calendar_id;

    if (!calendarId || !enabled.has(calendarId)) {
      toDelete.push(id);
      continue;
    }

    const key = `${calendarId}|${event.tracking_id_event ?? ""}|${event.started_at ?? ""}`;
    const createdAt = event.created_at ?? "";
    const previous = seen.get(key);
    if (!previous) {
      seen.set(key, { id, createdAt });
    } else if (createdAt && createdAt < previous.createdAt) {
      toDelete.push(previous.id);
      seen.set(key, { id, createdAt });
    } else {
      toDelete.push(id);
    }
  }

  if (toDelete.length === 0) return 0;

  store.transaction(() => {
    for (const id of toDelete) store.delRow("events", id);
  });
  return toDelete.length;
}
