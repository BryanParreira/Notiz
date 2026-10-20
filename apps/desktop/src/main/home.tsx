import { Trans, useLingui } from "@lingui/react/macro";
import { format, isSameDay, isToday, parseISO, startOfDay } from "date-fns";
import { ArrowUpIcon, FileTextIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Kbd } from "@notiz/ui/components/ui/kbd";
import { cn } from "@notiz/utils";

import { setPendingChatPrompt } from "~/chat/pending-prompt";
import { NotesList } from "~/folders/notes-list";
import { StandardTabWrapper } from "~/shared/main";
import { useNewNote } from "~/shared/useNewNote";
import * as main from "~/store/tinybase/store/main";
import { getOrCreateSessionForEventId } from "~/store/tinybase/store/sessions";
import { useTabs } from "~/store/zustand/tabs";

const MAX_UPCOMING_DAYS = 3;

type UpcomingDay = {
  day: Date;
  events: { id: string; title: string; start: Date; end: Date }[];
};

function safeParse(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function useUpcomingDays(): UpcomingDay[] {
  const events = main.UI.useTable("events", main.STORE_ID);

  return useMemo(() => {
    const now = new Date();
    const upcoming = Object.entries(events)
      .map(([id, row]) => ({
        id,
        title: String(row.title || "Untitled event"),
        start: safeParse(row.started_at),
        end: safeParse(row.ended_at),
      }))
      .filter(
        (e): e is { id: string; title: string; start: Date; end: Date } =>
          !!e.start && !!e.end && e.end >= now,
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const days: UpcomingDay[] = [{ day: startOfDay(now), events: [] }];
    for (const event of upcoming) {
      const eventDay = startOfDay(event.start);
      const last = days[days.length - 1];
      if (isSameDay(last.day, eventDay)) {
        last.events.push(event);
      } else if (days.length < MAX_UPCOMING_DAYS + 1) {
        days.push({ day: eventDay, events: [event] });
      }
    }
    return days;
  }, [events]);
}

export function Home() {
  const newNote = useNewNote({ behavior: "current" });

  return (
    <StandardTabWrapper>
      <div data-tauri-drag-region className="relative flex h-full flex-col">
        <button
          type="button"
          onClick={newNote}
          className={cn([
            "border-border bg-card text-foreground hover:bg-accent absolute top-3 right-4 z-10",
            "flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors",
          ])}
        >
          <PlusIcon className="size-4" />
          <Trans>New note</Trans>
        </button>
        <div className="scroll-fade-y flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-10 pb-40">
            <ComingUp />
            <Notes />
          </div>
        </div>
        <AskBar />
      </div>
    </StandardTabWrapper>
  );
}

function ComingUp() {
  const days = useUpcomingDays();
  const store = main.UI.useStore(main.STORE_ID);
  const openCurrent = useTabs((state) => state.openCurrent);

  const openEventNote = (eventId: string, title: string) => {
    if (!store) return;
    const sessionId = getOrCreateSessionForEventId(store, eventId, title);
    openCurrent({ type: "sessions", id: sessionId });
  };

  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-display text-foreground text-3xl leading-none">
        <Trans>Coming up</Trans>
      </h1>
      <div
        className={cn([
          "border-border bg-card overflow-hidden rounded-2xl border",
          "divide-border divide-y divide-dashed",
        ])}
      >
        {days.map(({ day, events }) => (
          <div key={day.toISOString()} className="flex gap-5 px-5 py-4">
            <div className="flex w-36 shrink-0 items-center gap-3">
              <span className="font-display text-foreground text-4xl leading-none">
                {format(day, "d")}
              </span>
              <div className="text-muted-foreground flex flex-col text-xs leading-tight">
                <span className="text-foreground flex items-center gap-1.5 text-sm">
                  {format(day, "MMMM")}
                  {isToday(day) && (
                    <span className="bg-live size-1.5 rounded-full" />
                  )}
                </span>
                <span>{format(day, "EEE")}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {events.length === 0 ? (
                <div className="flex items-center gap-3">
                  <span className="bg-border h-8 w-0.5 rounded-full" />
                  <span className="text-muted-foreground text-lg">
                    <Trans>No events today</Trans>
                  </span>
                </div>
              ) : (
                events.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => openEventNote(event.id, event.title)}
                    className="hover:bg-accent -mx-2 flex items-center gap-3 rounded-lg px-2 py-1 text-left transition-colors"
                  >
                    <span className="bg-primary h-9 w-0.5 shrink-0 rounded-full" />
                    <div className="flex min-w-0 flex-col">
                      <span className="text-foreground truncate text-base">
                        {event.title}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {format(event.start, "h:mm a")} –{" "}
                        {format(event.end, "h:mm a")}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Notes() {
  const newNote = useNewNote({ behavior: "current" });

  return (
    <NotesList
      empty={
        <section className="border-border flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
          <FileTextIcon className="text-muted-foreground size-6" />
          <p className="text-muted-foreground text-sm">
            <Trans>
              Your notes live only on this device. Start your first one.
            </Trans>
          </p>
          <button
            type="button"
            onClick={newNote}
            className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-opacity hover:opacity-90"
          >
            <Trans>New note</Trans>
            <Kbd className="bg-transparent text-inherit">⌘ N</Kbd>
          </button>
        </section>
      }
    />
  );
}

function AskBar() {
  const { t } = useLingui();
  const openNew = useTabs((state) => state.openNew);
  const [value, setValue] = useState("");

  const ask = (question: string) => {
    const text = question.trim();
    if (!text) return;
    setPendingChatPrompt(text);
    setValue("");
    openNew({ type: "chat" });
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-6 pb-6">
      <div
        className={cn([
          "pointer-events-auto flex w-full max-w-2xl items-center gap-3",
          "border-border bg-card/90 rounded-full border py-2 pr-2 pl-5",
          "shadow-[0_10px_30px_rgba(0,0,0,0.12)] backdrop-blur",
          "focus-within:border-primary/50 transition-[border-color] duration-200",
          "dark:shadow-[0_10px_30px_rgba(0,0,0,0.45)]",
        ])}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask(value);
          }}
          placeholder={t`Ask anything`}
          aria-label={t`Ask Notiz anything`}
          className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-base outline-none"
        />
        <button
          type="button"
          aria-label={t`Send`}
          disabled={!value.trim()}
          onClick={() => ask(value)}
          className={cn([
            "flex size-9 shrink-0 items-center justify-center rounded-full transition-all duration-150",
            value.trim()
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-secondary text-muted-foreground/50",
          ])}
        >
          <ArrowUpIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
