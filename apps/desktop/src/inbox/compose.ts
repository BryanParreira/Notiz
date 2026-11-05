import { commands as openerCommands } from "@notiz/plugin-opener2";

import { showTransientToast } from "~/sidebar/toast/transient";

type ComposeInput = {
  to?: string;
  subject?: string;
  body?: string;
};

type ComposeAccount = {
  host: string;
  username: string;
};

const enc = encodeURIComponent;

// Opens a new message where the account actually lives: Gmail and Outlook in the
// browser (already signed in, so no sending password is stored in Notiz), and
// the default mail app for everything else.
export function composeUrl(
  account: ComposeAccount | undefined,
  { to = "", subject = "", body = "" }: ComposeInput,
): string {
  const host = account?.host.toLowerCase() ?? "";
  const user = account?.username ?? "";

  if (host.includes("gmail") || host.includes("googlemail")) {
    const params = [
      "view=cm",
      "fs=1",
      `to=${enc(to)}`,
      `su=${enc(subject)}`,
      `body=${enc(body)}`,
    ];
    if (user.includes("@")) params.push(`authuser=${enc(user)}`);
    return `https://mail.google.com/mail/?${params.join("&")}`;
  }

  if (
    host.includes("outlook") ||
    host.includes("office365") ||
    host.includes("hotmail")
  ) {
    const base = host.includes("office365")
      ? "https://outlook.office.com/mail/deeplink/compose"
      : "https://outlook.live.com/mail/0/deeplink/compose";
    return `${base}?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`;
  }

  return `mailto:${enc(to)}?subject=${enc(subject)}&body=${enc(body)}`;
}

export function replySubject(subject: string) {
  const clean = subject.trim();
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

export function quoteForReply(
  from: string,
  date: Date | null,
  text: string,
  maxLength = 4000,
) {
  const when = date ? ` on ${date.toLocaleString()}` : "";
  const quoted = text
    .slice(0, maxLength)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\nOn${when}, ${from} wrote:\n${quoted}`;
}

export async function openCompose(
  account: ComposeAccount | undefined,
  input: ComposeInput,
) {
  try {
    const result = await openerCommands.openUrl(
      composeUrl(account, input),
      null,
    );
    if (result.status === "error") throw new Error(String(result.error));
  } catch (error) {
    console.error("[inbox] could not open compose", error);
    showTransientToast({
      description: "Could not open your mail app.",
      variant: "error",
    });
  }
}
