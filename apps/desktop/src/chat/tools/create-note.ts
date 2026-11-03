import { tool } from "ai";
import { z } from "zod";

import { md2json } from "@notiz/editor/markdown";

import { normalizeNoteContent } from "./edit-note";
import type { ToolDependencies } from "./types";

import { createSession } from "~/store/tinybase/store/sessions";

const MAX_TITLE = 80;

export function noteTitle(title: string | undefined, content: string): string {
  const fromHeading = /^#{1,6}\s+(.+)$/m.exec(content)?.[1];
  const raw = (title?.trim() || fromHeading || "New note")
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, MAX_TITLE);
}

export const buildCreateNoteTool = (deps: Pick<ToolDependencies, "getStore">) =>
  tool({
    description:
      `Create a new note, such as a to-do list or plan, in the user's notes. Use "- [ ] item" lines for to-dos. Call once per note.`.trim(),
    inputSchema: z.object({
      title: z.string().optional().describe("Short title for the note"),
      content: z
        .string()
        .min(1)
        .describe("The text of the note in markdown, without the title"),
    }),
    execute: async (params: { title?: string; content: string }) => {
      const store = deps.getStore();
      if (!store) {
        return {
          status: "error",
          message: "Notes are not available right now.",
        };
      }

      const content = normalizeNoteContent(params.content);
      if (!content) {
        return {
          status: "error",
          message: "There is nothing to put in the note. Ask the user.",
        };
      }

      const title = noteTitle(params.title, content);
      try {
        const sessionId = createSession(store, title);
        const body = /^#\s/.test(content)
          ? content
          : `# ${title}\n\n${content}`;
        store.setPartialRow("sessions", sessionId, {
          raw_md: JSON.stringify(md2json(body)),
        });
        return { status: "created", title, sessionId };
      } catch {
        return { status: "error", message: "Failed to create the note." };
      }
    },
  });
