import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

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

// Folders are directories on disk. Empty ones only exist there, while the ones
// holding notes are also known to the store, so show the union of both.
export function useFolders(): FolderNode[] {
  const sessions = main.UI.useTable("sessions", main.STORE_ID);

  const { data: diskFolders } = useQuery({
    queryKey: FOLDERS_QUERY_KEY,
    queryFn: async () => {
      const result = await fsSyncCommands.listFolders();
      if (result.status === "error") throw new Error(result.error);
      return Object.keys(result.data.folders);
    },
  });

  return useMemo(() => {
    const noteFolders = Object.values(sessions)
      .map((row) => String(row.folder_id ?? ""))
      .filter(Boolean);

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
  }, [sessions, diskFolders]);
}
