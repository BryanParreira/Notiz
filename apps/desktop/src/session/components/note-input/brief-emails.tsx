import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import { MailIcon } from "lucide-react";

import { commands as mailCommands } from "@notiz/plugin-mail";
import { cn } from "@notiz/utils";

import { useParticipantEmails } from "~/session/insights/participant-emails";
import { useMailAccounts } from "~/settings/email";

const EMAIL_LIMIT = 5;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function BriefEmails({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const { data: accounts = [] } = useMailAccounts();
  const addresses = useParticipantEmails(sessionId);
  const accountIds = accounts.map((a) => a.id);

  const { data: messages = [] } = useQuery({
    queryKey: ["mail-with", accountIds, addresses],
    enabled: accountIds.length > 0 && addresses.length > 0,
    staleTime: FIVE_MINUTES_MS,
    retry: false,
    queryFn: async () => {
      const results = await Promise.all(
        accountIds.map((id) =>
          mailCommands.mailWith(id, addresses, EMAIL_LIMIT),
        ),
      );

      return results
        .flatMap((r) => (r.status === "ok" ? r.data : []))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, EMAIL_LIMIT);
    },
  });

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {t`Recent emails`}
      </h3>
      <ul className="flex min-w-0 flex-col gap-2">
        {messages.map((message) => (
          <li
            key={`${message.uid}-${message.date}`}
            className="flex min-w-0 items-start gap-1.5 text-xs leading-5"
          >
            <MailIcon
              size={12}
              className="text-muted-foreground mt-1 shrink-0"
            />
            <span className="min-w-0">
              <span
                className={cn([
                  "block truncate",
                  message.seen
                    ? "text-muted-foreground"
                    : "text-foreground font-medium",
                ])}
              >
                {message.subject || t`(no subject)`}
              </span>
              <span className="text-muted-foreground block truncate">
                {message.from_name || message.from_email}
                {message.date
                  ? ` · ${formatDistanceToNow(parseISO(message.date), { addSuffix: true })}`
                  : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
