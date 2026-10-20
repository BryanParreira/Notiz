let pending: string | null = null;

export function setPendingChatPrompt(prompt: string) {
  pending = prompt.trim() || null;
}

export function takePendingChatPrompt(): string | null {
  const prompt = pending;
  pending = null;
  return prompt;
}

export function hasPendingChatPrompt() {
  return pending !== null;
}
