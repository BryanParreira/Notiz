import { type QueryClient, useQuery } from "@tanstack/react-query";

import { commands as mailCommands } from "@notiz/plugin-mail";

export const MAIL_ACCOUNTS_QUERY_KEY = ["mail-accounts"] as const;

export function useMailAccounts() {
  return useQuery({
    queryKey: MAIL_ACCOUNTS_QUERY_KEY,
    queryFn: async () => {
      const result = await mailCommands.listMailAccounts();
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
  });
}

// Home and the Inbox cache mail by account list, so any change to the accounts
// has to refresh them too.
export function invalidateMail(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: MAIL_ACCOUNTS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ["home-inbox-glance"] }),
    queryClient.invalidateQueries({ queryKey: ["mail-recent"] }),
  ]);
}
