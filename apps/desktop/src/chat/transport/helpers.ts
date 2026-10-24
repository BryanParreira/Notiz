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

const SMALL_TALK =
  /^(hi|hello|hey|hiya|yo|sup|thanks|thank you|thx|ok|okay|cool|great|nice|good (morning|afternoon|evening|night)|how are you|how's it going|what's up|whats up)\b[\s\p{P}\p{S}]*(there|again|friend)?[\s\p{P}\p{S}]*$/iu;

// Small local models grab a tool for "hello" and then fail or print the raw
// call. Greetings never need the user's notes, so they get no tools at all.
export function isSmallTalk(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 40 && SMALL_TALK.test(trimmed);
}
