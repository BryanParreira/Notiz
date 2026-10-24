import type { NotizUIMessage } from "~/chat/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Some small models print a tool call as plain text instead of making it, e.g.
// {"name": "search_contacts", "parameters": {...}}. It is never an answer.
export function isStrayToolCallText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }

  try {
    const value: unknown = JSON.parse(trimmed);
    return (
      isRecord(value) &&
      typeof value.name === "string" &&
      (isRecord(value.parameters) || isRecord(value.arguments))
    );
  } catch {
    return false;
  }
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
        part.text.trim().length > 0 &&
        !(part.type === "text" && isStrayToolCallText(part.text))
      );
    }

    return true;
  });
}

export function hasRenderableContent(message: NotizUIMessage) {
  return hasRenderableParts(message.parts);
}
