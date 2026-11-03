import { commands as mailCommands } from "@notiz/plugin-mail";

export type InboxEmail = {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  date: string | null;
  unread: boolean;
};

export async function fetchInboxMessages(
  limit: number,
): Promise<{ connected: boolean; messages: InboxEmail[] }> {
  const accountsResult = await mailCommands.listMailAccounts();
  if (accountsResult.status === "error") {
    throw new Error(accountsResult.error);
  }

  const accounts = accountsResult.data;
  if (accounts.length === 0) {
    return { connected: false, messages: [] };
  }

  const results = await Promise.all(
    accounts.map((account) => mailCommands.recentMail(account.id, limit)),
  );
  const failed = results.find((result) => result.status === "error");
  if (failed?.status === "error" && !results.some((r) => r.status === "ok")) {
    throw new Error(failed.error);
  }

  const messages = results
    .flatMap((result, index) =>
      result.status === "ok"
        ? result.data.map((message) => ({
            id: `${accounts[index].id}:${message.uid}`,
            fromName: message.from_name,
            fromEmail: message.from_email,
            subject: message.subject,
            date: message.date || null,
            unread: !message.seen,
          }))
        : [],
    )
    .sort(
      (a, b) =>
        (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0),
    );

  return { connected: true, messages };
}
