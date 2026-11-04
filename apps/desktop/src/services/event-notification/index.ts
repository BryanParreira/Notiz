import { commands as notificationCommands } from "@notiz/plugin-notification";

import type * as main from "~/store/tinybase/store/main";
import type * as settings from "~/store/tinybase/store/settings";

export const EVENT_NOTIFICATION_TASK_ID = "eventNotification";
export const EVENT_NOTIFICATION_INTERVAL = 30 * 1000; // 30 sec

const NOTIFY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes before
const NOTIFIED_EVENTS_TTL_MS = 10 * 60 * 1000; // 10 minutes TTL for cleanup

const NOTIFICATION_LINGER_MS = 60 * 1000;
const NOTIFIED_STORAGE_KEY = "notiz-notified-events";

export type NotifiedEventsMap = Map<string, number>;

// Kept across restarts so relaunching inside the notify window does not repeat it.
export function loadNotifiedEvents(): NotifiedEventsMap {
  try {
    const raw = localStorage.getItem(NOTIFIED_STORAGE_KEY);
    return new Map(raw ? (JSON.parse(raw) as [string, number][]) : []);
  } catch {
    return new Map();
  }
}

export function saveNotifiedEvents(notifiedEvents: NotifiedEventsMap) {
  try {
    localStorage.setItem(
      NOTIFIED_STORAGE_KEY,
      JSON.stringify([...notifiedEvents]),
    );
  } catch {}
}

export function checkEventNotifications(
  store: main.Store,
  settingsStore: settings.Store,
  notifiedEvents: NotifiedEventsMap,
) {
  const notificationEnabled = settingsStore?.getValue("notification_event");
  if (!notificationEnabled || !store) {
    return;
  }

  const now = Date.now();

  for (const [key, timestamp] of notifiedEvents) {
    if (now - timestamp > NOTIFIED_EVENTS_TTL_MS) {
      notifiedEvents.delete(key);
    }
  }

  const ignoredIds = new Set<string>();
  const ignoredSeriesIds = new Set<string>();

  try {
    const raw = store.getValue("ignored_events") as string | undefined;
    if (raw) {
      for (const e of JSON.parse(raw) as Array<{
        tracking_id: string;
      }>) {
        ignoredIds.add(e.tracking_id);
      }
    }
  } catch {}

  try {
    const raw = store.getValue("ignored_recurring_series") as
      | string
      | undefined;
    if (raw) {
      for (const e of JSON.parse(raw) as Array<{ id: string }>) {
        ignoredSeriesIds.add(e.id);
      }
    }
  } catch {}

  store.forEachRow("events", (eventId, _forEachCell) => {
    const event = store.getRow("events", eventId);
    if (!event?.started_at || event.is_all_day) return;

    const startTime = new Date(String(event.started_at));
    const timeUntilStart = startTime.getTime() - now;
    const notificationKey = `event-${eventId}-${startTime.getTime()}`;
    const title = String(event.title || "Upcoming Event");
    // The same meeting can be synced from several calendars as separate rows.
    const normalizedTitle = String(event.title ?? "")
      .trim()
      .toLowerCase();
    const dedupeKey = normalizedTitle
      ? `meeting-${startTime.getTime()}-${normalizedTitle}`
      : notificationKey;

    const trackingId = event.tracking_id_event as string | undefined;
    const recurrenceSeriesId = event.recurrence_series_id as string | undefined;

    if (trackingId) {
      if (ignoredIds.has(trackingId)) return;
      if (recurrenceSeriesId && ignoredSeriesIds.has(recurrenceSeriesId))
        return;
    }

    if (timeUntilStart > 0 && timeUntilStart <= NOTIFY_WINDOW_MS) {
      if (notifiedEvents.has(dedupeKey)) {
        return;
      }

      notifiedEvents.set(dedupeKey, now);

      const startLabel = startTime.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });

      void notificationCommands.showNotification({
        key: notificationKey,
        title: title,
        message: `Starts at ${startLabel}`,
        timeout: {
          secs: Math.ceil((timeUntilStart + NOTIFICATION_LINGER_MS) / 1000),
          nanos: 0,
        },
        source: { type: "calendar_event", event_id: eventId },
        start_time: Math.floor(startTime.getTime() / 1000),
        participants: null,
        event_details: null,
        action_label: "Open Notiz",
        action_variant: null,
        options: null,
        footer: null,
        icon: null,
      });
    } else if (timeUntilStart <= 0) {
      notifiedEvents.delete(dedupeKey);
    }
  });
}
