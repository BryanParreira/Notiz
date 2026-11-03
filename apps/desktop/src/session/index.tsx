import React, { useEffect, useRef } from "react";

import { CaretPositionProvider } from "./components/caret-position-context";
import { NoteInput, type NoteInputHandle } from "./components/note-input";
import { SearchProvider } from "./components/note-input/search/context";
import { OuterHeader } from "./components/outer-header";
import { SessionSurface } from "./components/session-surface";

import { hydrateSessionContent } from "~/store/tinybase/persister/session/hydrate";
import * as main from "~/store/tinybase/store/main";
import type { Tab } from "~/store/zustand/tabs";

const hydratedSessionIds = new Set<string>();

export function TabContentNote({
  standaloneWindow = false,
  tab,
}: {
  standaloneWindow?: boolean;
  tab: Extract<Tab, { type: "sessions" }>;
}) {
  return (
    <CaretPositionProvider>
      <SearchProvider>
        <TabContentNoteInner tab={tab} standaloneWindow={standaloneWindow} />
      </SearchProvider>
    </CaretPositionProvider>
  );
}

function TabContentNoteInner({
  tab,
  standaloneWindow,
}: {
  tab: Extract<Tab, { type: "sessions" }>;
  standaloneWindow: boolean;
}) {
  const noteInputRef = React.useRef<NoteInputHandle>(null);
  const contentHydrated = useHydrateSessionContent(tab.id);
  useAutoFocusTitle({ sessionId: tab.id, noteInputRef });

  return (
    <SessionSurface
      header={
        <OuterHeader sessionId={tab.id} standaloneWindow={standaloneWindow} />
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          {contentHydrated ? (
            <NoteInput key={tab.id} ref={noteInputRef} tab={tab} />
          ) : (
            <SessionContentLoading />
          )}
        </div>
      </div>
    </SessionSurface>
  );
}

function useHydrateSessionContent(sessionId: string): boolean {
  const store = main.UI.useStore(main.STORE_ID);
  const [retryAttempt, setRetryAttempt] = React.useState(0);
  const [hydrated, setHydrated] = React.useState(() =>
    hydratedSessionIds.has(sessionId),
  );

  useEffect(() => {
    if (hydratedSessionIds.has(sessionId)) {
      setHydrated(true);
      return;
    }

    if (!store) {
      setHydrated(false);
      return;
    }

    let active = true;
    setHydrated(false);

    void hydrateSessionContent(store, sessionId).then((success) => {
      if (success) {
        hydratedSessionIds.add(sessionId);
      }
      if (active) {
        setHydrated(success);
        if (!success) {
          window.setTimeout(() => {
            if (active) {
              setRetryAttempt((attempt) => attempt + 1);
            }
          }, 1000);
        }
      }
    });

    return () => {
      active = false;
    };
  }, [store, sessionId, retryAttempt]);

  return hydrated;
}

function SessionContentLoading() {
  return (
    <div className="flex h-full flex-col gap-3 px-4 py-5">
      <div className="bg-muted h-5 w-3/5 animate-pulse rounded-md" />
      <div className="bg-muted/80 h-4 w-4/5 animate-pulse rounded-md" />
      <div className="bg-muted/70 h-4 w-2/3 animate-pulse rounded-md" />
    </div>
  );
}

function useAutoFocusTitle({
  sessionId,
  noteInputRef,
}: {
  sessionId: string;
  noteInputRef: React.RefObject<NoteInputHandle | null>;
}) {
  const autoFocusedSessionRef = useRef<string | null>(null);
  const title = main.UI.useCell("sessions", sessionId, "title", main.STORE_ID);

  useEffect(() => {
    if (autoFocusedSessionRef.current === sessionId) return;

    if (!title) {
      noteInputRef.current?.focusAtStart();
      autoFocusedSessionRef.current = sessionId;
    }
  }, [sessionId, title]);
}
