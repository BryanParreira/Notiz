import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { flushAllPendingNoteUpdates } from "@notiz/editor/note";
import { getCurrentWebviewWindowLabel } from "@notiz/plugin-windows";

import { useInitializeStore } from "./initialize";
import { type Store } from "./main";
import { registerSaveHandler, save } from "./save";

import { useCalendarPersister } from "~/store/tinybase/persister/calendar";
import { useDailyNotePersister } from "~/store/tinybase/persister/daily-note";
import { useEventsPersister } from "~/store/tinybase/persister/events";
import { useHumanPersister } from "~/store/tinybase/persister/human";
import { useOrganizationPersister } from "~/store/tinybase/persister/organization";
import { useSessionPersister } from "~/store/tinybase/persister/session";
import { useTaskPersister } from "~/store/tinybase/persister/tasks";
import { useValuesPersister } from "~/store/tinybase/persister/values";

export function useMainPersisters(store: Store) {
  const valuesPersister = useValuesPersister(store);
  const sessionPersister = useSessionPersister(store);
  const organizationPersister = useOrganizationPersister(store);
  const humanPersister = useHumanPersister(store);
  const eventPersister = useEventsPersister(store);
  const calendarPersister = useCalendarPersister(store);
  const dailyNotePersister = useDailyNotePersister(store);
  const taskPersister = useTaskPersister(store);

  useEffect(() => {
    if (getCurrentWebviewWindowLabel() !== "main") {
      return;
    }

    const persisters = [
      { id: "values", persister: valuesPersister },
      { id: "session", persister: sessionPersister },
      { id: "organization", persister: organizationPersister },
      { id: "human", persister: humanPersister },
      { id: "event", persister: eventPersister },
      { id: "calendar", persister: calendarPersister },
      { id: "dailyNote", persister: dailyNotePersister },
      { id: "task", persister: taskPersister },
    ];

    const unsubscribes = persisters
      .filter(({ persister }) => persister)
      .map(({ id, persister }) =>
        registerSaveHandler(id, async () => {
          await persister!.save();
        }),
      );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [
    valuesPersister,
    sessionPersister,
    organizationPersister,
    humanPersister,
    eventPersister,
    calendarPersister,
    dailyNotePersister,
    taskPersister,
  ]);

  // The editor debounces store writes by 500ms (packages/editor/src/note/index.tsx),
  // and TinyBase persister saves are fire-and-forget from the store's perspective —
  // neither has any way to know the window is about to close. Without this, closing
  // the app within that window drops whatever was typed since the last flush.
  useEffect(() => {
    if (getCurrentWebviewWindowLabel() !== "main") {
      return;
    }

    let closing = false;
    const window = getCurrentWindow();
    const unlistenPromise = window.onCloseRequested(async (event) => {
      if (closing) {
        return;
      }
      closing = true;
      event.preventDefault();

      try {
        flushAllPendingNoteUpdates();
        await save();
      } catch (error) {
        console.error("[persisters] flush-on-close failed:", error);
      }

      await window.close();
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useInitializeStore(store, {
    session: sessionPersister,
    human: humanPersister,
    values: valuesPersister,
  });

  return {
    valuesPersister,
    sessionPersister,
    organizationPersister,
    humanPersister,
    eventPersister,
    calendarPersister,
    dailyNotePersister,
    taskPersister,
  };
}
