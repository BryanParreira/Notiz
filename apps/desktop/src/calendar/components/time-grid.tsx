import { useMutation } from "@tanstack/react-query";
import { addDays, addMinutes, format, isSameDay, startOfDay } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";

import { commands as calendarCommands } from "@notiz/plugin-calendar";
import { Button } from "@notiz/ui/components/ui/button";
import {
  AppFloatingPanel,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@notiz/ui/components/ui/popover";
import { cn, safeParseDate } from "@notiz/utils";

import { useSync } from "./context";
import { EventPopoverContent } from "./event-chip";

import { resolveCalendarColor } from "~/calendar/calendar-color";
import {
  type CalendarData,
  toTz,
  useCalendar,
  useNow,
  useTimezone,
} from "~/calendar/hooks";
import { showTransientToast } from "~/sidebar/toast/transient";
import * as main from "~/store/tinybase/store/main";

const HOUR_HEIGHT = 48;
const SNAP_MINUTES = 30;
const GUTTER_WIDTH = 52;
const DEFAULT_DURATION_MINUTES = 60;

type GridEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  calendarId: string | null;
  column: number;
  columns: number;
};

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function layoutDay(
  events: Omit<GridEvent, "column" | "columns">[],
): GridEvent[] {
  const sorted = [...events].sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      b.end.getTime() - a.end.getTime(),
  );
  const result: GridEvent[] = [];
  let cluster: GridEvent[] = [];
  let clusterEnd = 0;
  let columnEnds: number[] = [];

  const flush = () => {
    for (const item of cluster) {
      item.columns = columnEnds.length;
    }
    result.push(...cluster);
    cluster = [];
    columnEnds = [];
  };

  for (const event of sorted) {
    if (cluster.length > 0 && event.start.getTime() >= clusterEnd) {
      flush();
    }

    let column = columnEnds.findIndex((end) => end <= event.start.getTime());
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(0);
    }
    columnEnds[column] = event.end.getTime();
    clusterEnd = Math.max(clusterEnd, event.end.getTime());
    cluster.push({ ...event, column, columns: 1 });
  }
  flush();

  return result;
}

function EventBlock({ event }: { event: GridEvent }) {
  const calendar = useCalendar(event.calendarId);
  const now = useNow();
  const color = resolveCalendarColor(calendar?.color, event.calendarId);
  const past = event.end < now;

  const startMinutes = minutesOfDay(event.start);
  const durationMinutes = Math.max(
    20,
    (event.end.getTime() - event.start.getTime()) / 60_000,
  );
  const top = (startMinutes / 60) * HOUR_HEIGHT;
  const height = (durationMinutes / 60) * HOUR_HEIGHT - 2;
  const width = 100 / event.columns;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn([
            "absolute overflow-hidden rounded-lg border-l-[3px] px-2 py-1 text-left text-xs leading-tight",
            "transition-[filter,opacity] hover:brightness-95 focus-visible:outline-none",
            past && "opacity-55",
          ])}
          style={{
            top,
            height,
            left: `calc(${event.column * width}% + 1px)`,
            width: `calc(${width}% - 3px)`,
            borderColor: color,
            backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
            color: `color-mix(in srgb, ${color} 45%, #1c1917)`,
          }}
        >
          <div className="truncate font-semibold">{event.title}</div>
          {height > 34 && (
            <div className="truncate opacity-75">
              {format(event.start, "h:mm")}–{format(event.end, "h:mm a")}
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        variant="app"
        align="start"
        className="flex max-h-[80vh] w-[280px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <AppFloatingPanel>
          <EventPopoverContent eventId={event.id} />
        </AppFloatingPanel>
      </PopoverContent>
    </Popover>
  );
}

function QuickAdd({ start, onClose }: { start: Date; onClose: () => void }) {
  const { scheduleSync } = useSync();
  const calendars = main.UI.useTable("calendars", main.STORE_ID);
  const writable = useMemo(
    () =>
      Object.entries(calendars)
        .filter(([, row]) => row.enabled && row.tracking_id_calendar)
        .map(([id, row]) => ({
          id,
          name: String(row.name || "Calendar"),
          trackingId: String(row.tracking_id_calendar),
          provider: String(row.provider || ""),
        })),
    [calendars],
  );
  const [title, setTitle] = useState("");
  const [calendarId, setCalendarId] = useState(writable[0]?.id ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const selected = writable.find((c) => c.id === calendarId) ?? writable[0];
  const end = addMinutes(start, DEFAULT_DURATION_MINUTES);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No calendar connected");
      const result = await calendarCommands.createEvent(
        selected.provider as Parameters<typeof calendarCommands.createEvent>[0],
        {
          calendar_tracking_id: selected.trackingId,
          title: title.trim(),
          started_at: start.toISOString(),
          ended_at: end.toISOString(),
          is_all_day: false,
          location: null,
          notes: null,
          url: null,
        },
      );
      if (result.status === "error") throw new Error(result.error);
    },
    onSuccess: () => {
      scheduleSync();
      onClose();
    },
    onError: (error) => {
      showTransientToast({
        description:
          error instanceof Error ? error.message : "Could not create event",
        variant: "error",
      });
    },
  });

  const canSubmit = title.trim().length > 0 && !!selected && !isPending;

  return (
    <div
      className="border-border bg-popover flex w-60 flex-col gap-2 rounded-xl border p-3 shadow-lg"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSubmit) mutate();
        }}
        placeholder="Add title"
        className="text-foreground placeholder:text-muted-foreground border-border w-full border-b bg-transparent pb-1 text-sm outline-none"
      />
      <div className="text-muted-foreground text-xs">
        {format(start, "EEE, MMM d · h:mm a")} – {format(end, "h:mm a")}
      </div>
      {writable.length === 0 ? (
        <div className="text-muted-foreground text-xs">
          Connect a calendar in Settings to add events.
        </div>
      ) : (
        <select
          value={selected?.id ?? ""}
          onChange={(e) => setCalendarId(e.target.value)}
          className="border-border bg-background text-foreground rounded-md border px-2 py-1 text-xs"
        >
          {writable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={() => mutate()}>
          {isPending ? "Adding…" : "Add"}
        </Button>
      </div>
    </div>
  );
}

export function TimeGrid({
  days,
  calendarData,
}: {
  days: Date[];
  calendarData: CalendarData;
}) {
  const tz = useTimezone();
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState<{ day: Date; start: Date } | null>(null);
  const eventsTable = main.UI.useResultTable(
    main.QUERIES.timelineEvents,
    main.STORE_ID,
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      const nowOffset = (minutesOfDay(now) / 60) * HOUR_HEIGHT;
      el.scrollTop =
        now.getHours() < 7
          ? 7 * HOUR_HEIGHT
          : Math.max(0, nowOffset - el.clientHeight * 0.4);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setAdding(null);
  }, [days[0]?.getTime(), days.length]);

  const columns = useMemo(
    () =>
      days.map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const ids = calendarData.eventIdsByDate[key] ?? [];
        const allDay: { id: string; title: string; count: number }[] = [];
        const timed: Omit<GridEvent, "column" | "columns">[] = [];

        for (const id of ids) {
          const row = eventsTable?.[id];
          if (!row) continue;
          const title = String(row.title ?? "");
          if (row.is_all_day) {
            const existing = allDay.find((item) => item.title === title);
            if (existing) existing.count += 1;
            else allDay.push({ id, title, count: 1 });
            continue;
          }
          const start = safeParseDate(row.started_at);
          const end = safeParseDate(row.ended_at);
          if (!start || !end) continue;
          const startTz = toTz(start, tz);
          const endTz = toTz(end, tz);
          timed.push({
            id,
            title,
            start: startTz,
            end: isSameDay(startTz, endTz)
              ? endTz
              : addMinutes(startOfDay(startTz), 24 * 60 - 1),
            calendarId: (row.calendar_id as string) || null,
          });
        }

        return { day, allDay, events: layoutDay(timed) };
      }),
    [days, calendarData, eventsTable, tz],
  );

  const hasAllDay = columns.some((c) => c.allDay.length > 0);
  const gridTemplateColumns = `${GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`;
  const nowOffset = (minutesOfDay(now) / 60) * HOUR_HEIGHT;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onClick={() => setAdding(null)}
    >
      <div
        className="border-border grid border-b"
        style={{ gridTemplateColumns }}
      >
        <div />
        {columns.map(({ day }) => {
          const today = isSameDay(day, now);
          return (
            <div
              key={day.toISOString()}
              className="border-border flex flex-col items-center gap-0.5 border-l py-1.5"
            >
              <span className="text-muted-foreground text-[11px] font-medium uppercase">
                {format(day, "EEE")}
              </span>
              <span
                className={cn([
                  "flex size-7 items-center justify-center rounded-full text-sm",
                  today
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-foreground",
                ])}
              >
                {format(day, "d")}
              </span>
            </div>
          );
        })}
      </div>

      {hasAllDay && (
        <div
          className="border-border grid border-b"
          style={{ gridTemplateColumns }}
        >
          <div className="text-muted-foreground px-1 py-1 text-right text-[10px]">
            all-day
          </div>
          {columns.map(({ day, allDay }) => (
            <div
              key={day.toISOString()}
              className="border-border flex min-w-0 flex-col gap-0.5 border-l p-0.5"
            >
              {allDay.map((item) => (
                <Popover key={item.id}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="bg-primary/15 text-foreground truncate rounded px-1.5 py-0.5 text-left text-xs"
                    >
                      {item.title}
                      {item.count > 1 && (
                        <span className="text-muted-foreground ml-1">
                          ×{item.count}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    variant="app"
                    align="start"
                    className="flex max-h-[80vh] w-[280px] flex-col"
                  >
                    <AppFloatingPanel>
                      <EventPopoverContent eventId={item.id} />
                    </AppFloatingPanel>
                  </PopoverContent>
                </Popover>
              ))}
            </div>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        className="scrollbar-hide min-h-0 flex-1 overflow-y-auto"
      >
        <div
          className="relative grid"
          style={{ gridTemplateColumns, height: HOUR_HEIGHT * 24 }}
        >
          <div className="relative">
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="text-muted-foreground absolute right-2 -translate-y-1/2 text-[10px]"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hour === 0 ? "" : format(new Date(2000, 0, 1, hour), "h a")}
              </div>
            ))}
          </div>

          {columns.map(({ day, events }) => (
            <div
              key={day.toISOString()}
              className={cn([
                "border-border/50 relative border-l",
                isSameDay(day, now) && "bg-primary/[0.04]",
              ])}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const minutes =
                  Math.floor(
                    ((e.clientY - rect.top) / HOUR_HEIGHT) *
                      (60 / SNAP_MINUTES),
                  ) * SNAP_MINUTES;
                e.stopPropagation();
                setAdding({
                  day,
                  start: addMinutes(startOfDay(day), minutes),
                });
              }}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="border-border/40 pointer-events-none absolute inset-x-0 border-t"
                  style={{ top: hour * HOUR_HEIGHT }}
                />
              ))}

              {events.map((event) => (
                <EventBlock key={event.id} event={event} />
              ))}

              {isSameDay(day, now) && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                  style={{ top: nowOffset }}
                >
                  <span className="-ml-1 size-2 rounded-full bg-red-500" />
                  <span className="h-px flex-1 bg-red-500" />
                </div>
              )}

              {adding && isSameDay(adding.day, day) && (
                <>
                  <div
                    className="bg-primary/20 border-primary pointer-events-none absolute inset-x-0.5 rounded-md border-l-[3px]"
                    style={{
                      top: (minutesOfDay(adding.start) / 60) * HOUR_HEIGHT,
                      height: (DEFAULT_DURATION_MINUTES / 60) * HOUR_HEIGHT,
                    }}
                  />
                  <div
                    style={{
                      top: Math.min(
                        (minutesOfDay(adding.start) / 60) * HOUR_HEIGHT,
                        HOUR_HEIGHT * 24 - 190,
                      ),
                      left:
                        days.indexOf(day) > days.length / 2
                          ? undefined
                          : "100%",
                      right:
                        days.indexOf(day) > days.length / 2
                          ? "100%"
                          : undefined,
                    }}
                    className="absolute z-30"
                  >
                    <QuickAdd
                      start={adding.start}
                      onClose={() => setAdding(null)}
                    />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function gridDaysFor(anchor: Date, count: number, weekStartsOn: 0 | 1) {
  if (count === 7) {
    const start = startOfDay(anchor);
    const diff = (start.getDay() - weekStartsOn + 7) % 7;
    const first = addDays(start, -diff);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }
  const first = startOfDay(anchor);
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}
