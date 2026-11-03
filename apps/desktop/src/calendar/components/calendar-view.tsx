import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfDay,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@notiz/ui/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "@notiz/ui/components/ui/button-group";
import { Spinner } from "@notiz/ui/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@notiz/ui/components/ui/tooltip";
import { cn } from "@notiz/utils";

import { useSync } from "./context";
import { DayCell } from "./day-cell";
import { gridDaysFor, TimeGrid } from "./time-grid";

import {
  useCalendarData,
  useEnabledCalendars,
  useNow,
  useWeekStartsOn,
} from "~/calendar/hooks";
import { useCalendarNav } from "~/calendar/nav-store";
import type { CalendarSyncRange } from "~/services/calendar";
import { useMountEffect } from "~/shared/hooks/useMountEffect";

const WEEKDAY_HEADERS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_HEADERS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const VIEW_BREAKPOINTS = [
  { minWidth: 700, cols: 7 },
  { minWidth: 400, cols: 4 },
  { minWidth: 200, cols: 2 },
  { minWidth: 0, cols: 1 },
] as const;

type ViewMode = "month" | "week" | "day";
const VIEW_MODE_STORAGE_KEY = "notiz-calendar-view-mode";

function readStoredViewMode(): ViewMode {
  try {
    const value = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (value === "month" || value === "week" || value === "day") return value;
  } catch {}
  return "week";
}

const COMPACT_SCROLL_PAST_DAYS = 42;
const COMPACT_SCROLL_FUTURE_DAYS = 42;
const VISIBLE_RANGE_SYNC_QUERY_KEY = "calendar-visible-range-sync";
const VISIBLE_RANGE_SYNC_STALE_MS = 60 * 1000;

function useVisibleCols(ref: React.RefObject<HTMLDivElement | null>) {
  const [cols, setCols] = useState(7);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      const match = VIEW_BREAKPOINTS.find((bp) => width >= bp.minWidth);
      const next = match?.cols ?? 1;
      setCols((prev) => (prev === next ? prev : next));
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return cols;
}

export function CalendarView() {
  const { scheduleSync } = useSync();
  const now = useNow();
  const weekStartsOn = useWeekStartsOn();
  const weekOpts = useMemo(() => ({ weekStartsOn }), [weekStartsOn]);
  const [currentMonth, setCurrentMonth] = useState(now);
  const [viewMode, setViewModeState] = useState<ViewMode>(readStoredViewMode);
  const anchor = useCalendarNav((state) => state.anchor);
  const setAnchor = useCalendarNav((state) => state.setAnchor);
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {}
  }, []);
  const [visibleStart, setVisibleStart] = useState(() => startOfDay(now));
  const [compactVisibleStart, setCompactVisibleStart] = useState(() =>
    startOfDay(now),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const compactScrollRef = useRef<HTMLDivElement>(null);
  const compactBaseRef = useRef(startOfDay(now));
  const cols = useVisibleCols(containerRef);
  const calendarData = useCalendarData();
  const enabledCalendars = useEnabledCalendars();

  useMountEffect(() => {
    scheduleSync();
  });

  const isGrid = viewMode !== "month";
  const gridDayCount = viewMode === "day" ? 1 : cols;
  const isMonthView = !isGrid && cols === 7;

  const advanceCompact = useCallback(
    (direction: -1 | 1) => {
      const next = addDays(compactBaseRef.current, direction * cols);
      compactBaseRef.current = next;
      setVisibleStart(next);
    },
    [cols],
  );

  const goToPrev = useCallback(() => {
    if (isGrid) {
      setAnchor((a) => addDays(a, -gridDayCount));
    } else if (isMonthView) {
      setCurrentMonth((m) => subMonths(m, 1));
    } else {
      advanceCompact(-1);
    }
  }, [isGrid, gridDayCount, isMonthView, advanceCompact]);

  const goToNext = useCallback(() => {
    if (isGrid) {
      setAnchor((a) => addDays(a, gridDayCount));
    } else if (isMonthView) {
      setCurrentMonth((m) => addMonths(m, 1));
    } else {
      advanceCompact(1);
    }
  }, [isGrid, gridDayCount, isMonthView, advanceCompact]);

  useEffect(() => {
    setCurrentMonth(anchor);
  }, [anchor]);

  const goToToday = useCallback(() => {
    const todayStart = startOfDay(now);
    setAnchor(todayStart);
    compactBaseRef.current = todayStart;
    setCurrentMonth(now);
    setVisibleStart(todayStart);
    setCompactVisibleStart(todayStart);
  }, [now]);

  const gridDays = useMemo(
    () => gridDaysFor(anchor, gridDayCount, weekStartsOn),
    [anchor, gridDayCount, weekStartsOn],
  );

  const days = useMemo(() => {
    if (isGrid) {
      return gridDays;
    }

    if (isMonthView) {
      const monthStart = startOfMonth(currentMonth);
      const monthEnd = endOfMonth(currentMonth);
      const calStart = startOfWeek(monthStart, weekOpts);
      const calEnd = endOfWeek(monthEnd, weekOpts);
      return eachDayOfInterval({ start: calStart, end: calEnd });
    }

    return eachDayOfInterval({
      start: addDays(visibleStart, -COMPACT_SCROLL_PAST_DAYS),
      end: addDays(visibleStart, COMPACT_SCROLL_FUTURE_DAYS - 1),
    });
  }, [currentMonth, gridDays, isGrid, isMonthView, visibleStart, weekOpts]);

  const visibleRange = useMemo<CalendarSyncRange | null>(() => {
    const firstDay = days[0];
    const lastDay = days[days.length - 1];
    if (!firstDay || !lastDay) return null;

    return {
      from: startOfDay(firstDay),
      to: startOfDay(addDays(lastDay, 1)),
    };
  }, [days]);

  const enabledCalendarKey = useMemo(
    () =>
      enabledCalendars
        .map((calendar) => calendar.id)
        .sort()
        .join(","),
    [enabledCalendars],
  );

  useVisibleRangeSync(visibleRange, enabledCalendarKey);

  const visibleHeaders =
    weekStartsOn === 1 ? WEEKDAY_HEADERS_MON : WEEKDAY_HEADERS_SUN;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      switch (event.key) {
        case "t":
          goToToday();
          break;
        case "m":
          setViewMode("month");
          break;
        case "w":
          setViewMode("week");
          break;
        case "d":
          setViewMode("day");
          break;
        case "ArrowLeft":
          goToPrev();
          break;
        case "ArrowRight":
          goToNext();
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToToday, goToPrev, goToNext, setViewMode]);

  useEffect(() => {
    if (isGrid || isMonthView) {
      return;
    }

    const el = compactScrollRef.current;
    if (el) {
      const dayWidth = el.clientWidth / cols;
      el.scrollTo({ left: COMPACT_SCROLL_PAST_DAYS * dayWidth });
    }
    compactBaseRef.current = visibleStart;
    setCompactVisibleStart(visibleStart);
  }, [isGrid, isMonthView, visibleStart, cols]);

  const handleCompactScroll = useCallback(() => {
    const el = compactScrollRef.current;
    if (!el || cols <= 0) {
      return;
    }

    const dayWidth = el.clientWidth / cols;
    if (dayWidth <= 0) {
      return;
    }

    const maxStartIndex = Math.max(0, days.length - cols);
    const startIndex = Math.min(
      maxStartIndex,
      Math.max(0, Math.round(el.scrollLeft / dayWidth)),
    );
    const nextStart = startOfDay(addDays(days[0], startIndex));

    setCompactVisibleStart((prev) => {
      if (prev.getTime() === nextStart.getTime()) {
        return prev;
      }
      compactBaseRef.current = nextStart;
      return nextStart;
    });
  }, [cols, days]);

  const compactContentWidth = `${(days.length / cols) * 100}%`;

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      <div
        data-tauri-drag-region
        className={cn([
          "flex items-center justify-between",
          "border-border h-12 border-b py-2 pr-3 pl-3 select-none",
        ])}
      >
        <div className="flex items-center gap-2">
          <h2 className="font-display text-foreground text-xl">
            {isGrid
              ? format(gridDays[0], "MMMM yyyy")
              : isMonthView
                ? format(currentMonth, "MMMM yyyy")
                : format(compactVisibleStart, "MMMM yyyy")}
          </h2>
          <CalendarSyncHeaderControls />
        </div>
        <div
          data-tauri-drag-region="false"
          className="border-border bg-card mr-2 ml-auto flex h-8 items-center rounded-full border p-0.5"
        >
          {(["month", "week", "day"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={cn([
                "h-full rounded-full px-3 text-xs capitalize transition-colors",
                viewMode === mode
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              ])}
            >
              {mode}
            </button>
          ))}
        </div>
        <ButtonGroup
          data-tauri-drag-region="false"
          className={cn([
            "border-border h-8 overflow-hidden rounded-full border",
            "bg-card",
          ])}
        >
          <Button
            variant="ghost"
            size="icon"
            className="hover:bg-accent h-full w-10 rounded-none border-0 bg-transparent shadow-none"
            onClick={goToPrev}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <ButtonGroupSeparator className="bg-accent" />
          <Button
            variant="ghost"
            size="sm"
            className={cn([
              "h-full rounded-none border-0",
              "hover:bg-accent bg-transparent px-3 text-sm shadow-none",
            ])}
            onClick={goToToday}
          >
            Today
          </Button>
          <ButtonGroupSeparator className="bg-accent" />
          <Button
            variant="ghost"
            size="icon"
            className="hover:bg-accent h-full w-10 rounded-none border-0 bg-transparent shadow-none"
            onClick={goToNext}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </ButtonGroup>
      </div>

      {isGrid ? (
        <TimeGrid days={gridDays} calendarData={calendarData} />
      ) : isMonthView ? (
        <>
          <div
            className="border-border grid border-b"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {visibleHeaders.map((day, i) => (
              <div
                key={`${day}-${i}`}
                className={cn([
                  "text-center text-xs font-medium",
                  "py-2",
                  i < visibleHeaders.length - 1 && "border-r-border border-r",
                  day === "Sat" || day === "Sun"
                    ? "text-muted-foreground"
                    : "text-foreground",
                ])}
              >
                {day}
              </div>
            ))}
          </div>

          <div
            className="grid flex-1 auto-rows-fr overflow-hidden"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {days.map((day) => (
              <DayCell
                key={day.toISOString()}
                day={day}
                isCurrentMonth={isSameMonth(day, currentMonth)}
                calendarData={calendarData}
              />
            ))}
          </div>
        </>
      ) : (
        <div
          ref={compactScrollRef}
          className={cn([
            "scrollbar-hide min-h-0 flex-1 overflow-x-auto overflow-y-hidden",
            "snap-x snap-mandatory overscroll-x-contain",
          ])}
          onScroll={handleCompactScroll}
        >
          <div
            className="grid h-full min-w-full grid-rows-[auto_minmax(0,1fr)]"
            style={{
              width: compactContentWidth,
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            {days.map((day) => {
              const label = format(day, "EEE");
              return (
                <div
                  key={`header-${day.toISOString()}`}
                  className={cn([
                    "border-r-border border-b-border snap-start border-r border-b",
                    "py-2 text-center text-xs font-medium",
                    label === "Sat" || label === "Sun"
                      ? "text-muted-foreground"
                      : "text-foreground",
                  ])}
                >
                  {label}
                </div>
              );
            })}
            {days.map((day) => (
              <DayCell
                key={day.toISOString()}
                day={day}
                isCurrentMonth={true}
                calendarData={calendarData}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function useVisibleRangeSync(
  range: CalendarSyncRange | null,
  enabledCalendarKey: string,
) {
  const { canSync, syncRange } = useSync();
  const from = range?.from.toISOString();
  const to = range?.to.toISOString();

  useQuery({
    queryKey: [VISIBLE_RANGE_SYNC_QUERY_KEY, from, to, enabledCalendarKey],
    queryFn: async ({ signal }) => {
      if (!range) return null;
      await syncRange(range, signal);
      return null;
    },
    enabled: Boolean(range && canSync),
    staleTime: VISIBLE_RANGE_SYNC_STALE_MS,
    gcTime: 10 * VISIBLE_RANGE_SYNC_STALE_MS,
    retry: false,
  });
}

function CalendarSyncHeaderControls() {
  const queryClient = useQueryClient();
  const { status, cancelDebouncedSync, scheduleSync } = useSync();
  const refreshFeedbackTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [showManualRefreshFeedback, setShowManualRefreshFeedback] =
    useState(false);

  useEffect(() => {
    return () => {
      if (refreshFeedbackTimeoutRef.current) {
        clearTimeout(refreshFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const handleRefresh = useCallback(() => {
    if (refreshFeedbackTimeoutRef.current) {
      clearTimeout(refreshFeedbackTimeoutRef.current);
    }
    setShowManualRefreshFeedback(true);
    refreshFeedbackTimeoutRef.current = setTimeout(() => {
      refreshFeedbackTimeoutRef.current = null;
      setShowManualRefreshFeedback(false);
    }, 1500);
    void queryClient.invalidateQueries({
      queryKey: [VISIBLE_RANGE_SYNC_QUERY_KEY],
    });
    cancelDebouncedSync();
    scheduleSync();
  }, [cancelDebouncedSync, queryClient, scheduleSync]);

  const showSyncIndicator = showManualRefreshFeedback || status !== "idle";
  const statusText =
    status === "scheduled"
      ? "Sync scheduled"
      : showSyncIndicator
        ? "Syncing"
        : null;

  return (
    <div className="flex items-center">
      {showSyncIndicator ? (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground flex size-6 items-center justify-center">
              <Spinner size={12} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{statusText}</TooltipContent>
        </Tooltip>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          data-tauri-drag-region="false"
          onClick={handleRefresh}
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
