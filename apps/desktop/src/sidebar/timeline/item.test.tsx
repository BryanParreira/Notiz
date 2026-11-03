import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addDeletion: vi.fn(),
  amplitude: { mic: 0.4, speaker: 0.3 },
  ignoreEvent: vi.fn(),
  invalidateResource: vi.fn(),
  isIgnored: vi.fn(() => false),
  openCurrent: vi.fn(),
  openNew: vi.fn(),
  sessionMode: "inactive",
  stop: vi.fn(),
  storeTitle: "Live Note",
  summaryContent: undefined as string | undefined,
  nativeContextMenus: [] as Array<
    Array<{
      id?: string;
      text?: string;
      action?: () => void;
      separator?: boolean;
    }>
  >,
  timelineSelection: {
    selectedIds: [] as string[],
    setAnchor: vi.fn(),
    selectRange: vi.fn(),
    toggleSelect: vi.fn(),
  },
  windowShow: vi.fn(() => Promise.resolve({ status: "ok", data: null })),
}));

vi.mock("@notiz/plugin-fs-sync", () => ({
  commands: {
    sessionDir: vi.fn(() => Promise.resolve({ status: "ok", data: "" })),
  },
}));

vi.mock("@notiz/plugin-opener2", () => ({
  commands: {
    openPath: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@notiz/plugin-windows", () => ({
  commands: {
    windowShow: mocks.windowShow,
  },
}));

vi.mock("@notiz/ui/components/ui/dancing-sticks", () => ({
  DancingSticks: ({ amplitude }: { amplitude: number }) => (
    <span data-amplitude={amplitude} data-testid="dancing-sticks" />
  ),
}));

vi.mock("@notiz/ui/components/ui/spinner", () => ({
  Spinner: () => <span data-testid="spinner" />,
}));

vi.mock("@notiz/ui/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/session/hooks/useEnhancedNotes", () => ({
  useIsSessionEnhancing: () => false,
}));

vi.mock("~/shared/hooks/useNativeContextMenu", () => ({
  useNativeContextMenu: (
    menu: Array<{
      id?: string;
      text?: string;
      action?: () => void;
      separator?: boolean;
    }>,
  ) => {
    mocks.nativeContextMenus.push(menu);
    return vi.fn();
  },
}));

vi.mock("~/store/tinybase/hooks", () => ({
  useIgnoredEvents: () => ({
    ignoreEvent: mocks.ignoreEvent,
    ignoreSeries: vi.fn(),
    isIgnored: mocks.isIgnored,
    unignoreEvent: vi.fn(),
    unignoreSeries: vi.fn(),
  }),
}));

vi.mock("~/store/tinybase/store/deleteSession", () => ({
  captureSessionData: vi.fn(() => null),
  deleteSessionCascade: vi.fn(),
  finalizeSessionDeletion: vi.fn(),
}));

vi.mock("~/store/tinybase/store/main", () => ({
  STORE_ID: "main",
  INDEXES: { enhancedNotesBySession: "enhancedNotesBySession" },
  UI: {
    useCell: (_tableId: string, _rowId: string, cellId: string) =>
      cellId === "raw_md" ? mocks.summaryContent : mocks.storeTitle,
    useIndexes: () => ({}),
    useRow: () => null,
    useSliceRowIds: () => (mocks.summaryContent ? ["note-1"] : []),
    useStore: () => ({}),
  },
}));

vi.mock("~/store/zustand/live-title", () => ({
  useSessionTitle: (_sessionId: string, storeTitle: string | undefined) =>
    storeTitle,
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (
    selector: (state: {
      invalidateResource: typeof mocks.invalidateResource;
      openCurrent: typeof mocks.openCurrent;
      openNew: typeof mocks.openNew;
    }) => unknown,
  ) =>
    selector({
      invalidateResource: mocks.invalidateResource,
      openCurrent: mocks.openCurrent,
      openNew: mocks.openNew,
    }),
}));

vi.mock("~/store/zustand/timeline-selection", () => ({
  useTimelineSelection: Object.assign(
    (selector: (state: typeof mocks.timelineSelection) => unknown) =>
      selector(mocks.timelineSelection),
    {
      getState: () => mocks.timelineSelection,
    },
  ),
}));

vi.mock("~/store/zustand/undo-delete", () => ({
  useUndoDelete: (
    selector: (state: { addDeletion: typeof mocks.addDeletion }) => unknown,
  ) => selector({ addDeletion: mocks.addDeletion }),
}));

vi.mock("~/stt/contexts", () => ({
  useListener: (
    selector: (state: {
      getSessionMode: (sessionId: string) => string;
      live: { amplitude: { mic: number; speaker: number } };
      stop: typeof mocks.stop;
    }) => unknown,
  ) =>
    selector({
      getSessionMode: () => mocks.sessionMode,
      live: { amplitude: mocks.amplitude },
      stop: mocks.stop,
    }),
}));

import { TimelineItemComponent } from "./item";

describe("TimelineItemComponent", () => {
  beforeEach(() => {
    cleanup();
    mocks.amplitude = { mic: 0.4, speaker: 0.3 };
    mocks.sessionMode = "inactive";
    mocks.storeTitle = "Live Note";
    mocks.stop.mockClear();
    mocks.openCurrent.mockClear();
    mocks.openNew.mockClear();
    mocks.windowShow.mockClear();
    mocks.nativeContextMenus = [];
    mocks.summaryContent = undefined;
    mocks.timelineSelection.selectedIds = [];
    mocks.timelineSelection.setAnchor.mockClear();
    mocks.timelineSelection.selectRange.mockClear();
    mocks.timelineSelection.toggleSelect.mockClear();
  });

  it("previews the start of the note next to the time", () => {
    mocks.sessionMode = "inactive";
    mocks.summaryContent = "Live Note Math assignment is due Friday";

    render(
      <TimelineItemComponent
        item={{
          type: "session",
          id: "session-1",
          data: {
            title: "Live Note",
            created_at: "2024-01-15T10:30:00.000Z",
          },
        }}
        precision="time"
        selected={false}
        timezone="UTC"
        multiSelected={false}
        flatItemKeys={["session-session-1"]}
      />,
    );

    expect(screen.getByText("Math assignment is due Friday")).toBeTruthy();
  });

  it("exposes the selected session row for sidebar scroll anchoring", () => {
    const selectedNodeRef = vi.fn();

    render(
      <TimelineItemComponent
        item={{
          type: "session",
          id: "session-live",
          data: {
            title: "Live Note",
            created_at: "2024-01-15T10:30:00.000Z",
          },
        }}
        precision="time"
        selected
        selectedNodeRef={selectedNodeRef}
        timezone="UTC"
        multiSelected={false}
        flatItemKeys={["session-session-live"]}
      />,
    );

    const row = screen
      .getByText("Live Note")
      .closest("[data-sidebar-timeline-session-id]");

    expect(row?.getAttribute("data-sidebar-timeline-session-id")).toBe(
      "session-live",
    );
    expect(selectedNodeRef.mock.calls.some(([node]) => node === row)).toBe(
      true,
    );
  });

  it("highlights an upcoming meeting row", () => {
    render(
      <TimelineItemComponent
        item={{
          type: "event",
          id: "event-standup",
          data: {
            title: "Team standup",
            started_at: "2024-01-15T10:30:00.000Z",
            ended_at: "2024-01-15T11:00:00.000Z",
            tracking_id_event: "tracking-standup",
            has_recurrence_rules: false,
          },
        }}
        precision="time"
        selected={false}
        timezone="UTC"
        multiSelected={false}
        flatItemKeys={["event-event-standup"]}
        isUpcoming
        upcomingLabel="In 4 minutes"
      />,
    );

    const rowButton = screen.getByText("Team standup").closest("button");
    const countdown = screen.getByText("In 4 minutes");

    expect(rowButton?.className).toContain("bg-destructive/8");
    expect(rowButton?.className).not.toContain("motion-safe:animate-pulse");
    expect(rowButton?.className).not.toContain("shadow-[0_0_22px");
    expect(rowButton?.className).not.toContain("ring-1");
    expect(rowButton?.className).not.toContain("opacity-65");
    expect(
      countdown.getAttribute("data-sidebar-timeline-upcoming-countdown"),
    ).toBe("true");
    expect(countdown.className).toContain("bg-destructive");
    expect(countdown.className).toContain("w-24");
    expect(countdown.className).toContain("justify-center");
  });

  it("does not render a countdown chip on non-upcoming rows", () => {
    render(
      <TimelineItemComponent
        item={{
          type: "event",
          id: "event-standup",
          data: {
            title: "Team standup",
            started_at: "2024-01-15T10:30:00.000Z",
            ended_at: "2024-01-15T11:00:00.000Z",
            tracking_id_event: "tracking-standup",
            has_recurrence_rules: false,
          },
        }}
        precision="time"
        selected={false}
        timezone="UTC"
        multiSelected={false}
        flatItemKeys={["event-event-standup"]}
        upcomingLabel="In 4 minutes"
      />,
    );

    expect(screen.queryByText("In 4 minutes")).toBeNull();
  });

  it("exposes an arbitrary timeline row for visibility checks", () => {
    const itemNodeRef = vi.fn();

    render(
      <TimelineItemComponent
        item={{
          type: "event",
          id: "event-standup",
          data: {
            title: "Team standup",
            started_at: "2024-01-15T10:30:00.000Z",
            ended_at: "2024-01-15T11:00:00.000Z",
            tracking_id_event: "tracking-standup",
            has_recurrence_rules: false,
          },
        }}
        precision="time"
        selected={false}
        timezone="UTC"
        multiSelected={false}
        flatItemKeys={["event-event-standup"]}
        itemNodeRef={itemNodeRef}
      />,
    );

    const row = screen
      .getByText("Team standup")
      .closest("button")?.parentElement;

    expect(itemNodeRef.mock.calls.some(([node]) => node === row)).toBe(true);
  });

  it("opens the current tab after a single-click on a session row", () => {
    render(
      <TimelineItemComponent
        item={{
          type: "session",
          id: "session-note",
          data: {
            title: "Window Note",
            created_at: "2024-01-15T10:30:00.000Z",
          },
        }}
        precision="time"
        selected={false}
        timezone="UTC"
        multiSelected={false}
        flatItemKeys={["session-session-note"]}
      />,
    );

    const rowButton = screen.getByText("Live Note").closest("button");
    fireEvent.click(rowButton!, { detail: 1 });

    expect(mocks.timelineSelection.setAnchor).toHaveBeenCalledWith(
      "session-session-note",
    );
    expect(mocks.openCurrent).toHaveBeenCalledWith({
      id: "session-note",
      type: "sessions",
    });
  });

  it("opens a standalone note window when a session row is double-clicked", () => {
    render(
      <TimelineItemComponent
        item={{
          type: "session",
          id: "session-note-window",
          data: {
            title: "Window Note",
            created_at: "2024-01-15T10:30:00.000Z",
          },
        }}
        precision="time"
        selected={false}
        timezone="UTC"
        multiSelected={false}
        flatItemKeys={["session-session-note-window"]}
      />,
    );

    const rowButton = screen.getByText("Live Note").closest("button");
    fireEvent.click(rowButton!, { detail: 1 });
    fireEvent.click(rowButton!, { detail: 2 });
    fireEvent.doubleClick(rowButton!);

    expect(mocks.openCurrent).toHaveBeenCalledTimes(1);
    expect(mocks.openCurrent).toHaveBeenCalledWith({
      id: "session-note-window",
      type: "sessions",
    });
    expect(mocks.timelineSelection.setAnchor).toHaveBeenCalledTimes(1);
    expect(mocks.timelineSelection.setAnchor).toHaveBeenCalledWith(
      "session-session-note-window",
    );
    expect(mocks.windowShow).toHaveBeenCalledWith({
      type: "note",
      value: "session-note-window",
    });
  });

  it("offers a standalone window action instead of a new tab action for session rows", () => {
    render(
      <TimelineItemComponent
        item={{
          type: "session",
          id: "session-note-window",
          data: {
            title: "Window Note",
            created_at: "2024-01-15T10:30:00.000Z",
          },
        }}
        precision="time"
        selected={false}
        timezone="UTC"
        multiSelected={false}
        flatItemKeys={["session-session-note-window"]}
      />,
    );

    const menu = mocks.nativeContextMenus.find((items) =>
      items.some((item) => item.id === "open-new-window"),
    );

    expect(menu?.some((item) => item.text === "Open in New Tab")).toBe(false);
    const openWindowItem = menu?.find((item) => item.id === "open-new-window");

    expect(openWindowItem).toMatchObject({
      id: "open-new-window",
      text: "Open in New Window",
    });

    openWindowItem?.action?.();

    expect(mocks.windowShow).toHaveBeenCalledWith({
      type: "note",
      value: "session-note-window",
    });
  });
});
