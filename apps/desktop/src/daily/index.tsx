import { addDays, format, isSameDay, isToday, parse, parseISO } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { parseJsonContent } from "@notiz/editor/markdown";
import {
  NoteEditor,
  type JSONContent,
  type NoteEditorRef,
} from "@notiz/editor/note";
import { Button } from "@notiz/ui/components/ui/button";
import { cn } from "@notiz/utils";

import { DAILY_DATE_FORMAT, showDailyDate, todayKey } from "./open-daily-tab";

import { AppLinkView } from "~/editor-bridge/app-link-view";
import { useMentionConfig } from "~/editor-bridge/mention-config";
import { openEditorLink } from "~/editor-bridge/open-editor-link";
import { sessionMentionDropConfig } from "~/editor-bridge/session-mention-drop";
import { SessionNodeView } from "~/editor-bridge/session-view";
import { RemindersSection } from "~/reminders";
import { StandardTabWrapper } from "~/shared/main";
import * as main from "~/store/tinybase/store/main";
import { getOrCreateSessionForEventId } from "~/store/tinybase/store/sessions";
import { type Tab, useTabs } from "~/store/zustand/tabs";

const extraNodeViews = { appLink: AppLinkView, session: SessionNodeView };

const placeholder = () => "Write about your day…";

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

function DailyEditor({ date }: { date: string }) {
  const store = main.UI.useStore(main.STORE_ID);
  const content = main.UI.useCell(
    "daily_notes",
    date,
    "content",
    main.STORE_ID,
  );
  const mentionConfig = useMentionConfig();

  const lastWritten = useRef<string | null>(null);
  const [version, setVersion] = useState(0);

  // The editor owns the document after it mounts, so only a change that did not
  // come from typing here (a capture, an email task) reloads it.
  useEffect(() => {
    if (typeof content === "string" && content !== lastWritten.current) {
      lastWritten.current = content;
      setVersion((v) => v + 1);
    }
  }, [content]);

  const initialContent = useMemo<JSONContent>(
    () => parseJsonContent(lastWritten.current ?? (content as string)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, version],
  );

  const handleChange = useCallback(
    (input: JSONContent) => {
      if (!store) return;
      const next = JSON.stringify(input);
      lastWritten.current = next;
      store.setPartialRow("daily_notes", date, {
        user_id: String(store.getValue("user_id") ?? ""),
        date,
        content: next,
      });
    },
    [store, date],
  );

  return (
    <NoteEditor
      ref={null as unknown as React.Ref<NoteEditorRef>}
      key={`daily-${date}-${version}`}
      className="session-note-editor"
      initialContent={initialContent}
      handleChange={handleChange}
      mentionConfig={mentionConfig}
      sessionMentionDropConfig={sessionMentionDropConfig}
      onLinkOpen={openEditorLink}
      taskSource={{ type: "daily_note", id: date }}
      extraNodeViews={extraNodeViews}
      enforceTitleHeading={false}
      placeholderComponent={placeholder as never}
      showFormatToolbar
    />
  );
}

export function TabContentDaily({
  tab,
}: {
  tab: Extract<Tab, { type: "daily_summary" }>;
}) {
  const date = tab.id;
  const day = useMemo(() => parse(date, DAILY_DATE_FORMAT, new Date()), [date]);
  const events = useDayEvents(day);
  const notes = useDayNotes(day);
  const store = main.UI.useStore(main.STORE_ID);
  const openCurrent = useTabs((state) => state.openCurrent);

  const go = (target: Date) =>
    showDailyDate(tab, format(target, DAILY_DATE_FORMAT));
  const today = isToday(day);

  return (
    <StandardTabWrapper>
      <div
        data-tauri-drag-region
        className="flex h-full flex-col overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-10 pb-32">
          <header className="flex items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                {today ? "Today" : format(day, "EEEE")}
              </span>
              <h1 className="font-display text-foreground text-4xl leading-none">
                {format(day, today ? "EEEE, MMMM d" : "MMMM d, yyyy")}
              </h1>
            </div>
            <div
              className="flex items-center gap-1"
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
                onClick={() => showDailyDate(tab, todayKey())}
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
          </header>

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-foreground text-2xl leading-none">
              Schedule
            </h2>
            {events.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing on the calendar.
              </p>
            ) : (
              <ul className="border-border bg-card divide-border divide-y divide-dashed overflow-hidden rounded-2xl border">
                {events.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!store) return;
                        const sessionId = getOrCreateSessionForEventId(
                          store,
                          event.id,
                          event.title,
                        );
                        openCurrent({ type: "sessions", id: sessionId });
                      }}
                      className="hover:bg-accent flex w-full items-center gap-4 px-5 py-3 text-left transition-colors"
                    >
                      <span className="text-muted-foreground w-28 shrink-0 text-xs tabular-nums">
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
              </ul>
            )}
          </section>

          <RemindersSection day={day} />

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-foreground text-2xl leading-none">
              Notes
            </h2>
            <div className="min-h-40">
              <DailyEditor date={date} />
            </div>
          </section>

          {notes.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-display text-foreground text-2xl leading-none">
                Notes from this day
              </h2>
              <ul className="flex flex-col gap-0.5">
                {notes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() =>
                        openCurrent({ type: "sessions", id: note.id })
                      }
                      className="hover:bg-accent text-foreground w-full rounded-lg px-3 py-2 text-left text-sm transition-colors"
                    >
                      {note.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </StandardTabWrapper>
  );
}
