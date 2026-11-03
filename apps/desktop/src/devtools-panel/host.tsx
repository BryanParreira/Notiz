import { useCallback, useRef, useState } from "react";

import { commands as notificationCommands } from "@notiz/plugin-notification";
import {
  commands as windowsCommands,
  events as windowsEvents,
  getCurrentWebviewWindowLabel,
  openUrlWithInstruction,
} from "@notiz/plugin-windows";

import { useDevtoolsStore, useDevtoolsUserId } from "~/devtools-panel/hooks";
import { useMountEffect } from "~/shared/hooks/useMountEffect";
import {
  type DevtoolsOtaPreviewStatus,
  useDevtoolsOtaPreview,
} from "~/store/zustand/devtools-ota-preview";
import {
  type DevtoolsToastPreview,
  useDevtoolsToastPreview,
} from "~/store/zustand/devtools-toast-preview";
import { useTabs } from "~/store/zustand/tabs";

type DevtoolsPanelAction =
  | "navigation:onboarding"
  | "instruction:sign-in"
  | "instruction:billing"
  | "instruction:integration"
  | `toasts:preview:${DevtoolsToastPreview}`
  | "toasts:clear"
  | "ota:available"
  | "ota:downloading"
  | "ota:ready"
  | "ota:failed"
  | "ota:clear"
  | "notifications:calendar"
  | "notifications:clear"
  | "billing:trial-started"
  | "billing:trial-ended"
  | "countdown:note-60"
  | "countdown:note-300"
  | "countdown:zoom-60"
  | "countdown:zoom-300"
  | "panel:opened"
  | "panel:closed"
  | "error:trigger";

export function DevtoolsFloatingPanelHost() {
  const isMainWindow = getCurrentWebviewWindowLabel() === "main";
  const shouldShow = useShouldShowDevtoolsPanel(isMainWindow);

  if (!isMainWindow) {
    return null;
  }

  if (!shouldShow) {
    return <DevtoolsFloatingPanelDisabled />;
  }

  return <DevtoolsFloatingPanelSync />;
}

function useShouldShowDevtoolsPanel(_isMainWindow: boolean) {
  return false;
}

function DevtoolsFloatingPanelDisabled() {
  useMountEffect(() => {
    void hideDevtoolsPanel();
  });

  return null;
}

function DevtoolsFloatingPanelSync() {
  const { dialogs, handleAction, shouldThrow } = useDevtoolsPanelActions();
  const actionHandlerRef = useRef(handleAction);
  actionHandlerRef.current = handleAction;

  useMountEffect(() => {
    let cancelled = false;
    let unlistenAction: (() => void) | undefined;

    void showDevtoolsPanel();

    windowsEvents.devtoolsPanelAction
      .listen(({ payload }) => {
        actionHandlerRef.current(payload.action);
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }

        unlistenAction = unlisten;
      });

    return () => {
      cancelled = true;
      unlistenAction?.();
      void hideDevtoolsPanel();
    };
  });

  if (shouldThrow) {
    throw new Error("Test error triggered from devtools");
  }

  return dialogs;
}

function useDevtoolsPanelActions() {
  const openNew = useTabs((s) => s.openNew);
  const store = useDevtoolsStore();
  const user_id = useDevtoolsUserId();
  const showToastPreview = useDevtoolsToastPreview(
    (state) => state.showPreview,
  );
  const clearToastPreview = useDevtoolsToastPreview(
    (state) => state.clearPreview,
  );
  const showOtaPreview = useDevtoolsOtaPreview((state) => state.showPreview);
  const clearOtaPreview = useDevtoolsOtaPreview((state) => state.clearPreview);
  const [shouldThrow, setShouldThrow] = useState(false);

  const showMainWindow = useCallback(async () => {
    await windowsCommands.windowShow({ type: "main" });
  }, []);

  const showOnboarding = useCallback(async () => {
    await showMainWindow();
    openNew({ type: "onboarding" });
  }, [openNew, showMainWindow]);

  const showInstruction = useCallback((type: string) => {
    void openUrlWithInstruction(
      `https://example.com/${type}`,
      type,
      async () => ({ status: "ok" as const }),
    );
  }, []);

  const showToastPreviewInMainWindow = useCallback(
    async (preview: DevtoolsToastPreview) => {
      await showMainWindow();
      showToastPreview(preview);
    },
    [showMainWindow, showToastPreview],
  );

  const showOtaPreviewInMainWindow = useCallback(
    async (preview: DevtoolsOtaPreviewStatus) => {
      await showMainWindow();
      showOtaPreview(preview);
    },
    [showMainWindow, showOtaPreview],
  );

  const showCalendarNotification = useCallback(async () => {
    const eventId = `devtool-event-${crypto.randomUUID()}`;
    const startedAt = new Date(Date.now() + 5 * 60 * 1000);
    const endedAt = new Date(startedAt.getTime() + 30 * 60 * 1000);

    store?.setRow("events", eventId, {
      user_id: user_id ?? "",
      created_at: new Date().toISOString(),
      tracking_id_event: eventId,
      calendar_id: "devtool-calendar",
      title: "Devtool design sync",
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      location: "Conference Room",
      meeting_link: "https://zoom.us/j/1234567890",
      description: "Notification test event",
      note: "",
      recurrence_series_id: "",
      has_recurrence_rules: false,
      is_all_day: false,
      provider: "google",
      participants_json: JSON.stringify([
        {
          name: "Ada Lovelace",
          email: "ada@example.com",
          status: "accepted",
        },
      ]),
    });

    await notificationCommands.showNotification({
      key: `devtool-calendar-${eventId}`,
      title: "Devtool design sync",
      message: "Starting in 5 minutes",
      timeout: null,
      source: { type: "calendar_event", event_id: eventId },
      start_time: Math.floor(startedAt.getTime() / 1000),
      participants: [
        {
          name: "Ada Lovelace",
          email: "ada@example.com",
          status: "Accepted",
        },
      ],
      event_details: {
        what: "Devtool design sync",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        location: "Conference Room",
      },
      action_label: "Open Notiz",
      action_variant: null,
      options: null,
      footer: null,
      icon: null,
    });
  }, [store, user_id]);

  const createWithCountdown = useCallback(
    (seconds: number, meetingLink?: string) => {
      if (!store) {
        return;
      }

      const sessionId = crypto.randomUUID();
      const started_at = new Date(Date.now() + seconds * 1000).toISOString();
      const event_json = JSON.stringify({
        tracking_id: "devtool-test",
        calendar_id: "devtool-test",
        title: "Test Meeting",
        started_at,
        ended_at: new Date(
          Date.now() + seconds * 1000 + 30 * 60 * 1000,
        ).toISOString(),
        is_all_day: false,
        has_recurrence_rules: false,
        ...(meetingLink ? { meeting_link: meetingLink } : {}),
      });

      store.setRow("sessions", sessionId, {
        user_id: user_id ?? "",
        created_at: new Date().toISOString(),
        title: meetingLink ? "Countdown Test (Zoom)" : "Countdown Test",
        event_json,
      });

      openNew({ type: "sessions", id: sessionId });
    },
    [openNew, store, user_id],
  );

  const handleAction = useCallback(
    (action: string) => {
      switch (action as DevtoolsPanelAction) {
        case "navigation:onboarding":
          void showOnboarding();
          return;
        case "instruction:sign-in":
          showInstruction("sign-in");
          return;
        case "instruction:billing":
          showInstruction("billing");
          return;
        case "instruction:integration":
          showInstruction("integration");
          return;
        case "toasts:preview:pro":
          void showToastPreviewInMainWindow("pro");
          return;
        case "toasts:clear":
          clearToastPreview();
          return;
        case "ota:available":
          void showOtaPreviewInMainWindow("available");
          return;
        case "ota:downloading":
          void showOtaPreviewInMainWindow("downloading");
          return;
        case "ota:ready":
          void showOtaPreviewInMainWindow("ready");
          return;
        case "ota:failed":
          void showOtaPreviewInMainWindow("failed");
          return;
        case "ota:clear":
          clearOtaPreview();
          return;
        case "notifications:calendar":
          void showCalendarNotification();
          return;
        case "notifications:clear":
          void notificationCommands.clearNotifications();
          return;
        case "billing:trial-started":
        case "billing:trial-ended":
          return;
        case "countdown:note-60":
          createWithCountdown(60);
          return;
        case "countdown:note-300":
          createWithCountdown(300);
          return;
        case "countdown:zoom-60":
          createWithCountdown(60, "https://zoom.us/j/1234567890");
          return;
        case "countdown:zoom-300":
          createWithCountdown(300, "https://zoom.us/j/1234567890");
          return;
        case "panel:opened":
        case "panel:closed":
          return;
        case "error:trigger":
          setShouldThrow(true);
          return;
        default:
          console.warn("Unknown Devtools panel action:", action);
      }
    },
    [
      createWithCountdown,
      showCalendarNotification,
      showInstruction,
      showOnboarding,
      showToastPreviewInMainWindow,
      showOtaPreviewInMainWindow,
      clearToastPreview,
      clearOtaPreview,
    ],
  );

  return {
    dialogs: null,
    handleAction,
    shouldThrow,
  };
}

async function showDevtoolsPanel() {
  const result = await windowsCommands.devtoolsPanelShow();
  if (result.status === "error") {
    console.error("Failed to show Devtools panel:", result.error);
  }
}

async function hideDevtoolsPanel() {
  const result = await windowsCommands.devtoolsPanelHide();
  if (result.status === "error") {
    console.error("Failed to hide Devtools panel:", result.error);
  }
}
