import { commands as calendarCommands } from "@notiz/plugin-calendar";
import type { CalendarProviderType } from "@notiz/plugin-calendar";

import { CONNECTIONS_QUERY_KEY } from "~/auth/useConnections";
import { queryClient } from "~/shared/query-client";
import { showTransientToast } from "~/sidebar/toast/transient";
import { useTabs } from "~/store/zustand/tabs";

const PROVIDER_BY_INTEGRATION: Record<string, CalendarProviderType> = {
  "google-calendar": "google",
  outlook: "outlook",
  ics: "ics",
};

export async function openIntegrationUrl(
  integrationId: string | undefined,
  connectionId: string | undefined,
  action: "connect" | "reconnect" | "disconnect",
  _returnTo?: string,
) {
  const provider = integrationId
    ? PROVIDER_BY_INTEGRATION[integrationId]
    : undefined;
  if (!provider) return;

  // Calendar links are added by pasting a link, not by signing in.
  if (provider === "ics" && action !== "disconnect") {
    useTabs
      .getState()
      .openNew({ type: "settings", state: { tab: "calendar" } });
    return;
  }

  try {
    if (action !== "connect" && connectionId) {
      const removed = await calendarCommands.disconnectAccount(
        provider,
        connectionId,
      );
      if (removed.status === "error") throw new Error(removed.error);
    }

    if (action !== "disconnect") {
      const connected = await calendarCommands.connectAccount(provider);
      if (connected.status === "error") throw new Error(connected.error);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showTransientToast(
      {
        id: "calendar-connect-error",
        description: message.includes("not configured")
          ? "Sign-in for this calendar isn't set up in this build yet."
          : `Couldn't connect the calendar. ${message}`,
        variant: "error",
      },
      { durationMs: 6000 },
    );
  } finally {
    await queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
  }
}
