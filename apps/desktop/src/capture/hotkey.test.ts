import { describe, expect, test } from "vitest";

import { acceleratorFromEvent, formatHotkey } from "./hotkey";

function key(init: Partial<KeyboardEvent> & { key: string; code: string }) {
  return init as KeyboardEvent;
}

describe("acceleratorFromEvent", () => {
  test("builds an accelerator from modifiers and a letter", () => {
    expect(
      acceleratorFromEvent(
        key({ key: "n", code: "KeyN", ctrlKey: true, altKey: true }),
      ),
    ).toBe("Control+Alt+N");
  });

  test("uses Super for the command key and names Space", () => {
    expect(
      acceleratorFromEvent(
        key({ key: " ", code: "Space", metaKey: true, shiftKey: true }),
      ),
    ).toBe("Shift+Super+Space");
  });

  test("handles digits and function keys", () => {
    expect(
      acceleratorFromEvent(key({ key: "1", code: "Digit1", altKey: true })),
    ).toBe("Alt+1");
    expect(
      acceleratorFromEvent(key({ key: "F5", code: "F5", ctrlKey: true })),
    ).toBe("Control+F5");
  });

  test("rejects a shortcut with no modifier", () => {
    expect(acceleratorFromEvent(key({ key: "n", code: "KeyN" }))).toBeNull();
  });

  test("waits while only a modifier is held", () => {
    expect(
      acceleratorFromEvent(
        key({ key: "Control", code: "ControlLeft", ctrlKey: true }),
      ),
    ).toBeNull();
  });
});

describe("two-key shortcuts", () => {
  test("accepts a single modifier with Space", () => {
    expect(
      acceleratorFromEvent(key({ key: " ", code: "Space", ctrlKey: true })),
    ).toBe("Control+Space");
  });

  test("accepts punctuation keys by their code", () => {
    expect(
      acceleratorFromEvent(key({ key: ";", code: "Semicolon", metaKey: true })),
    ).toBe("Super+Semicolon");
  });
});

describe("formatHotkey", () => {
  test("shows punctuation as the character", () => {
    expect(formatHotkey("Super+Semicolon")).toBe("⌘ ;");
  });

  test("shows macOS symbols", () => {
    expect(formatHotkey("Control+Alt+N")).toBe("⌃ ⌥ N");
  });

  test("shows Off when cleared", () => {
    expect(formatHotkey("")).toBe("Off");
  });
});
