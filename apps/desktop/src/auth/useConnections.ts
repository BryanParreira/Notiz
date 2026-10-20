import { useQuery } from "@tanstack/react-query";

import type { ConnectionItem } from "@notiz/api-client";
import { commands as calendarCommands } from "@notiz/plugin-calendar";

export const CONNECTIONS_QUERY_KEY = ["integration-status"] as const;

const INTEGRATION_IDS: Record<string, string> = {
  google: "google-calendar",
  outlook: "outlook",
  ics: "ics",
};

// Accounts live in the device keychain; nothing is fetched from a server.
export function useConnections(_enabled = true) {
  return useQuery({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: async (): Promise<ConnectionItem[]> => {
      const result = await calendarCommands.listAccounts();
      if (result.status === "error") {
        throw new Error(result.error);
      }

      return result.data.flatMap((account) => {
        const integrationId = INTEGRATION_IDS[account.provider];
        return integrationId
          ? [
              {
                connection_id: account.connection_id,
                integration_id: integrationId,
                status: "connected",
              },
            ]
          : [];
      });
    },
  });
}
