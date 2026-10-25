import { commands as mailCommands } from "@notiz/plugin-mail";

import type { EmailContent, InboxEmail } from "../tools/types";

// Shared by the chat tools and by the context the assistant is given directly,
// so there is one place that talks to the mail commands.
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

export async function fetchInboxMessage(
  id: string,
): Promise<EmailContent | null> {
  const split = id.lastIndexOf(":");
  const accountId = id.slice(0, split);
  const uid = Number(id.slice(split + 1));
  if (split < 1 || !Number.isInteger(uid)) {
    return null;
  }

  const result = await mailCommands.readMail(accountId, uid);
  if (result.status === "error") {
    throw new Error(result.error);
  }

  const mail = result.data;
  return {
    id,
    fromName: mail.from_name,
    fromEmail: mail.from_email,
    to: mail.to,
    subject: mail.subject,
    date: mail.date || null,
    text: mail.text,
    truncated: mail.truncated,
  };
}
