import { Trans } from "@lingui/react/macro";
import {
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  PlusIcon,
  StarIcon,
} from "lucide-react";
import { Fragment, type KeyboardEvent, useState } from "react";

import { cn } from "@notiz/utils";

import { createFolder, deleteFolder, renameFolder } from "~/folders/actions";
import { type FolderNode, useFolders } from "~/folders/hooks";
import {
  type MenuItemDef,
  useNativeContextMenu,
} from "~/shared/hooks/useNativeContextMenu";
import { useStarredIds } from "~/shared/starred";
import * as main from "~/store/tinybase/store/main";
import { useTabs } from "~/store/zustand/tabs";

export function SidebarFolders() {
  const folders = useFolders();
  const currentTab = useTabs((state) => state.currentTab);
  const openNew = useTabs((state) => state.openNew);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const hidden = (id: string) =>
    [...collapsed].some((parent) => id.startsWith(`${parent}/`));
  const hasChildren = (id: string) =>
    folders.some((folder) => folder.id.startsWith(`${id}/`));

  const activeFolderId =
    currentTab?.type === "folders" ? (currentTab.id ?? "") : undefined;

  const openFolder = (id: string | null) => openNew({ type: "folders", id });

  const commitCreate = async (name: string, parentId: string | null = null) => {
    setCreating(false);
    setCreatingIn(null);
    if (!name.trim()) return;
    const path = await createFolder(name, parentId);
    if (path) openFolder(path);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 px-2 pt-3">
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-muted-foreground text-xs">
          <Trans>Folders</Trans>
        </span>
        <button
          type="button"
          aria-label="New folder"
          onClick={() => setCreating(true)}
          className="text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground rounded-md p-1 transition-colors"
        >
          <PlusIcon size={14} />
        </button>
      </div>

      <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <FolderRow
          icon={<FileTextIcon size={14} />}
          label={<Trans>All notes</Trans>}
          active={activeFolderId === ""}
          onClick={() => openFolder(null)}
        />

        <StarredNotes />

        {creating && (
          <NameInput
            placeholder="Folder name"
            onSubmit={(name) => void commitCreate(name)}
            onCancel={() => setCreating(false)}
          />
        )}

        {folders.map((folder) =>
          hidden(folder.id) ? null : (
            <Fragment key={folder.id}>
              {renamingId === folder.id ? (
                <NameInput
                  depth={folder.depth}
                  initial={folder.name}
                  placeholder="Folder name"
                  onSubmit={(name) => {
                    setRenamingId(null);
                    void renameFolder(folder.id, name).then((renamed) => {
                      if (renamed && activeFolderId === folder.id) {
                        openFolder(renamed);
                      }
                    });
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <FolderItem
                  folder={folder}
                  active={activeFolderId === folder.id}
                  collapsible={hasChildren(folder.id)}
                  collapsed={collapsed.has(folder.id)}
                  onToggle={() => toggleCollapsed(folder.id)}
                  onOpen={() => openFolder(folder.id)}
                  onRename={() => setRenamingId(folder.id)}
                  onNewSubfolder={() => {
                    setCollapsed((current) => {
                      const next = new Set(current);
                      next.delete(folder.id);
                      return next;
                    });
                    setCreatingIn(folder.id);
                  }}
                  onDeleted={() => {
                    if (activeFolderId === folder.id) openFolder(null);
                  }}
                />
              )}
              {creatingIn === folder.id && (
                <NameInput
                  depth={folder.depth + 1}
                  placeholder="Subfolder name"
                  onSubmit={(name) => void commitCreate(name, folder.id)}
                  onCancel={() => setCreatingIn(null)}
                />
              )}
            </Fragment>
          ),
        )}
      </div>
    </div>
  );
}

function FolderItem({
  folder,
  active,
  collapsible,
  collapsed,
  onToggle,
  onOpen,
  onRename,
  onNewSubfolder,
  onDeleted,
}: {
  folder: FolderNode;
  active: boolean;
  collapsible: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onRename: () => void;
  onNewSubfolder: () => void;
  onDeleted: () => void;
}) {
  const items: MenuItemDef[] = [
    { id: `open-${folder.id}`, text: "Open", action: onOpen },
    { id: `sub-${folder.id}`, text: "New subfolder", action: onNewSubfolder },
    { id: `rename-${folder.id}`, text: "Rename", action: onRename },
    { separator: true },
    {
      id: `delete-${folder.id}`,
      text: "Delete folder",
      action: () =>
        void deleteFolder(folder.id).then((ok) => ok && onDeleted()),
    },
  ];
  const showMenu = useNativeContextMenu(items);

  return (
    <div onContextMenu={showMenu} className="group relative">
      {collapsible && (
        <button
          type="button"
          aria-label={collapsed ? "Expand folder" : "Collapse folder"}
          onClick={onToggle}
          style={{ left: 2 + folder.depth * 14 }}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 z-10 -translate-y-1/2 rounded p-0.5"
        >
          <ChevronRightIcon
            size={12}
            className={cn(["transition-transform", !collapsed && "rotate-90"])}
          />
        </button>
      )}
      <FolderRow
        depth={folder.depth}
        icon={<FolderIcon size={14} />}
        label={folder.name}
        count={folder.count}
        active={active}
        onClick={onOpen}
      />
    </div>
  );
}

function FolderRow({
  icon,
  label,
  count,
  depth = 0,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  count?: number;
  depth?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      style={{ paddingLeft: 12 + depth * 14 }}
      className={cn([
        "flex items-center gap-3 rounded-lg py-1.5 pr-3 text-left text-sm",
        "transition-colors duration-150",
        active
          ? "bg-sidebar-accent text-foreground font-medium"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      ])}
    >
      <span className="bg-secondary flex size-6 shrink-0 items-center justify-center rounded-md">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? (
        <span className="text-muted-foreground/70 text-xs tabular-nums">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function NameInput({
  initial = "",
  depth = 0,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  depth?: number;
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onSubmit(value);
    if (e.key === "Escape") onCancel();
  };

  return (
    <div
      style={{ paddingLeft: 12 + depth * 14 }}
      className="flex items-center gap-3 py-1 pr-2"
    >
      <span className="bg-secondary text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md">
        <FolderIcon size={14} />
      </span>
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => onSubmit(value)}
        className="border-border bg-background focus:border-primary min-w-0 flex-1 rounded-md border px-2 py-1 text-sm outline-none"
      />
    </div>
  );
}

function StarredNotes() {
  const starred = useStarredIds();
  if (starred.length === 0) return null;

  return (
    <div className="mb-1 flex flex-col gap-0.5">
      <span className="text-muted-foreground px-3 pt-1 pb-0.5 text-xs">
        <Trans>Starred</Trans>
      </span>
      {starred.map((id) => (
        <StarredNote key={id} id={id} />
      ))}
    </div>
  );
}

// Reads only this note's title so typing elsewhere never re-renders the sidebar.
function StarredNote({ id }: { id: string }) {
  const title = main.UI.useCell("sessions", id, "title", main.STORE_ID);
  const active = useTabs(
    (state) =>
      state.currentTab?.type === "sessions" && state.currentTab.id === id,
  );
  const openNew = useTabs((state) => state.openNew);

  if (title === undefined) return null;

  return (
    <FolderRow
      icon={<StarIcon size={14} className="fill-current" />}
      label={String(title) || "Untitled"}
      active={active}
      onClick={() => openNew({ type: "sessions", id })}
    />
  );
}
