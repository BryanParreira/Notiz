import { Trans } from "@lingui/react/macro";
import {
  FileDownIcon,
  MoreHorizontalIcon,
  LayoutTemplateIcon,
  SquareArrowOutUpRightIcon,
  StarIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@notiz/ui/components/ui/button";
import {
  AppFloatingPanel,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@notiz/ui/components/ui/dropdown-menu";

import { DeleteNote } from "./delete";
import { ExportModal } from "./export-modal";
import { ShowInFinder } from "./misc";
import { SaveAsTemplate } from "./save-as-template";

import { openStandaloneNoteWindow } from "~/session/window";
import { toggleStarred, useStarredIds } from "~/shared/starred";
import { openTemplatePickerForNote } from "~/shared/template-picker";

export function OverflowButton({
  standaloneWindow = false,
  sessionId,
}: {
  standaloneWindow?: boolean;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const starred = useStarredIds().includes(sessionId);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const openExportModal = () => {
    setOpen(false);
    requestAnimationFrame(() => setIsExportModalOpen(true));
  };
  const handleOpenStandaloneWindow = () => {
    setOpen(false);
    void openStandaloneNoteWindow(sessionId);
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            data-tauri-drag-region="false"
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-full"
          >
            <MoreHorizontalIcon size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent variant="app" align="end" className="w-56">
          <AppFloatingPanel className="overflow-hidden p-1">
            <DropdownMenuItem
              onClick={openExportModal}
              className="cursor-pointer"
            >
              <FileDownIcon />
              <span>
                <Trans>Export</Trans>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => toggleStarred(sessionId)}
              className="cursor-pointer"
            >
              <StarIcon className={starred ? "fill-current" : undefined} />
              <span>{starred ? "Unstar" : "Star"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setOpen(false);
                openTemplatePickerForNote(sessionId);
              }}
              className="cursor-pointer"
            >
              <LayoutTemplateIcon />
              <span>Insert template…</span>
            </DropdownMenuItem>
            <SaveAsTemplate sessionId={sessionId} />
            <DropdownMenuSeparator />
            {!standaloneWindow && (
              <DropdownMenuItem
                onClick={handleOpenStandaloneWindow}
                className="cursor-pointer"
              >
                <SquareArrowOutUpRightIcon />
                <span>
                  <Trans>Open in New Window</Trans>
                </span>
              </DropdownMenuItem>
            )}
            <ShowInFinder sessionId={sessionId} />
            <DeleteNote sessionId={sessionId} />
          </AppFloatingPanel>
        </DropdownMenuContent>
      </DropdownMenu>
      <ExportModal
        sessionId={sessionId}
        open={isExportModalOpen}
        onOpenChange={setIsExportModalOpen}
      />
    </>
  );
}
