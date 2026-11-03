import { type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import { events as notificationEvents } from "@notiz/plugin-notification";
import {
  commands as updaterCommands,
  events as updaterEvents,
} from "@notiz/plugin-updater2";
import { getCurrentWebviewWindowLabel } from "@notiz/plugin-windows";

import * as main from "~/store/tinybase/store/main";
import {
  createSession,
  getOrCreateSessionForEventId,
} from "~/store/tinybase/store/sessions";
import { useTabs } from "~/store/zustand/tabs";

function useUpdaterEvents() {
  const openNew = useTabs((state) => state.openNew);

  useEffect(() => {
    if (getCurrentWebviewWindowLabel() !== "main") {
      return;
    }

    let unlisten: UnlistenFn | null = null;

    void updaterEvents.updatedEvent
      .listen(({ payload: { previous, current } }) => {
        openNew({
          type: "changelog",
          state: { previous, current },
        });
      })
      .then((f) => {
        unlisten = f;
        updaterCommands.maybeEmitUpdated();
      });

    return () => {
      unlisten?.();
    };
  }, [openNew]);
}

function useNotificationEvents() {
  const store = main.UI.useStore(main.STORE_ID);
  const openNew = useTabs((state) => state.openNew);
  const pendingEventId = useRef<string | null | undefined>(undefined);
  const storeRef = useRef(store);
  const openNewRef = useRef(openNew);

  useEffect(() => {
    storeRef.current = store;
    openNewRef.current = openNew;
  }, [store, openNew]);

  useEffect(() => {
    if (pendingEventId.current !== undefined && store) {
      const eventId = pendingEventId.current;
      pendingEventId.current = undefined;
      const sessionId = eventId
        ? getOrCreateSessionForEventId(store, eventId)
        : createSession(store);

      openNew({ type: "sessions", id: sessionId });
    }
  }, [store, openNew]);

  useEffect(() => {
    if (getCurrentWebviewWindowLabel() !== "main") {
      return;
    }

    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    void notificationEvents.notificationEvent
      .listen(({ payload }) => {
        if (
          payload.type !== "notification_confirm" &&
          payload.type !== "notification_accept"
        ) {
          return;
        }

        const eventId =
          payload.source?.type === "calendar_event"
            ? payload.source.event_id
            : null;
        const sourceSessionId =
          payload.source?.type === "session" ? payload.source.session_id : null;

        if (sourceSessionId) {
          openNewRef.current({ type: "sessions", id: sourceSessionId });
          return;
        }

        const currentStore = storeRef.current;
        if (!currentStore) {
          pendingEventId.current = eventId;
          return;
        }

        const sessionId = eventId
          ? getOrCreateSessionForEventId(currentStore, eventId)
          : createSession(currentStore);

        openNewRef.current({ type: "sessions", id: sessionId });
      })
      .then((f) => {
        if (cancelled) {
          f();
        } else {
          unlisten = f;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

export function EventListeners() {
  useUpdaterEvents();
  useNotificationEvents();

  return null;
}
