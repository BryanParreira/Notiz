import { Trans } from "@lingui/react/macro";
import { TrashIcon } from "lucide-react";
import { useCallback } from "react";

import { DropdownMenuItem } from "@notiz/ui/components/ui/dropdown-menu";
import { cn } from "@notiz/utils";

import {
  captureSessionData,
  deleteSessionCascade,
  finalizeSessionDeletion,
} from "~/store/tinybase/store/deleteSession";
import * as main from "~/store/tinybase/store/main";
import { useTabs } from "~/store/zustand/tabs";
import { useUndoDelete } from "~/store/zustand/undo-delete";

export function DeleteNote({ sessionId }: { sessionId: string }) {
  const store = main.UI.useStore(main.STORE_ID);
  const indexes = main.UI.useIndexes(main.STORE_ID);
  const invalidateResource = useTabs((state) => state.invalidateResource);
  const addDeletion = useUndoDelete((state) => state.addDeletion);

  const handleDeleteNote = useCallback(() => {
    if (!store) {
      return;
    }

    const capturedData = captureSessionData(store, indexes, sessionId);

    invalidateResource("sessions", sessionId);
    void deleteSessionCascade(store, indexes, sessionId, {
      deferFilesystemDelete: true,
    });

    if (capturedData) {
      addDeletion(capturedData, () => {
        void finalizeSessionDeletion(sessionId);
      });
    }
  }, [store, indexes, sessionId, invalidateResource, addDeletion]);

  return (
    <DropdownMenuItem
      onClick={handleDeleteNote}
      className={cn([
        "cursor-pointer text-red-600 dark:text-red-400",
        "hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/50 dark:hover:text-red-300",
      ])}
    >
      <TrashIcon />
      <span>
        <Trans>Delete</Trans>
      </span>
    </DropdownMenuItem>
  );
}
