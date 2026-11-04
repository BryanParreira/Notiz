import { md2json, parseJsonContent } from "@notiz/editor/markdown";

import type * as main from "~/store/tinybase/store/main";

type Node = { type?: string; content?: Node[]; text?: string };

function isBlankParagraph(node: Node) {
  return (
    node.type === "paragraph" &&
    (!node.content || node.content.every((c) => !c.text?.trim() && !c.type))
  );
}

// Adds markdown blocks (lines or "- [ ]" tasks) to the end of a day's note.
export function appendToDailyNote(
  store: main.Store,
  date: string,
  markdown: string,
) {
  const existing = parseJsonContent(
    store.getCell("daily_notes", date, "content") as string | undefined,
  );
  const added = (md2json(markdown).content ?? []) as Node[];
  const kept = [...((existing.content ?? []) as Node[])];
  while (kept.length > 0 && isBlankParagraph(kept[kept.length - 1])) kept.pop();

  store.setPartialRow("daily_notes", date, {
    user_id: String(store.getValue("user_id") ?? ""),
    date,
    content: JSON.stringify({
      ...existing,
      type: "doc",
      content: [...kept, ...added],
    }),
  });
}
