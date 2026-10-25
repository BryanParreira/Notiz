import { CONTEXT_TEXT_FIELD } from "../tools/context-text";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const MAX_TOOL_STEPS = 4;
export const MESSAGE_WINDOW_THRESHOLD = 20;
export const MESSAGE_WINDOW_SIZE = 10;

export function getSessionIdsFromSearchOutput(output: unknown): string[] {
  if (!isRecord(output) || !Array.isArray(output.results)) {
    return [];
  }
  return output.results.flatMap((item) => {
    if (
      !isRecord(item) ||
      (typeof item.id !== "string" && typeof item.id !== "number")
    ) {
      return [];
    }
    return [String(item.id)];
  });
}

export type ToolOutputPart = {
  type: `tool-${string}`;
  state: "output-available";
  output?: unknown;
  [key: string]: unknown;
};

export function isToolOutputPart(value: unknown): value is ToolOutputPart {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    value.type.startsWith("tool-") &&
    value.state === "output-available"
  );
}

export function hasContextText(output: unknown): boolean {
  if (!isRecord(output)) return false;
  const contextText = output[CONTEXT_TEXT_FIELD];
  return typeof contextText === "string" && contextText.length > 0;
}

// The built-in model has a small memory (a few thousand tokens), and every tool
// offered costs part of it. So each message only gets the tools it could need:
// a question about the calendar sees calendar tools, not all fourteen.
export const TOOL_GROUPS = {
  // Calendar and inbox questions are answered from data the app fetches and
  // hands to the model (see use-transport), because a small model cannot be
  // trusted to call tools for them. They still count as groups so the right
  // data and instructions are chosen.
  calendar: [],
  inbox: [],
  notes: [
    "search_sessions",
    "read_note",
    "read_current_note",
    "grep_notes",
    "list_related_notes",
    "apply_session_correction",
    "edit_summary",
  ],
  contacts: ["search_contacts"],
  web: ["web_search"],
} as const;

export type ToolGroup = keyof typeof TOOL_GROUPS;

const GROUP_HINTS: Record<ToolGroup, RegExp> = {
  calendar:
    /\b(calendar|schedule|agenda|appointments?|events?|today|tonight|tomorrow|this (?:week|weekend|month|morning|afternoon|evening)|next (?:week|month)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|busy|my (?:day|week))\b/i,
  inbox: /\b(inbox|e-?mails?|mail|unread|replied|reply|sent me)\b/i,
  notes:
    /\b(notes?|meetings?|transcripts?|summar(?:y|ies|ize|ise)|recordings?|action items?|follow[- ]?ups?|decided|discuss(?:ed|ion)?|what did (?:i|we)|did (?:i|we))\b/i,
  contacts: /\b(contacts?|phone number)\b/i,
  web: /\b(search the web|look up|google|latest news|news)\b|https?:\/\//i,
};

export function toolGroupsForMessage(text: string): ToolGroup[] {
  return (Object.keys(GROUP_HINTS) as ToolGroup[]).filter((group) =>
    GROUP_HINTS[group].test(text),
  );
}

// A follow-up like "and tomorrow?" has no keywords of its own, so groups whose
// tools were already used in the conversation stay on offer.
export function toolGroupsUsedIn(
  messages: ReadonlyArray<{ parts: ReadonlyArray<{ type: string }> }>,
): ToolGroup[] {
  const used = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type.startsWith("tool-")) used.add(part.type.slice(5));
    }
  }

  return (Object.keys(TOOL_GROUPS) as ToolGroup[]).filter((group) =>
    TOOL_GROUPS[group].some((name) => used.has(name)),
  );
}

export function toolNamesForGroups(groups: Iterable<ToolGroup>): string[] {
  return [...new Set([...groups].flatMap((group) => TOOL_GROUPS[group]))];
}
