import { FolderIcon, FolderPlusIcon } from "lucide-react";
import { forwardRef, useState } from "react";

import { cn } from "@notiz/utils";

import { createFolder, moveNoteToFolder } from "~/folders/actions";
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

export function NoteMetaRow({ sessionId }: { sessionId: string }) {
  const folderId =
    (main.UI.useCell("sessions", sessionId, "folder_id", main.STORE_ID) as
      | string
      | undefined) ?? "";

  const folders = useFolders();
  const [naming, setNaming] = useState(false);

  // One step: make the folder and put this note in it, so nothing needs to be
  // moved by hand afterwards.
  const createAndMove = async (rawName: string) => {
    setNaming(false);
    if (!rawName.trim()) return;
    const path = await createFolder(rawName);
    if (path) await moveNoteToFolder(sessionId, path);
  };

  const folderItems: MenuItemDef[] = [
    { id: "folder-new", text: "New folder…", action: () => setNaming(true) },
    { separator: true },
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
      {naming ? (
        <NewFolderInput
          onSubmit={(name) => void createAndMove(name)}
          onCancel={() => setNaming(false)}
        />
      ) : (
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
      )}
    </div>
  );
}

function NewFolderInput({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  return (
    <span className="border-primary text-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
      <FolderPlusIcon className="text-muted-foreground size-3.5" />
      <input
        autoFocus
        value={value}
        placeholder="Folder name"
        aria-label="New folder name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit(value);
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => onSubmit(value)}
        className="placeholder:text-muted-foreground w-32 bg-transparent outline-none"
      />
    </span>
  );
}
