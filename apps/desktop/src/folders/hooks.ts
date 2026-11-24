import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";

import { commands as fsSyncCommands } from "@notiz/plugin-fs-sync";

import * as main from "~/store/tinybase/store/main";

export const FOLDERS_QUERY_KEY = ["folders"] as const;

export type FolderNode = {
  id: string;
  name: string;
  depth: number;
  /** Notes in this folder and every folder below it. */
  count: number;
};

function ancestorsOf(id: string): string[] {
  const parts = id.split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function comparePaths(a: string, b: string): number {
  const left = a.split("/");
  const right = b.split("/");
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order = left[i].localeCompare(right[i]);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

export function isInFolder(
  noteFolderId: string,
  folderId: string | null,
): boolean {
  if (folderId === null) return true;
  return noteFolderId === folderId || noteFolderId.startsWith(`${folderId}/`);
}

// Only the folder column matters here. Subscribing to the whole sessions table
// would rebuild the sidebar on every keystroke, since typing rewrites a note.
function useNoteFolders(): string {
  const store = main.UI.useStore(main.STORE_ID);

  return useSyncExternalStore(
    (listener) => {
      if (!store) return () => {};
      const id = store.addCellListener("sessions", null, "folder_id", () =>
        listener(),
      );
      const rowsId = store.addRowIdsListener("sessions", () => listener());
      return () => {
        store.delListener(id);
        store.delListener(rowsId);
      };
    },
    () => {
      if (!store) return "";
      // A string snapshot compares by value, so unrelated edits cause no render.
      return store
        .getRowIds("sessions")
        .map((rowId) =>
          String(store.getCell("sessions", rowId, "folder_id") ?? ""),
        )
        .filter(Boolean)
        .join("\n");
    },
    () => "",
  );
}

// Folders are directories on disk. Empty ones only exist there, while the ones
// holding notes are also known to the store, so show the union of both.
export function useFolders(): FolderNode[] {
  const noteFoldersKey = useNoteFolders();

  const { data: diskFolders } = useQuery({
    queryKey: FOLDERS_QUERY_KEY,
    queryFn: async () => {
      const result = await fsSyncCommands.listFolders();
      if (result.status === "error") throw new Error(result.error);
      return Object.keys(result.data.folders);
    },
  });

  return useMemo(() => {
    const noteFolders = noteFoldersKey ? noteFoldersKey.split("\n") : [];

    const ids = new Set<string>();
    for (const folder of [...noteFolders, ...(diskFolders ?? [])]) {
      ancestorsOf(folder).forEach((id) => ids.add(id));
    }

    return [...ids].sort(comparePaths).map((id) => ({
      id,
      name: id.split("/").pop() ?? id,
      depth: id.split("/").length - 1,
      count: noteFolders.filter((folder) => isInFolder(folder, id)).length,
    }));
  }, [noteFoldersKey, diskFolders]);
}
