import { tool } from "ai";
import { z } from "zod";

import { json2md, md2json, parseJsonContent } from "@notiz/editor/markdown";

import { lenientBoolean } from "./lenient";
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

// The most recent thing the assistant said in words, taken from the messages the
// model is working from. "Add that to my note" means this, so the model does not
// have to retype it (which is slow, and is where long tool calls get cut off).
export function lastAssistantText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message?.role !== "assistant") continue;

    const text = Array.isArray(message.content)
      ? message.content
          .flatMap((part: { type?: string; text?: string }) =>
            part?.type === "text" && typeof part.text === "string"
              ? [part.text]
              : [],
          )
          .join("\n")
      : typeof message.content === "string"
        ? message.content
        : "";

    if (text.trim()) return text.trim();
  }

  return null;
}

// Small models sometimes write a line break as the two characters \n instead of
// a real one. If the text has no real line breaks but is full of those, they
// are turned back into line breaks.
export function normalizeNoteContent(text: string): string {
  const realBreaks = (text.match(/\n/g) ?? []).length;
  const escaped = (text.match(/\\n/g) ?? []).length;
  // One lone "\\n" could be part of a path; a model's escaped list has several.
  if (escaped < 2 || realBreaks >= escaped) return text.trim();

  return text.replace(/\\n/g, "\n").replace(/\\t/g, "  ").trim();
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

// The model sometimes sends the same call twice at once. Identical calls that
// are in progress together share one outcome, so the user reviews a change once
// and the model sees "applied" both times. Nothing is remembered afterwards: a
// finished edit must never stop the same text being added again later (say,
// after the user undid it).
type EditResult = { status: string; message?: string };

const inFlightProposals = new Map<string, Promise<EditResult>>();

export function resetRecentNoteProposals() {
  inFlightProposals.clear();
}

// "Add that to my note" and "put this in the note" mean the assistant's last
// reply. The model is asked to say so, but it often retypes part of it instead,
// so the words the user wrote decide. Text after a colon is new content.
export function refersToPreviousReply(userText: string): boolean {
  if (/:\s*\S/.test(userText)) return false;

  return /\b(add|put|save|write|copy|paste|insert|append|move)\b[^.?!]{0,30}\b(that|this|those|these|it|the above|the list|the plan)\b/i.test(
    userText,
  );
}

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message?.role !== "user") continue;

    return Array.isArray(message.content)
      ? message.content
          .flatMap((part: { type?: string; text?: string }) =>
            part?.type === "text" && typeof part.text === "string"
              ? [part.text]
              : [],
          )
          .join(" ")
      : typeof message.content === "string"
        ? message.content
        : "";
  }
  return "";
}

export const buildEditNoteTool = (
  deps: Pick<ToolDependencies, "getStore" | "getSessionId" | "openEditTab">,
) =>
  tool({
    description:
      `Add to, or rewrite, the user's own note after they approve it. For something you already wrote, set use_previous_reply and leave content out. Mode "append" adds to the end; "replace_all" rewrites the whole note (send the complete note). Write content as markdown, one "-" bullet per line. Call once per change.`.trim(),
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
        .optional()
        .describe(
          "The text to add, or the complete new note for replace_all, in markdown. Leave out when use_previous_reply is true.",
        ),
      use_previous_reply: lenientBoolean().describe(
        "True to use your previous reply as the content instead of retyping it",
      ),
    }),
    execute: async (
      params: {
        sessionId?: string;
        mode: "append" | "replace_all";
        content?: string;
        use_previous_reply?: boolean;
      },
      options?: { messages?: unknown },
    ) => {
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

      const usePrevious =
        params.use_previous_reply === true ||
        !params.content?.trim() ||
        refersToPreviousReply(lastUserText(options?.messages));
      const wanted = usePrevious
        ? (lastAssistantText(options?.messages) ?? params.content)
        : params.content;
      if (!wanted) {
        return {
          status: "error",
          message:
            "There is nothing to add. Give the text to add, or ask the user what to put in the note.",
        };
      }
      const content = normalizeNoteContent(wanted);

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
        content,
      });

      if (proposed === currentMarkdown.trimEnd()) {
        return { status: "error", message: "That would not change the note." };
      }

      const proposalKey = `${sessionId}|${params.mode}|${content}`;
      const shared = inFlightProposals.get(proposalKey);
      if (shared) return shared;

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

      inFlightProposals.set(proposalKey, outcome);
      try {
        return await outcome;
      } finally {
        inFlightProposals.delete(proposalKey);
      }
    },
  });
