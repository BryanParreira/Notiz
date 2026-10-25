import type { NotizUIMessage } from "~/chat/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isToolCallObject(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (isRecord(value.parameters) || isRecord(value.arguments))
  );
}

// Some small models print a tool call as plain text instead of making it, e.g.
// {"name": "search_contacts", "parameters": {...}}. It is never an answer.
export function isStrayToolCallText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }

  try {
    return isToolCallObject(JSON.parse(trimmed));
  } catch {
    return false;
  }
}

// The same call can also turn up in the middle of a sentence ("I'll try again
// {...}"), so cut any balanced {...} that parses as a tool call.
export function stripStrayToolCalls(text: string): string {
  let result = "";
  let index = 0;

  while (index < text.length) {
    if (text[index] !== "{") {
      result += text[index];
      index += 1;
      continue;
    }

    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = index; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (char === "\\") i += 1;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end !== -1 && isStrayToolCallText(text.slice(index, end + 1))) {
      index = end + 1;
      continue;
    }

    result += text[index];
    index += 1;
  }

  return result.replace(/[ \t]+\n/g, "\n").trim();
}

export function hasRenderableParts(parts: unknown): boolean {
  if (!Array.isArray(parts)) {
    return false;
  }

  return parts.some((part) => {
    if (!isRecord(part) || typeof part.type !== "string") {
      return false;
    }

    if (part.type === "step-start") {
      return false;
    }

    if (part.type === "reasoning" || part.type === "text") {
      return (
        typeof part.text === "string" &&
        (part.type === "text"
          ? stripStrayToolCalls(part.text).length > 0
          : part.text.trim().length > 0)
      );
    }

    return true;
  });
}

export function hasRenderableContent(message: NotizUIMessage) {
  return hasRenderableParts(message.parts);
}
