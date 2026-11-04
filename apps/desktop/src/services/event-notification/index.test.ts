import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { checkEventNotifications } from ".";

import type * as main from "~/store/tinybase/store/main";
import type * as settings from "~/store/tinybase/store/settings";

const { showNotificationMock } = vi.hoisted(() => ({
  showNotificationMock: vi.fn(),
}));

vi.mock("@notiz/plugin-notification", () => ({
  commands: {
    showNotification: showNotificationMock,
  },
}));

describe("checkEventNotifications", () => {
  beforeEach(() => {
    showNotificationMock.mockReset();
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-05-15T12:00:00.000Z").getTime(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("scheduled meeting notifications do not include expanded payloads", () => {
    const store = {
      getValue: vi.fn(() => undefined),
      forEachRow: vi.fn((table: string, callback: (rowId: string) => void) => {
        if (table === "events") {
          callback("event-1");
        }
      }),
      getRow: vi.fn((table: string, rowId: string) => {
        if (table === "events" && rowId === "event-1") {
          return {
            started_at: "2026-05-15T12:02:00.000Z",
            tracking_id_event: "tracking-1",
            title: "Design Review",
            meeting_link: "https://meet.example.com/design",
          };
        }
        return undefined;
      }),
    } as unknown as main.Store;
    const settingsStore = {
      getValue: vi.fn((key: string) =>
        key === "notification_event" ? true : undefined,
      ),
    } as unknown as settings.Store;

    checkEventNotifications(store, settingsStore, new Map());

    expect(showNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { type: "calendar_event", event_id: "event-1" },
        action_label: "Open Notiz",
        participants: null,
        event_details: null,
        options: null,
        footer: null,
      }),
    );
  });

  test("same meeting synced from multiple calendars notifies once", () => {
    const rows: Record<string, Record<string, string>> = {
      "event-1": {
        started_at: "2026-05-15T12:02:00.000Z",
        tracking_id_event: "tracking-1",
        title: "Design Review",
      },
      "event-2": {
        started_at: "2026-05-15T12:02:00.000Z",
        tracking_id_event: "tracking-2",
        title: " design review ",
      },
    };
    const store = {
      getValue: vi.fn(() => undefined),
      forEachRow: vi.fn((table: string, callback: (rowId: string) => void) => {
        if (table === "events") {
          Object.keys(rows).forEach((id) => callback(id));
        }
      }),
      getRow: vi.fn((table: string, rowId: string) =>
        table === "events" ? rows[rowId] : undefined,
      ),
    } as unknown as main.Store;
    const settingsStore = {
      getValue: vi.fn((key: string) =>
        key === "notification_event" ? true : undefined,
      ),
    } as unknown as settings.Store;
    const notifiedEvents = new Map();

    checkEventNotifications(store, settingsStore, notifiedEvents);
    checkEventNotifications(store, settingsStore, notifiedEvents);

    expect(showNotificationMock).toHaveBeenCalledTimes(1);
  });

  function storeWith(row: Record<string, unknown>) {
    return {
      getValue: vi.fn(() => undefined),
      forEachRow: vi.fn((table: string, callback: (rowId: string) => void) => {
        if (table === "events") callback("event-1");
      }),
      getRow: vi.fn((table: string) => (table === "events" ? row : undefined)),
    } as unknown as main.Store;
  }
  const enabledSettings = {
    getValue: vi.fn((key: string) =>
      key === "notification_event" ? true : undefined,
    ),
  } as unknown as settings.Store;

  test("shows the start time and expires shortly after the meeting starts", () => {
    checkEventNotifications(
      storeWith({
        started_at: "2026-05-15T12:04:00.000Z",
        title: "Standup",
      }),
      enabledSettings,
      new Map(),
    );

    const payload = showNotificationMock.mock.calls[0][0];
    expect(payload.message).toMatch(/^Starts at /);
    expect(payload.timeout).toEqual({ secs: 4 * 60 + 60, nanos: 0 });
  });

  test("all-day events never trigger a notification", () => {
    checkEventNotifications(
      storeWith({
        started_at: "2026-05-15T12:02:00.000Z",
        title: "Holiday",
        is_all_day: true,
      }),
      enabledSettings,
      new Map(),
    );

    expect(showNotificationMock).not.toHaveBeenCalled();
  });
});
