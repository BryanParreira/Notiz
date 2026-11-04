import { commands as windowsCommands } from "@notiz/plugin-windows";

const STORAGE_KEY = "notiz-quick-capture-hotkey";
export const DEFAULT_CAPTURE_HOTKEY = "Control+Alt+N";

// Stored value: undefined = default, "" = turned off.
export function readCaptureHotkey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CAPTURE_HOTKEY;
  } catch {
    return DEFAULT_CAPTURE_HOTKEY;
  }
}

export async function applyCaptureHotkey(accelerator: string) {
  const result = await windowsCommands.captureSetHotkey(accelerator || null);
  if (result.status === "error") throw new Error(result.error);
  try {
    localStorage.setItem(STORAGE_KEY, accelerator);
  } catch {}
}

const SYMBOLS: Record<string, string> = {
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Super: "⌘",
};

export function formatHotkey(accelerator: string) {
  if (!accelerator) return "Off";
  return accelerator
    .split("+")
    .map((part) => SYMBOLS[part] ?? part)
    .join(" ");
}

const NAMED_KEYS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
};

// Turns a keydown into a Tauri accelerator, or null if it is not a valid
// shortcut yet (no modifier, or only a modifier pressed).
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  const modifiers = [
    event.ctrlKey && "Control",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
  ].filter(Boolean) as string[];

  if (modifiers.length === 0) return null;
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;

  const code = event.code;
  let key: string | undefined = NAMED_KEYS[event.key];
  if (!key && /^Key[A-Z]$/.test(code)) key = code.slice(3);
  if (!key && /^Digit[0-9]$/.test(code)) key = code.slice(5);
  if (!key && /^F([1-9]|1[0-2])$/.test(event.key)) key = event.key;
  if (!key) return null;

  return [...modifiers, key].join("+");
}
