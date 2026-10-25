import { ArrowRightIcon, CalendarIcon } from "lucide-react";

import type { AgendaDay } from "~/chat/types";
import { useTabs } from "~/store/zustand/tabs";

// The days an answer is about, laid out the way the calendar thinks of them, so
// the reply itself can be a sentence or two. Clicking opens the Calendar.
export function AgendaCard({ days }: { days: AgendaDay[] }) {
  const openNew = useTabs((state) => state.openNew);
  const open = () => openNew({ type: "calendar" });

  return (
    <div className="border-border my-2 overflow-hidden rounded-2xl border">
      <div className="divide-border divide-y">
        {days.map((day) => (
          <section key={day.label} className="px-3.5 py-2.5">
            <h4 className="text-muted-foreground pb-1.5 text-xs font-medium">
              {day.label}
            </h4>
            <ul className="flex flex-col gap-1.5">
              {day.events.map((event, index) => (
                <li
                  key={`${event.time}-${event.title}-${index}`}
                  className="flex items-baseline gap-3 text-sm"
                >
                  <span className="text-muted-foreground w-32 shrink-0 text-xs tabular-nums">
                    {event.time}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground">{event.title}</span>
                    {event.location && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {event.location}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <button
        type="button"
        onClick={open}
        className="border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground flex w-full items-center gap-2 border-t px-3.5 py-2 text-xs transition-colors"
      >
        <CalendarIcon className="size-3.5" />
        Open Calendar
        <ArrowRightIcon className="ml-auto size-3.5" />
      </button>
    </div>
  );
}
