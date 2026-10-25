import { tool } from "ai";
import { z } from "zod";

import { json2md, md2json, parseJsonContent } from "@notiz/editor/markdown";

import type { ToolDependencies } from "./types";

import { usePendingEditStore } from "~/chat/tools/pending-edit-store";
import { extractFirstLineTitle } from "~/session/title-content";
import { id } from "~/shared/utils";

// Small models write "add", "insert" or "rewrite" instead of the exact word.
export function coerceNoteEditMode(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return "append";
  if (typeof value !== "string") return value;

  const mode = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["append", "add", "insert", "extend", "prepend"].includes(mode)) {
    return "append";
  }
  if (
    ["replace_all", "replace", "rewrite", "overwrite", "replace_note"].includes(
      mode,
    )
  ) {
    return "replace_all";
  }
  return value;
}

// Builds the note text the edit would leave behind. The first line of a note is
// its title, so adding to a note never touches it, and a rewrite keeps it unless
// the new text brings its own heading.
export function proposeNoteText({
  currentMarkdown,
  title,
  mode,
  content,
}: {
  currentMarkdown: string;
  title: string;
  mode: "append" | "replace_all";
  content: string;
}) {
  const current = currentMarkdown.trimEnd();
  const text = content.trim();
  const heading = title.trim() ? `# ${title.trim()}` : "";

  if (mode === "append") {
    return [current || heading, text].filter(Boolean).join("\n\n");
  }

  return /^#\s/.test(text) || !heading ? text : `${heading}\n\n${text}`;
}

type NoteStore = NonNullable<ReturnType<ToolDependencies["getStore"]>>;

// Small models fill in `sessionId` with a guess ("week 1 note", "your_note_id")
// even when told it is optional. A guess must not override the note that is
// actually open, so an id is only used when it names a real note; otherwise the
// open note is used, and as a last resort a note whose title matches the words.
export function resolveNoteId(
  store: NoteStore,
  requested: string | undefined,
  current: string | undefined,
): string | undefined {
  if (requested && store.hasRow("sessions", requested)) return requested;
  if (current && store.hasRow("sessions", current)) return current;
  if (!requested) return undefined;

  const wanted = requested
    .toLowerCase()
    .replace(/\bnotes?\b/g, "")
    .trim();
  if (!wanted) return undefined;

  let partial: string | undefined;
  for (const sessionId of store.getRowIds("sessions")) {
    const title = String(store.getCell("sessions", sessionId, "title") ?? "")
      .toLowerCase()
      .trim();
    if (title === wanted) return sessionId;
    if (!partial && title && title.includes(wanted)) partial = sessionId;
  }
  return partial;
}

// The model sometimes sends the same call twice at once. Identical calls share
// one outcome, so the user reviews a change once and the model sees "applied"
// both times instead of getting confused by a second answer.
const RECENT_WINDOW_MS = 60_000;

type EditResult = { status: string; message?: string };

const recentProposals = new Map<
  string,
  { at: number; result: Promise<EditResult> }
>();

export function resetRecentNoteProposals() {
  recentProposals.clear();
}

export const buildEditNoteTool = (
  deps: Pick<ToolDependencies, "getStore" | "getSessionId" | "openEditTab">,
) =>
  tool({
    description: `
Add to, or rewrite, the text of the user's own note. This opens a review where the user approves or declines the change, so nothing changes until they approve.
Use mode "append" to add content to the end of the note (the usual choice). Use "replace_all" only to rewrite the whole note; then send the complete new note.
Write content as real markdown: one "-" bullet per line, with sub-items indented, never a list run together on one line.
Use edit_summary instead for the AI-written summary of a meeting. Never tell the user a note was changed unless this returns status "applied". Call this once per change.
`.trim(),
    inputSchema: z.object({
      sessionId: z
        .string()
        .optional()
        .describe(
          "Leave empty to edit the note that is open. Only set this to an id returned by another tool; never guess one.",
        ),
      mode: z
        .preprocess(coerceNoteEditMode, z.enum(["append", "replace_all"]))
        .describe('"append" adds to the end; "replace_all" rewrites the note'),
      content: z
        .string()
        .min(1)
        .describe(
          "The text to add, or the complete new note for replace_all, in markdown",
        ),
    }),
    execute: async (params: {
      sessionId?: string;
      mode: "append" | "replace_all";
      content: string;
    }) => {
      const store = deps.getStore();
      const sessionId = store
        ? resolveNoteId(store, params.sessionId, deps.getSessionId())
        : undefined;

      if (!store || !sessionId) {
        return {
          status: "error",
          message:
            "No note is open to edit. Ask the user to open the note, or give its sessionId.",
        };
      }

      const rawTitle = store.getCell("sessions", sessionId, "title");
      const title = typeof rawTitle === "string" ? rawTitle : "";
      const raw = store.getCell("sessions", sessionId, "raw_md");
      const currentMarkdown = json2md(
        parseJsonContent(typeof raw === "string" ? raw : undefined),
      );

      const proposed = proposeNoteText({
        currentMarkdown,
        title,
        mode: params.mode,
        content: params.content,
      });

      if (proposed === currentMarkdown.trimEnd()) {
        return { status: "error", message: "That would not change the note." };
      }

      const proposalKey = `${sessionId}|${params.mode}|${params.content.trim()}`;
      const now = Date.now();
      for (const [other, entry] of recentProposals) {
        if (now - entry.at > RECENT_WINDOW_MS) recentProposals.delete(other);
      }
      const shared = recentProposals.get(proposalKey);
      if (shared) return shared.result;

      const outcome = (async (): Promise<EditResult> => {
        const requestId = id();
        const approved = await new Promise<boolean>((resolve) => {
          usePendingEditStore.getState().addEdit({
            requestId,
            sessionId,
            target: "note",
            currentContent: currentMarkdown,
            proposedContent: proposed,
            resolve,
          });
          deps.openEditTab(requestId);
        });

        if (!approved) {
          return {
            status: "declined",
            message: "The user declined the change. The note was not edited.",
          };
        }

        try {
          const json = md2json(proposed);
          const newTitle = extractFirstLineTitle(json);
          store.setPartialRow("sessions", sessionId, {
            raw_md: JSON.stringify(json),
            ...(newTitle !== null ? { title: newTitle } : {}),
          });
        } catch {
          return { status: "error", message: "Failed to apply the note edit." };
        }

        return { status: "applied" };
      })();

      recentProposals.set(proposalKey, { at: now, result: outcome });
      const result = await outcome;
      // Only a change that went through is remembered; a declined or failed one
      // can be asked for again.
      if (result.status !== "applied") recentProposals.delete(proposalKey);
      return result;
    },
  });
