import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/shared/main", () => ({
  StandardTabWrapper: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/shared/useNewNote", () => ({
  useNewNote: () => vi.fn(),
}));

vi.mock("~/contexts/shell", () => ({
  useShell: () => ({
    chat: {
      mode: "FloatingClosed",
      sendEvent: vi.fn(),
    },
  }),
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (selector: (state: { openCurrent: () => void }) => unknown) =>
    selector({
      openCurrent: vi.fn(),
    }),
}));

vi.mock("~/store/tinybase/store/main", () => ({
  STORE_ID: "main",
  UI: {
    useTable: () => ({}),
    useStore: () => undefined,
  },
}));

vi.mock("~/store/tinybase/store/sessions", () => ({
  getOrCreateSessionForEventId: vi.fn(),
}));

vi.mock("~/folders/notes-list", () => ({
  NotesList: ({ empty }: { empty: React.ReactNode }) => <>{empty}</>,
}));

import { TabContentEmpty } from "./empty";

describe("TabContentEmpty", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows upcoming events, an empty-notes prompt and the ask bar", () => {
    render(
      <TabContentEmpty
        tab={{
          type: "empty",
          active: true,
          slotId: "",
          pinned: false,
        }}
      />,
    );

    expect(screen.getByText("Coming up")).toBeTruthy();
    expect(screen.getByText("No events today")).toBeTruthy();
    expect(
      screen.getByText(
        "Your notes live only on this device. Start your first one.",
      ),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Ask anything")).toBeTruthy();
  });
});
