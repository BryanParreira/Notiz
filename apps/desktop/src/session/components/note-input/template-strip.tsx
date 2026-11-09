import { Trans } from "@lingui/react/macro";
import { LayoutTemplateIcon } from "lucide-react";
import { useMemo } from "react";

import type { JSONContent } from "@notiz/editor/note";

import {
  BUILT_IN_TEMPLATES,
  insertTemplateIntoNote,
} from "~/shared/note-templates";
import {
  openTemplatePickerForNote,
  templateIcon,
} from "~/shared/template-picker";
import * as main from "~/store/tinybase/store/main";

// Shown under an empty note so a template is one click away without leaving
// the page.
const SUGGESTED = ["meeting", "checklist", "project", "journal"];

export function TemplateStrip({ sessionId }: { sessionId: string }) {
  // Own subscription so typing only re-renders this small strip.
  const rawMd = main.UI.useCell("sessions", sessionId, "raw_md", main.STORE_ID);
  const empty = useMemo(() => isBodyEmpty(rawMd), [rawMd]);
  if (!empty) return null;

  const suggested = SUGGESTED.map((id) =>
    BUILT_IN_TEMPLATES.find((template) => template.id === id),
  ).filter((template) => template !== undefined);

  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-1.5"
      data-tauri-drag-region="false"
    >
      <span className="text-muted-foreground mr-1 text-xs">
        <Trans>Start with</Trans>
      </span>
      {suggested.map((template) => {
        const Icon = templateIcon(template);
        return (
          <button
            key={template.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              insertTemplateIntoNote(sessionId, template);
            }}
            className="border-border text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors"
          >
            <Icon size={13} strokeWidth={1.75} />
            {template.title}
          </button>
        );
      })}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          openTemplatePickerForNote(sessionId);
        }}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors"
      >
        <LayoutTemplateIcon size={13} strokeWidth={1.75} />
        <Trans>Browse all</Trans>
      </button>
    </div>
  );
}

function text(node: JSONContent | undefined): string {
  if (!node) return "";
  if (node.text) return node.text;
  return (node.content ?? []).map(text).join("");
}

// A note counts as empty when nothing follows the title line.
function isBodyEmpty(rawMd: unknown): boolean {
  if (typeof rawMd !== "string" || !rawMd.trim()) return true;
  try {
    const doc = JSON.parse(rawMd) as JSONContent;
    return (doc.content ?? [])
      .slice(1)
      .every((node) => node.type === "paragraph" && !text(node).trim());
  } catch {
    return false;
  }
}
