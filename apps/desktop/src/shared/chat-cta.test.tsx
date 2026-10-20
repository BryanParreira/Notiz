import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatMode: "FloatingClosed" as
    | "FloatingClosed"
    | "FloatingOpen"
    | "RightPanelOpen",
  sendEvent: vi.fn(),
}));

vi.mock("~/contexts/shell", () => ({
  useShell: () => ({
    chat: {
      mode: mocks.chatMode,
      sendEvent: mocks.sendEvent,
    },
  }),
}));

import { ChatCTA, FloatingChatCTA } from "./chat-cta";

describe("ChatCTA", () => {
  beforeEach(() => {
    cleanup();
    mocks.chatMode = "FloatingClosed";
    mocks.sendEvent.mockClear();
  });

  it("opens the floating chat", () => {
    render(<ChatCTA />);

    const button = screen.getByRole("button", {
      name: "Ask Notiz anything",
    });

    fireEvent.click(button);

    expect(mocks.sendEvent).toHaveBeenCalledWith({ type: "OPEN" });
  });

  it("is always visible as an input-like pill", () => {
    render(<ChatCTA />);

    const button = screen.getByRole("button", {
      name: "Ask Notiz anything",
    });
    const surface = button.querySelector("[data-chat-cta-surface]");

    expect(button.hasAttribute("data-chat-cta-trigger")).toBe(true);
    expect(button.className).toContain("cursor-text");
    expect(surface?.className).toContain("rounded-full");
    expect(surface?.className).toContain("pointer-events-none");
    expect(screen.getByText("Ask anything")).toBeTruthy();
  });

  it("centres the floating trigger at the bottom", () => {
    render(<FloatingChatCTA />);

    const wrapper = screen.getByRole("button", {
      name: "Ask Notiz anything",
    }).parentElement?.parentElement;

    expect(wrapper?.className).toContain("bottom-4");
    expect(wrapper?.className).toContain("left-1/2");
  });

  it("hides while the floating chat is open", () => {
    mocks.chatMode = "FloatingOpen";

    render(<ChatCTA />);

    expect(
      screen.queryByRole("button", { name: "Ask Notiz anything" }),
    ).toBeNull();
  });

  it("hides while the right panel chat is open", () => {
    mocks.chatMode = "RightPanelOpen";

    render(<ChatCTA />);

    expect(
      screen.queryByRole("button", { name: "Ask Notiz anything" }),
    ).toBeNull();
  });
});
