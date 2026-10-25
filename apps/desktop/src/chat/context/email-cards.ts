import type { InboxEmail } from "../tools/types";
import type { EmailCard } from "../types";

const MAX_CARDS = 6;

// The emails the app lists under an answer about the inbox: unread ones when
// that is what was asked, or those from a sender the user named, newest first.
export function pickEmailCards(
  messages: InboxEmail[],
  userText: string,
  limit = MAX_CARDS,
): EmailCard[] {
  const lower = userText.toLowerCase();
  const wantsUnread = /\bunread\b/.test(lower);

  const named = messages.filter((message) => {
    const names = [message.fromName, message.fromEmail.split("@")[0]]
      .map((name) => name.toLowerCase().trim())
      .filter((name) => name.length >= 3);
    return names.some((name) => lower.includes(name));
  });

  const pool = named.length > 0 ? named : messages;
  const filtered = wantsUnread
    ? pool.filter((message) => message.unread)
    : pool;

  return filtered.slice(0, limit).map((message) => ({
    id: message.id,
    from: message.fromName || message.fromEmail,
    subject: message.subject || "(no subject)",
    date: message.date,
    unread: message.unread,
  }));
}
