import { useRouteContext } from "@tanstack/react-router";

import { TaskStorageProvider } from "@notiz/editor/task-storage";

import { ClassicMainServices } from "./lifecycle";

import { ShellProvider } from "~/contexts/shell";
import { useStoreBackedTaskStorage } from "~/editor-bridge/task-storage";
import { SearchEngineProvider } from "~/search/contexts/engine";
import { OpenNoteDialogProvider } from "~/shared/open-note-dialog";

export function ClassicMainLayout({
  children,
  includeServices = true,
}: {
  children: React.ReactNode;
  includeServices?: boolean;
}) {
  const { persistedStore } = useRouteContext({
    from: "__root__",
  });
  const taskStorage = useStoreBackedTaskStorage();

  return (
    <SearchEngineProvider store={persistedStore}>
      <TaskStorageProvider storage={taskStorage}>
        <OpenNoteDialogProvider>
          <ShellProvider>
            {includeServices ? <ClassicMainServices /> : null}
            {children}
          </ShellProvider>
        </OpenNoteDialogProvider>
      </TaskStorageProvider>
    </SearchEngineProvider>
  );
}
