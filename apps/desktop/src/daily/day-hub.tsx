import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, isSameDay, isToday, parse, parseISO } from "date-fns";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  FileTextIcon,
  MailIcon,
  PlusIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@notiz/ui/components/ui/button";
import { Kbd } from "@notiz/ui/components/ui/kbd";
import { cn } from "@notiz/utils";

import { DAILY_DATE_FORMAT, todayKey } from "./open-daily-tab";

import { NotesList } from "~/folders/notes-list";
import { fetchInboxMessages } from "~/inbox/data";
import { selectInboxMessageOnOpen } from "~/inbox/pending-selection";
import { RemindersSection } from "~/reminders";
import { AppleMailConnect } from "~/settings/email/apple-mail";
import { useConfigValue } from "~/shared/config";
import { StandardTabWrapper } from "~/shared/main";
import { useNewNote } from "~/shared/useNewNote";
import * as main from "~/store/tinybase/store/main";
import { getOrCreateSessionForEventId } from "~/store/tinybase/store/sessions";
import { useTabs } from "~/store/zustand/tabs";

function useDayEvents(day: Date) {
  const events = main.UI.useTable("events", main.STORE_ID);

  return useMemo(() => {
    const seen = new Set<string>();
    return Object.entries(events)
      .map(([id, row]) => ({
        id,
        title: String(row.title || "Untitled event"),
        start:
          typeof row.started_at === "string" ? parseISO(row.started_at) : null,
        end: typeof row.ended_at === "string" ? parseISO(row.ended_at) : null,
        allDay: Boolean(row.is_all_day),
      }))
      .filter(
        (e) =>
          e.start &&
          !Number.isNaN(e.start.getTime()) &&
          isSameDay(e.start, day),
      )
      .sort(
        (a, b) =>
          Number(b.allDay) - Number(a.allDay) ||
          a.start!.getTime() - b.start!.getTime(),
      )
      .filter((e) => {
        const key = `${e.allDay}-${e.start!.getTime()}-${e.title.trim().toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [events, day]);
}

function useDayNotes(day: Date) {
  const sessions = main.UI.useTable("sessions", main.STORE_ID);

  return useMemo(
    () =>
      Object.entries(sessions)
        .map(([id, row]) => ({
          id,
          title: String(row.title || ""),
          createdAt:
            typeof row.created_at === "string"
              ? parseISO(row.created_at)
              : null,
        }))
        .filter(
          (n) =>
            n.title &&
            n.createdAt &&
            !Number.isNaN(n.createdAt.getTime()) &&
            isSameDay(n.createdAt, day),
        )
        .sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime()),
    [sessions, day],
  );
}

const GLANCE_COUNT = 3;
const INBOX_FETCH_LIMIT = 80;

function useInboxGlance() {
  return useQuery({
    queryKey: ["home-inbox-glance"],
    queryFn: () => fetchInboxMessages(INBOX_FETCH_LIMIT),
    staleTime: 2 * 60 * 1000,
    retry: false,
  });
}

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function InboxGlance() {
  const openCurrent = useTabs((state) => state.openCurrent);
  const { data } = useInboxGlance();

  if (!data) return null;

  if (!data.connected) {
    return (
      <section className="border-border flex flex-col gap-3 rounded-2xl border border-dashed px-5 py-4">
        <h2 className="text-foreground flex items-center gap-2 text-sm">
          <MailIcon className="size-4" />
          <Trans>Bring your mail in</Trans>
        </h2>
        <AppleMailConnect />
      </section>
    );
  }

  const unread = data.messages.filter((m) => m.unread);
  const shown = (unread.length > 0 ? unread : data.messages).slice(
    0,
    GLANCE_COUNT,
  );
  if (shown.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => openCurrent({ type: "inbox" })}
        className="text-foreground hover:text-primary flex w-fit items-center gap-2 text-left transition-colors"
      >
        <h2 className="font-display text-xl leading-none">
          <Trans>Inbox</Trans>
        </h2>
        {unread.length > 0 && (
          <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">
            {unread.length >= INBOX_FETCH_LIMIT
              ? `${INBOX_FETCH_LIMIT}+`
              : unread.length}
          </span>
        )}
      </button>
      <ul className="border-border bg-card divide-border divide-y divide-dashed overflow-hidden rounded-2xl border">
        {shown.map((message) => (
          <li key={message.id}>
            <button
              type="button"
              onClick={() => {
                selectInboxMessageOnOpen(message.id);
                openCurrent({ type: "inbox" });
              }}
              className="hover:bg-accent flex w-full items-center gap-3 px-5 py-3 text-left transition-colors"
            >
              <span
                className={cn([
                  "size-1.5 shrink-0 rounded-full",
                  message.unread ? "bg-primary" : "bg-transparent",
                ])}
              />
              <span className="text-foreground w-40 shrink-0 truncate text-sm">
                {message.fromName || message.fromEmail}
              </span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                {message.subject || "(no subject)"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notes() {
  const newNote = useNewNote({ behavior: "current" });
  const openNew = useTabs((state) => state.openNew);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-foreground text-xl leading-none">
          <Trans>Recent notes</Trans>
        </h2>
        <button
          type="button"
          onClick={() => openNew({ type: "folders", id: null })}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          <Trans>All notes</Trans>
        </button>
      </div>
      <NotesList
        limit={6}
        recentOnly
        compact
        empty={
          <section className="border-border flex items-center justify-between gap-3 rounded-2xl border border-dashed px-4 py-3">
            <span className="text-muted-foreground flex items-center gap-2 text-sm">
              <FileTextIcon className="size-4" />
              <Trans>No notes from today or yesterday.</Trans>
            </span>
            <button
              type="button"
              onClick={newNote}
              className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-opacity hover:opacity-90"
            >
              <Trans>New note</Trans>
              <Kbd className="bg-transparent text-inherit">⌘ N</Kbd>
            </button>
          </section>
        }
      />
    </section>
  );
}

type DayEvent = ReturnType<typeof useDayEvents>[number];

function briefingText(events: DayEvent[], unread: number, now: Date) {
  const parts: string[] = [];
  const upcoming = events.find((e) => !e.allDay && (e.end ?? e.start!) >= now);
  if (events.length === 0) {
    parts.push("Nothing on your calendar today.");
  } else if (upcoming) {
    parts.push(
      `${events.length} ${events.length === 1 ? "event" : "events"} today. ${
        upcoming.start! <= now ? "Now:" : "Next:"
      } ${upcoming.title} at ${format(upcoming.start!, "h:mm a")}.`,
    );
  } else {
    parts.push("You're done with meetings for today.");
  }
  if (unread > 0) {
    parts.push(
      `${unread >= INBOX_FETCH_LIMIT ? `${INBOX_FETCH_LIMIT}+` : unread} unread ${unread === 1 ? "email" : "emails"}.`,
    );
  }
  return parts.join(" ");
}

const SCHEDULE_PREVIEW = 5;

function ScheduleSection({
  events,
  onOpen,
}: {
  events: DayEvent[];
  onOpen: (event: DayEvent) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? events : events.slice(0, SCHEDULE_PREVIEW);
  const hidden = events.length - shown.length;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-foreground text-xl leading-none">
        <Trans>Schedule</Trans>
      </h2>
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans>Nothing on the calendar.</Trans>
        </p>
      ) : (
        <ul className="border-border bg-card divide-border divide-y divide-dashed overflow-hidden rounded-2xl border">
          {shown.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => onOpen(event)}
                className="hover:bg-accent flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
              >
                <span className="text-muted-foreground w-24 shrink-0 text-xs tabular-nums">
                  {event.allDay
                    ? "All day"
                    : `${format(event.start!, "h:mm")} – ${format(event.end ?? event.start!, "h:mm a")}`}
                </span>
                <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                  {event.title}
                </span>
              </button>
            </li>
          ))}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="text-muted-foreground hover:bg-accent hover:text-foreground w-full px-4 py-2 text-left text-xs transition-colors"
              >
                +{hidden} more
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function DayNotes({ notes }: { notes: { id: string; title: string }[] }) {
  const openCurrent = useTabs((state) => state.openCurrent);
  if (notes.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-foreground text-xl leading-none">
        <Trans>Notes from this day</Trans>
      </h2>
      <ul className="flex flex-col gap-0.5">
        {notes.slice(0, 6).map((note) => (
          <li key={note.id}>
            <button
              type="button"
              onClick={() => openCurrent({ type: "sessions", id: note.id })}
              className="hover:bg-accent text-foreground w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors"
            >
              {note.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DueTasks({ day }: { day: Date }) {
  const store = main.UI.useStore(main.STORE_ID);
  const tasks = main.UI.useTable("tasks", main.STORE_ID);
  const due = useMemo(() => {
    const result: { id: string; text: string }[] = [];
    for (const [id, row] of Object.entries(tasks)) {
      if (row.status === "done" || typeof row.due_date !== "string") continue;
      const date = parseISO(row.due_date);
      if (Number.isNaN(date.getTime()) || !isSameDay(date, day)) continue;
      const text = String(row.text_preview ?? "").trim();
      if (text) result.push({ id, text });
    }
    return result;
  }, [tasks, day]);

  if (due.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-foreground text-xl leading-none">
        <Trans>Tasks due</Trans>
      </h2>
      <ul className="border-border bg-card divide-border divide-y divide-dashed overflow-hidden rounded-2xl border">
        {due.map((task) => (
          <li key={task.id} className="flex items-center gap-3 px-5 py-3">
            <button
              type="button"
              aria-label="Mark as done"
              onClick={() => store?.setCell("tasks", task.id, "status", "done")}
              className="border-muted-foreground/50 hover:border-primary flex size-4 shrink-0 items-center justify-center rounded border transition-colors"
            >
              <CheckIcon size={12} className="opacity-0 hover:opacity-60" />
            </button>
            <span className="text-foreground min-w-0 flex-1 truncate text-sm">
              {task.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DayHub({
  date,
  onNavigate,
}: {
  date: string;
  onNavigate: (date: string) => void;
}) {
  const day = useMemo(() => parse(date, DAILY_DATE_FORMAT, new Date()), [date]);
  const today = isToday(day);
  const events = useDayEvents(day);
  const notes = useDayNotes(day);
  const store = main.UI.useStore(main.STORE_ID);
  const openCurrent = useTabs((state) => state.openCurrent);
  const newNote = useNewNote({ behavior: "current" });
  const name = useConfigValue("user_name").trim();
  const { data: inbox } = useInboxGlance();

  const go = (target: Date) => onNavigate(format(target, DAILY_DATE_FORMAT));
  const now = new Date();
  const unread = inbox?.connected
    ? inbox.messages.filter((m) => m.unread).length
    : 0;

  return (
    <StandardTabWrapper>
      <div
        data-tauri-drag-region
        className="scroll-fade-y flex h-full flex-col overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 pt-8 pb-10">
          <header className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  {today
                    ? name
                      ? `${greeting(now)}, ${name}`
                      : greeting(now)
                    : format(day, "EEEE")}
                </span>
                <h1 className="font-display text-foreground text-4xl leading-none">
                  {format(day, today ? "EEEE, MMMM d" : "MMMM d, yyyy")}
                </h1>
              </div>
              <div
                className="flex items-center gap-2"
                data-tauri-drag-region="false"
              >
                <button
                  type="button"
                  onClick={newNote}
                  className={cn([
                    "border-border bg-card text-foreground hover:bg-accent",
                    "flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors",
                  ])}
                >
                  <PlusIcon className="size-4" />
                  <Trans>New note</Trans>
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <p className="text-muted-foreground text-base">
                {today ? briefingText(events, unread, now) : ""}
              </p>
              <div
                className="flex shrink-0 items-center gap-1"
                data-tauri-drag-region="false"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Previous day"
                  onClick={() => go(addDays(day, -1))}
                >
                  <ChevronLeftIcon className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn([
                    "rounded-full",
                    today && "text-muted-foreground",
                  ])}
                  disabled={today}
                  onClick={() => onNavigate(todayKey())}
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Next day"
                  onClick={() => go(addDays(day, 1))}
                >
                  <ChevronRightIcon className="size-4" />
                </Button>
              </div>
            </div>
          </header>

          <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-6">
              <ScheduleSection
                events={events}
                onOpen={(event) => {
                  if (!store) return;
                  const sessionId = getOrCreateSessionForEventId(
                    store,
                    event.id,
                    event.title,
                  );
                  openCurrent({ type: "sessions", id: sessionId });
                }}
              />
              {today ? <Notes /> : <DayNotes notes={notes} />}
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <RemindersSection day={day} />
              <DueTasks day={day} />
              {today && <InboxGlance />}
            </div>
          </div>
        </div>
      </div>
    </StandardTabWrapper>
  );
}
