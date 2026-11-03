import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isSameWeek,
  startOfMonth,
  startOfWeek,
  addMonths,
  subMonths,
} from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@notiz/utils";

import { useNow, useWeekStartsOn } from "~/calendar/hooks";
import { useCalendarNav } from "~/calendar/nav-store";

export function MiniMonth() {
  const anchor = useCalendarNav((state) => state.anchor);
  const setAnchor = useCalendarNav((state) => state.setAnchor);
  const weekStartsOn = useWeekStartsOn();
  const now = useNow();
  const [month, setMonth] = useState(() => startOfMonth(anchor));

  useEffect(() => {
    setMonth(startOfMonth(anchor));
  }, [anchor]);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(month, { weekStartsOn }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn }),
      }),
    [month, weekStartsOn],
  );
  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) result.push(days.slice(i, i + 7));
    return result;
  }, [days]);
  const headers =
    weekStartsOn === 1
      ? ["M", "T", "W", "T", "F", "S", "S"]
      : ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-foreground text-sm font-medium">
          {format(month, "MMMM yyyy")}
        </span>
        <div className="flex items-center">
          {[
            { label: "Previous month", icon: ChevronLeftIcon, delta: -1 },
            { label: "Next month", icon: ChevronRightIcon, delta: 1 },
          ].map(({ label, icon: Icon, delta }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={() =>
                setMonth((m) => (delta < 0 ? subMonths(m, 1) : addMonths(m, 1)))
              }
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md p-1 transition-colors"
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 text-center">
        {headers.map((label, index) => (
          <span
            key={`${label}-${index}`}
            className="text-muted-foreground pb-1 text-[10px] font-medium"
          >
            {label}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        {weeks.map((week) => {
          const selectedWeek = isSameWeek(week[0], anchor, { weekStartsOn });
          return (
            <div
              key={week[0].toISOString()}
              className={cn([
                "grid grid-cols-7 rounded-full text-center",
                selectedWeek && "bg-accent",
              ])}
            >
              {week.map((day) => {
                const today = isSameDay(day, now);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setAnchor(day)}
                    className={cn([
                      "mx-auto flex size-7 items-center justify-center rounded-full text-xs transition-colors",
                      today
                        ? "bg-primary text-primary-foreground font-semibold"
                        : [
                            isSameMonth(day, month)
                              ? "text-foreground"
                              : "text-muted-foreground/50",
                            "hover:bg-foreground/10",
                          ],
                    ])}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
