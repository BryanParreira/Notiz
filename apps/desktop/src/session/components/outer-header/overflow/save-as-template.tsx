import { BookmarkPlusIcon } from "lucide-react";

import { json2md, parseJsonContent } from "@notiz/editor/markdown";
import { DropdownMenuItem } from "@notiz/ui/components/ui/dropdown-menu";

import { saveCustomTemplate } from "~/shared/note-templates";
import { showTransientToast } from "~/sidebar/toast/transient";
import * as main from "~/store/tinybase/store/main";

export function SaveAsTemplate({ sessionId }: { sessionId: string }) {
  const store = main.UI.useStore(main.STORE_ID);

  const save = () => {
    if (!store) return;
    const doc = parseJsonContent(
      store.getCell("sessions", sessionId, "raw_md") as string | undefined,
    );
    // The first block is the note's title, which the template carries separately.
    const body = json2md({
      ...doc,
      content: (doc.content ?? []).slice(1),
    }).trim();
    const title = String(store.getCell("sessions", sessionId, "title") ?? "");

    if (!body) {
      showTransientToast({
        description: "Write something below the title first.",
        variant: "error",
      });
      return;
    }

    saveCustomTemplate(title, body);
    showTransientToast({ description: "Saved as a template" });
  };

  return (
    <DropdownMenuItem onClick={save} className="cursor-pointer">
      <BookmarkPlusIcon />
      <span>Save as template</span>
    </DropdownMenuItem>
  );
}
