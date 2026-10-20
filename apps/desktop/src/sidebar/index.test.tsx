import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentTab: { type: "empty" } as { type: string } | null,
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (
    selector: (state: {
      currentTab: typeof mocks.currentTab;
      openCurrent: () => void;
      openNew: () => void;
    }) => unknown,
  ) =>
    selector({
      currentTab: mocks.currentTab,
      openCurrent: vi.fn(),
      openNew: vi.fn(),
    }),
}));

vi.mock("~/sidebar/folders", () => ({
  SidebarFolders: () => <div data-testid="folders" />,
}));

vi.mock("~/contexts/shell", () => ({
  useShell: () => ({
    chat: { mode: "FloatingClosed", sendEvent: vi.fn() },
  }),
}));

vi.mock("~/sidebar/toast", () => ({
  ToastArea: () => <div data-testid="toast-area" />,
}));

vi.mock("~/sidebar/calendar", () => ({
  CalendarNav: () => <div data-testid="calendar-nav" />,
}));

vi.mock("~/sidebar/contacts", () => ({
  ContactsNav: () => <div data-testid="contacts-nav" />,
}));

vi.mock("~/sidebar/settings", () => ({
  SettingsNav: () => <div data-testid="settings-nav" />,
}));

vi.mock("~/sidebar/templates", () => ({
  TemplatesNav: () => <div data-testid="templates-nav" />,
}));

import { LeftSidebar } from "./index";

describe("LeftSidebar", () => {
  beforeEach(() => {
    mocks.currentTab = { type: "empty" };
  });

  it("shows the nav, folders and footer below the window chrome", () => {
    const { container } = render(<LeftSidebar />);

    expect(screen.getByTestId("folders")).toBeTruthy();
    expect(container.firstElementChild?.className).toContain("pt-0");
    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Chat")).toBeTruthy();
    expect(screen.getByLabelText("Private, on this device")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it.each([
    ["settings", "settings-nav"],
    ["calendar", "calendar-nav"],
    ["contacts", "contacts-nav"],
    ["templates", "templates-nav"],
  ])("keeps %s below the window chrome", (type, testId) => {
    mocks.currentTab = { type };

    const { container } = render(<LeftSidebar />);
    const classList = container.firstElementChild?.className.split(" ") ?? [];

    expect(screen.getByTestId(testId)).toBeTruthy();
    expect(classList).toContain("pt-11");
    expect(classList).not.toContain("pt-0");
  });
});
