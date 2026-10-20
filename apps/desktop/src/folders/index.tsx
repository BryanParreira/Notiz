import { Trans } from "@lingui/react/macro";
import { FolderIcon, LockIcon } from "lucide-react";

import { NotesList } from "./notes-list";

import { StandardTabWrapper } from "~/shared/main";
import { type Tab } from "~/store/zustand/tabs";

export function TabContentFolders({
  tab,
}: {
  tab: Extract<Tab, { type: "folders" }>;
}) {
  const folderId = tab.id;
  const name = folderId ? (folderId.split("/").pop() ?? folderId) : null;

  return (
    <StandardTabWrapper>
      <div className="scroll-fade-y h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-14 pb-24">
          <header className="flex flex-col items-center gap-3 text-center">
            <span className="bg-secondary text-muted-foreground flex size-11 items-center justify-center rounded-xl">
              {folderId ? (
                <FolderIcon className="size-5" />
              ) : (
                <LockIcon className="size-5" />
              )}
            </span>
            <h1 className="font-display text-foreground text-4xl leading-none">
              {name ?? <Trans>All notes</Trans>}
            </h1>
            <p className="text-muted-foreground text-sm">
              {folderId ? (
                folderId
              ) : (
                <Trans>Every note, stored only on this device.</Trans>
              )}
            </p>
          </header>

          <NotesList
            folderId={folderId}
            empty={
              <p className="text-muted-foreground border-border rounded-2xl border border-dashed px-6 py-12 text-center text-sm">
                {folderId ? (
                  <Trans>
                    This folder is empty. Right-click any note and choose "Move
                    to" to add it here.
                  </Trans>
                ) : (
                  <Trans>No notes yet.</Trans>
                )}
              </p>
            }
          />
        </div>
      </div>
    </StandardTabWrapper>
  );
}
