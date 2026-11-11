import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { format, isSameDay, parseISO } from "date-fns";
import { useEffect, useRef, useState } from "react";

import { commands as openerCommands } from "@notiz/plugin-opener2";
import { commands as trayCommands } from "@notiz/plugin-tray";

import { fetchInboxMessages } from "~/inbox/data";
import * as main from "~/store/tinybase/store/main";
import {
  createSession,
  getOrCreateSessionForEventId,
} from "~/store/tinybase/store/sessions";
import { useTabs } from "~/store/zustand/tabs";

const TITLE_MAX = 24;
const TITLE_WINDOW_MIN = 60;

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

export function TraySync() {
  const store = main.UI.useStore(main.STORE_ID);
  const events = main.UI.useTable("events", main.STORE_ID);
  const calendars = main.UI.useTable("calendars", main.STORE_ID);
  const [now, setNow] = useState(() => new Date());
  const lastSent = useRef("");

  const { data: inbox } = useQuery({
    queryKey: ["tray-inbox-unread"],
    queryFn: () => fetchInboxMessages(80),
    refetchInterval: 2 * 60 * 1000,
    retry: false,
  });
  const unread = inbox?.connected
    ? inbox.messages.filter((m) => m.unread).length
    : 0;

  // Ticks on the minute boundary so the countdown never lags the real clock.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = new Date();
      setNow(current);
      const untilNextMinute =
        60_000 - (current.getSeconds() * 1000 + current.getMilliseconds());
      timer = setTimeout(schedule, untilNextMinute + 250);
    };
    schedule();
    // A hidden window can pause its timers; resync the moment it wakes.
    const resync = () => {
      clearTimeout(timer);
      schedule();
    };
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, []);

  useEffect(() => {
    const today = Object.entries(events)
      .map(([id, row]) => ({
        id,
        title: String(row.title || "Untitled event"),
        start: parse(row.started_at),
        end: parse(row.ended_at),
        allDay: Boolean(row.is_all_day),
        color:
          (typeof row.calendar_id === "string" &&
            (calendars[row.calendar_id]?.color as string | undefined)) ||
          null,
        joinUrl:
          typeof row.meeting_link === "string" && row.meeting_link
            ? row.meeting_link
            : null,
      }))
      .filter(
        (e): e is typeof e & { start: Date; end: Date } =>
          !!e.start &&
          !!e.end &&
          !e.allDay &&
          e.end > now &&
          isSameDay(e.start, now),
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    // One meeting synced from several calendars is one entry.
    const seen = new Set<string>();
    const unique = today.filter((e) => {
      const key = `${e.start.getTime()}-${e.title.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const first = unique[0];
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
            inProgress
              ? remaining(minutesLeft ?? 0)
              : countdown(minutesAway ?? 0)
          }`
        : null;

    const toItem = (e: (typeof today)[number], label: string) => ({
      id: e.id,
      title: e.title,
      label,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
      color: e.color,
      join_url: e.joinUrl,
    });

    const summary = {
      title,
      next: first && nextLabel ? toItem(first, nextLabel) : null,
      agenda: unique.map((e) =>
        toItem(e, `${format(e.start, "h:mm a")}  ${e.title}`),
      ),
      unread,
    };

    const serialized = JSON.stringify(summary);
    if (serialized === lastSent.current) return;
    lastSent.current = serialized;
    void trayCommands.setTraySummary(summary);
  }, [events, calendars, now, unread]);

  useEffect(() => {
    const unlisten = listen<{ kind: string; value: string | null }>(
      "notiz://tray-action",
      ({ payload }) => {
        const tabs = useTabs.getState();
        switch (payload.kind) {
          case "open_event": {
            if (!store || !payload.value) return;
            const sessionId = getOrCreateSessionForEventId(
              store as main.Store,
              payload.value,
            );
            tabs.openNew({ type: "sessions", id: sessionId });
            return;
          }
          case "join":
            if (payload.value) {
              void openerCommands.openUrl(payload.value, null);
            }
            return;
          case "new_note": {
            if (!store) return;
            const sessionId = createSession(store as main.Store);
            tabs.openNew({ type: "sessions", id: sessionId });
            return;
          }
          case "open_calendar":
            tabs.openNew({ type: "calendar" });
            return;
          case "open_inbox":
            tabs.openNew({ type: "inbox" });
            return;
        }
      },
    );

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [store]);

  return null;
}
