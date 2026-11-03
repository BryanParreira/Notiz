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
    "edit_note",
  ],
  // Making a brand-new note or to-do list. Kept apart from "notes" so a question
  // about past meetings does not carry the note-writing rules.
  tasks: ["create_note"],
  // Drafting emails and messages. No tools, only the writing rules.
  writing: [],
  contacts: ["search_contacts"],
  // Adding an event to Apple Calendar. Offered only when the message asks for it.
  events: ["create_calendar_event"],
} as const;

export type ToolGroup = keyof typeof TOOL_GROUPS;

const GROUP_HINTS: Record<ToolGroup, RegExp> = {
  // Only words that clearly point at the calendar. A bare "week" or "plans" is
  // not enough: "add this to the week 1 note" is about a note, not a schedule.
  calendar:
    /\b(calendar|schedule|agenda|appointments?|today|tonight|tomorrow|this (?:week|weekend|month|morning|afternoon|evening)|next (?:week|month)|upcoming|coming up|monday|tuesday|wednesday|thursday|friday|saturday|sunday|busy|free (?:time|slot|on|at|today|tomorrow)|what do i have|my (?:day|week))\b/i,
  inbox: /\b(inbox|e-?mails?|mail|unread|replied|reply|sent me)\b/i,
  notes:
    /\b(notes?|transcripts?|summar(?:y|ies|ize|ise)|recordings?|action items?|follow[- ]?ups?|decided|discuss(?:ed|ion)?|what did (?:i|we)|did (?:i|we)|(?:my|our|the|last|yesterday'?s|that|this) meetings?)\b/i,
  contacts: /\b(contacts?|phone number)\b/i,
  writing:
    /\b(?:draft|compose|write|rewrite)\b[^.?!]{0,30}\b(?:e-?mails?|messages?|repl(?:y|ies)|letter|text)\b|\b(?:reply|respond)\b[^.?!]{0,20}\b(?:to|with)\b|\bhelp me (?:say|word|phrase)\b/i,
  tasks:
    /\b(?:create|make|start|new)\b[^.?!]{0,40}\b(?:notes?|to-?do(?:s| list)?|checklist|task list)\b|\b(?:to-?do|checklist)s?\b/i,
  events:
    /\b(?:add|create|schedule|book|set up|block off)\b.*\b(?:event|meeting|appointment|call|lunch|dinner|class|session|reminder|study|workout|gym)\b|\b(?:add|put)\b.*\bcalendar\b|\bschedule (?:a|an|the)\b/i,
};

const ABOUT_PAST_NOTES =
  /\b(meetings?|transcripts?|summar(?:y|ies|ize|ise)|what did (?:i|we)|did (?:i|we))\b/i;

export function toolGroupsForMessage(text: string): ToolGroup[] {
  const groups = (Object.keys(GROUP_HINTS) as ToolGroup[]).filter((group) =>
    GROUP_HINTS[group].test(text),
  );

  // "Make a note with a to-do list" only needs the tool that makes a note; the
  // rules for searching past meetings would just use up the model's memory.
  return groups.includes("tasks") && !ABOUT_PAST_NOTES.test(text)
    ? groups.filter((group) => group !== "notes")
    : groups;
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

const SMALL_TALK =
  /^(hi|hello|hey|hiya|yo|sup|thanks|thank you|thx|ok|okay|cool|great|nice|good (?:morning|afternoon|evening|night)|how are you|how's it going|what's up|whats up)\b[\s\p{P}\p{S}]*(?:there|again|friend|buddy)?[\s\p{P}\p{S}]*$/iu;

// A greeting needs a greeting back, not the user's week. Skipping the calendar
// and inbox for these also makes the reply start sooner.
export function isSmallTalk(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 40 && SMALL_TALK.test(trimmed);
}

// Asking to see the calendar or the inbox is answered with a card and nothing
// else, and only when it really is a request to look. Anything that changes or
// mentions notes, asks for a judgement or asks for writing needs the model.
const SHOW_ME =
  /\b(what|what's|whats|which|any|anything|do i have|have i|show|check|list|open|see|look|am i|are there|is there|unread|new|latest|upcoming)\b/i;

const NEEDS_THE_MODEL =
  /\b(draft|reply|respond|write|rewrite|compose|summar(?:y|ies|ize|ise)|explain|plan|prepare|prep|prioriti(?:s|z)e|should|suggest|recommend|help me|remind|compare|why|how|analy(?:s|z)e|add|put|insert|append|save|copy|paste|update|edit|change|rename|delete|remove|create|book|set up|block off|schedule (?:a|an|the|my)|translate|notes?)\b|\b(?:is|was|are)\b.*\babout\b/i;

export function wantsCardOnly(text: string): boolean {
  return SHOW_ME.test(text) && !NEEDS_THE_MODEL.test(text);
}
