import { Trans } from "@lingui/react/macro";
import { format, isToday, parseISO } from "date-fns";
import { FileTextIcon, MoreHorizontalIcon } from "lucide-react";
import { type MouseEvent, useMemo } from "react";

import { cn } from "@notiz/utils";

import { moveNoteToFolder } from "./actions";
import { type FolderNode, isInFolder, useFolders } from "./hooks";

import {
  type MenuItemDef,
  useNativeContextMenu,
} from "~/shared/hooks/useNativeContextMenu";
import * as main from "~/store/tinybase/store/main";
import { useTabs } from "~/store/zustand/tabs";

const MAX_NOTES = 100;

type NoteRow = {
  id: string;
  title: string;
  folderId: string;
  createdAt: Date;
};

function safeParse(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function useNotesByDay(folderId: string | null) {
  const sessions = main.UI.useTable("sessions", main.STORE_ID);

  return useMemo(() => {
    const notes: NoteRow[] = [];
    for (const [id, row] of Object.entries(sessions)) {
      const createdAt = safeParse(row.created_at);
      const noteFolder = String(row.folder_id ?? "");
      if (!createdAt || !isInFolder(noteFolder, folderId)) continue;
      notes.push({
        id,
        title: String(row.title || ""),
        folderId: noteFolder,
        createdAt,
      });
    }

    notes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const groups: { label: string; notes: NoteRow[] }[] = [];
    for (const note of notes.slice(0, MAX_NOTES)) {
      const label = isToday(note.createdAt)
        ? "Today"
        : format(note.createdAt, "EEE, MMM d");
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.notes.push(note);
      } else {
        groups.push({ label, notes: [note] });
      }
    }
    return groups;
  }, [sessions, folderId]);
}

export function NotesList({
  folderId = null,
  empty,
}: {
  folderId?: string | null;
  empty: React.ReactNode;
}) {
  const groups = useNotesByDay(folderId);
  const folders = useFolders();

  if (groups.length === 0) {
    return <>{empty}</>;
  }

  return (
    <section className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <h2 className="text-muted-foreground px-3 pb-1 text-sm">
            {group.label}
          </h2>
          {group.notes.map((note) => (
            <NoteListItem key={note.id} note={note} folders={folders} />
          ))}
        </div>
      ))}
    </section>
  );
}

function NoteListItem({
  note,
  folders,
}: {
  note: NoteRow;
  folders: FolderNode[];
}) {
  const openCurrent = useTabs((state) => state.openCurrent);

  const items: MenuItemDef[] = [
    {
      id: `open-${note.id}`,
      text: "Open",
      action: () => openCurrent({ type: "sessions", id: note.id }),
    },
    { separator: true },
    {
      id: `move-${note.id}-none`,
      text: "Move out of folder",
      disabled: note.folderId === "",
      action: () => void moveNoteToFolder(note.id, ""),
    },
    ...folders.slice(0, 30).map(
      (folder): MenuItemDef => ({
        id: `move-${note.id}-${folder.id}`,
        text: `Move to ${folder.id}`,
        disabled: note.folderId === folder.id,
        action: () => void moveNoteToFolder(note.id, folder.id),
      }),
    ),
  ];

  const showMenu = useNativeContextMenu(items);

  return (
    <div
      onContextMenu={showMenu}
      className={cn([
        "group hover:bg-accent flex items-center gap-4 rounded-xl px-3 py-2.5",
        "transition-colors",
      ])}
    >
      <button
        type="button"
        onClick={() => openCurrent({ type: "sessions", id: note.id })}
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
      >
        <span className="bg-secondary text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
          <FileTextIcon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-foreground truncate text-base">
            {note.title || <Trans>New note</Trans>}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {note.folderId ? note.folderId : <Trans>Me</Trans>}
          </span>
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {format(note.createdAt, "h:mm a")}
        </span>
      </button>
      <button
        type="button"
        aria-label="Note options"
        onClick={(e: MouseEvent) => void showMenu(e)}
        className="text-muted-foreground hover:text-foreground rounded-full p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <MoreHorizontalIcon className="size-4" />
      </button>
    </div>
  );
}
