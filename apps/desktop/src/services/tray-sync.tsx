import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import { commands as openerCommands } from "@notiz/plugin-opener2";
import { commands as trayCommands } from "@notiz/plugin-tray";

import {
  buildTraySummary,
  collectTrayEvents,
  readIgnoredEvents,
} from "./tray-summary";

import { fetchInboxMessages } from "~/inbox/data";
import * as main from "~/store/tinybase/store/main";
import {
  createSession,
  getOrCreateSessionForEventId,
} from "~/store/tinybase/store/sessions";
import { useTabs } from "~/store/zustand/tabs";

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
    const ignored = readIgnoredEvents(
      store?.getValue("ignored_events"),
      store?.getValue("ignored_recurring_series"),
    );
    const summary = buildTraySummary(
      collectTrayEvents(events, calendars, ignored, now),
      now,
      unread,
    );

    const serialized = JSON.stringify(summary);
    if (serialized === lastSent.current) return;
    lastSent.current = serialized;
    void trayCommands.setTraySummary(summary);
  }, [store, events, calendars, now, unread]);

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
