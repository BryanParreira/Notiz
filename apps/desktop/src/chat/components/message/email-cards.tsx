import { format, isToday, parseISO } from "date-fns";
import { ArrowRightIcon, MailIcon } from "lucide-react";

import { cn } from "@notiz/utils";

import type { EmailCard } from "~/chat/types";
import { selectInboxMessageOnOpen } from "~/inbox/pending-selection";
import { useTabs } from "~/store/zustand/tabs";

function timeLabel(iso: string | null) {
  if (!iso) return "";
  const date = parseISO(iso);
  if (Number.isNaN(date.getTime())) return "";
  return isToday(date) ? format(date, "h:mm a") : format(date, "EEE, MMM d");
}

// The emails an answer is about, drawn the way the Inbox draws them, so the
// reply can stay a sentence or two. Clicking one opens it in the Inbox.
export function EmailCards({ cards }: { cards: EmailCard[] }) {
  const openNew = useTabs((state) => state.openNew);

  const open = (id?: string) => {
    if (id) selectInboxMessageOnOpen(id);
    openNew({ type: "inbox" });
  };

  return (
    <div className="border-border my-2 overflow-hidden rounded-2xl border">
      <ul className="divide-border divide-y">
        {cards.map((card) => (
          <li key={card.id}>
            <button
              type="button"
              onClick={() => open(card.id)}
              className="hover:bg-accent/60 flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors"
            >
              <span className="bg-secondary text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm uppercase">
                {card.from.trim().charAt(0) || "?"}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span
                    className={cn([
                      "truncate text-sm",
                      card.unread
                        ? "text-foreground font-medium"
                        : "text-muted-foreground",
                    ])}
                  >
                    {card.from}
                  </span>
                  {card.unread && (
                    <span className="bg-live size-1.5 shrink-0 rounded-full" />
                  )}
                </span>
                <span
                  className={cn([
                    "truncate text-sm",
                    card.unread
                      ? "text-foreground"
                      : "text-muted-foreground/80",
                  ])}
                >
                  {card.subject}
                </span>
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {timeLabel(card.date)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => open()}
        className="border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground flex w-full items-center gap-2 border-t px-3.5 py-2 text-xs transition-colors"
      >
        <MailIcon className="size-3.5" />
        Open Inbox
        <ArrowRightIcon className="ml-auto size-3.5" />
      </button>
    </div>
  );
}
