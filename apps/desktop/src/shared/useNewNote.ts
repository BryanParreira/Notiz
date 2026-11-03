import { useRouteContext } from "@tanstack/react-router";
import { useCallback } from "react";
import { useShallow } from "zustand/shallow";

import { createSession } from "~/store/tinybase/store/sessions";
import { useTabs } from "~/store/zustand/tabs";

export function useNewNote({
  behavior = "new",
}: {
  behavior?: "new" | "current";
} = {}) {
  const { persistedStore } = useRouteContext({
    from: "__root__",
  });
  const { openNew, openCurrent } = useTabs(
    useShallow((state) => ({
      openNew: state.openNew,
      openCurrent: state.openCurrent,
    })),
  );

  const handler = useCallback(() => {
    if (!persistedStore) {
      return;
    }

    const sessionId = createSession(persistedStore);
    const ff = behavior === "new" ? openNew : openCurrent;
    ff({ type: "sessions", id: sessionId });
  }, [persistedStore, openNew, openCurrent, behavior]);

  return handler;
}
