import { commands as fsSyncCommands } from "@notiz/plugin-fs-sync";

import { FOLDERS_QUERY_KEY } from "./hooks";

import { queryClient } from "~/shared/query-client";
import { showTransientToast } from "~/sidebar/toast/transient";
import { sessionOps } from "~/store/tinybase/persister/session/ops";

export function normalizeFolderName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    return null;
  }
  return name;
}

export function joinFolderPath(parentId: string | null, name: string): string {
  return parentId ? `${parentId}/${name}` : name;
}

function reportFolderError(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  showTransientToast(
    {
      id: "folder-error",
      description: `Couldn't ${action}. ${message}`,
      variant: "error",
    },
    { durationMs: 5000 },
  );
}

async function refreshFolders() {
  await queryClient.invalidateQueries({ queryKey: FOLDERS_QUERY_KEY });
}

export async function createFolder(
  rawName: string,
  parentId: string | null = null,
): Promise<string | null> {
  const name = normalizeFolderName(rawName);
  if (!name) {
    reportFolderError("create the folder", "Use a name without slashes.");
    return null;
  }

  const path = joinFolderPath(parentId, name);
  const result = await fsSyncCommands.createFolder(path);
  if (result.status === "error") {
    reportFolderError("create the folder", result.error);
    return null;
  }

  // Show it in the sidebar straight away; the next re-read from disk agrees.
  queryClient.setQueryData<string[]>(FOLDERS_QUERY_KEY, (current = []) =>
    current.includes(path) ? current : [...current, path],
  );
  return path;
}

export async function renameFolder(
  folderId: string,
  rawName: string,
): Promise<string | null> {
  const name = normalizeFolderName(rawName);
  if (!name) {
    reportFolderError("rename the folder", "Use a name without slashes.");
    return null;
  }

  const parts = folderId.split("/");
  parts[parts.length - 1] = name;
  const nextPath = parts.join("/");
  if (nextPath === folderId) return folderId;

  const result = await sessionOps.renameFolder(folderId, nextPath);
  if (result.status === "error") {
    reportFolderError("rename the folder", result.error);
    return null;
  }

  await refreshFolders();
  return nextPath;
}

export async function deleteFolder(folderId: string): Promise<boolean> {
  const result = await fsSyncCommands.deleteFolder(folderId);
  if (result.status === "error") {
    reportFolderError(
      "delete the folder",
      "It still has notes. Move or delete them first.",
    );
    return false;
  }

  await refreshFolders();
  return true;
}

export async function moveNoteToFolder(
  sessionId: string,
  folderId: string,
): Promise<boolean> {
  const result = await sessionOps.moveSessionToFolder(sessionId, folderId);
  if (result.status === "error") {
    reportFolderError("move the note", result.error);
    return false;
  }

  await refreshFolders();
  return true;
}
