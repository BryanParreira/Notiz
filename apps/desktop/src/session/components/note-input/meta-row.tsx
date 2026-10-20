import { format, isToday, isYesterday, parseISO } from "date-fns";
import {
  CalendarIcon,
  FolderIcon,
  FolderPlusIcon,
  UsersIcon,
} from "lucide-react";
import { forwardRef, useMemo } from "react";

import { cn } from "@notiz/utils";

import { MetadataButton } from "../outer-header/metadata";

import { moveNoteToFolder } from "~/folders/actions";
import { useFolders } from "~/folders/hooks";
import {
  type MenuItemDef,
  useNativeContextMenu,
} from "~/shared/hooks/useNativeContextMenu";
import * as main from "~/store/tinybase/store/main";

const Chip = forwardRef<
  HTMLButtonElement,
  { icon: React.ReactNode; children: React.ReactNode; active?: boolean } & Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "children"
  >
>(({ icon, children, active, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    {...props}
    className={cn([
      "border-border text-muted-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
      "hover:bg-accent hover:text-foreground transition-colors",
      active && "bg-accent text-foreground",
      className,
    ])}
  >
    {icon}
    <span className="max-w-40 truncate">{children}</span>
  </button>
));
Chip.displayName = "Chip";

function dateLabel(createdAt: string | undefined) {
  if (!createdAt) return "Today";
  const date = parseISO(createdAt);
  if (Number.isNaN(date.getTime())) return "Today";
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE, MMM d");
}

export function NoteMetaRow({ sessionId }: { sessionId: string }) {
  const createdAt = main.UI.useCell(
    "sessions",
    sessionId,
    "created_at",
    main.STORE_ID,
  ) as string | undefined;
  const folderId =
    (main.UI.useCell("sessions", sessionId, "folder_id", main.STORE_ID) as
      | string
      | undefined) ?? "";

  const participants = main.UI.useTable(
    "mapping_session_participant",
    main.STORE_ID,
  );
  const humans = main.UI.useTable("humans", main.STORE_ID);
  const names = useMemo(
    () =>
      Object.values(participants)
        .filter((row) => row.session_id === sessionId)
        .map((row) => String(humans[String(row.human_id)]?.name ?? "").trim())
        .filter(Boolean),
    [participants, humans, sessionId],
  );

  const peopleLabel =
    names.length === 0
      ? "Me"
      : names.length === 1
        ? names[0]
        : `${names[0]} +${names.length - 1}`;

  const folders = useFolders();
  const folderItems: MenuItemDef[] = [
    {
      id: "folder-none",
      text: "No folder",
      disabled: folderId === "",
      action: () => void moveNoteToFolder(sessionId, ""),
    },
    ...folders.slice(0, 30).map(
      (folder): MenuItemDef => ({
        id: `folder-${folder.id}`,
        text: folder.id,
        disabled: folder.id === folderId,
        action: () => void moveNoteToFolder(sessionId, folder.id),
      }),
    ),
  ];
  const showFolderMenu = useNativeContextMenu(folderItems);

  return (
    <div
      data-note-meta-row
      data-tauri-drag-region="false"
      className="flex flex-wrap items-center gap-2 px-3 pt-1 pb-2"
    >
      <MetadataButton
        sessionId={sessionId}
        section="date"
        renderTrigger={({ open, label }) => (
          <Chip
            aria-label={label}
            active={open}
            icon={<CalendarIcon className="size-3.5" />}
          >
            {dateLabel(createdAt)}
          </Chip>
        )}
      />
      <MetadataButton
        sessionId={sessionId}
        section="people"
        renderTrigger={({ open, label }) => (
          <Chip
            aria-label={label}
            active={open}
            icon={<UsersIcon className="size-3.5" />}
          >
            {peopleLabel}
          </Chip>
        )}
      />
      <Chip
        aria-label="Choose folder"
        onClick={(e) => void showFolderMenu(e)}
        icon={
          folderId ? (
            <FolderIcon className="size-3.5" />
          ) : (
            <FolderPlusIcon className="size-3.5" />
          )
        }
      >
        {folderId ? (folderId.split("/").pop() ?? folderId) : "Add to folder"}
      </Chip>
    </div>
  );
}
