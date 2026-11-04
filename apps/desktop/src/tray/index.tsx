import { format, isPast, parseISO } from "date-fns";
import {
  CalendarDaysIcon,
  CheckIcon,
  MailIcon,
  MoreHorizontalIcon,
  PlusIcon,
  VideoIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  commands as trayCommands,
  type TrayEventItem,
  type TraySummary,
} from "@notiz/plugin-tray";
import { cn } from "@notiz/utils";

const EMPTY: TraySummary = { title: null, next: null, agenda: [], unread: 0 };

function useTraySummary() {
  const [summary, setSummary] = useState<TraySummary>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void trayCommands.getTraySummary().then((result) => {
      if (!cancelled && result.status === "ok") setSummary(result.data);
    });

    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<TraySummary>("notiz://tray-summary", ({ payload }) =>
        setSummary(payload),
      ).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      }),
    );

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return summary;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function act(kind: string, value: string | null = null) {
  void trayCommands.trayAction(kind, value);
}

function countdown(start: Date, now: Date) {
  const minutes = Math.ceil((start.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "Happening now";
  if (minutes < 60) return `In ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0
    ? `In ${hours} hr`
    : `In ${hours} hr ${minutes % 60} min`;
}

function timeRange(item: TrayEventItem) {
  if (!item.start || !item.end) return "";
  return `${format(parseISO(item.start), "h:mm")} – ${format(parseISO(item.end), "h:mm a")}`;
}

function NextCard({ item, now }: { item: TrayEventItem; now: Date }) {
  const start = item.start ? parseISO(item.start) : now;
  const live = start <= now;

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
          {live ? "Now" : "Up next"}
        </span>
        <span
          className={cn([
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            live
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-foreground",
          ])}
        >
          {countdown(start, now)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => act("open_event", item.id)}
        className="flex items-start gap-3 text-left"
      >
        <span
          className="mt-1 h-10 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: item.color || "var(--primary)" }}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-display text-foreground line-clamp-2 text-lg leading-snug">
            {item.title}
          </span>
          <span className="text-muted-foreground text-xs">
            {timeRange(item)}
          </span>
        </span>
      </button>

      <div className="flex gap-2">
        {item.join_url && (
          <button
            type="button"
            onClick={() => act("join", item.join_url)}
            className="bg-primary text-primary-foreground flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-xs font-medium transition-opacity hover:opacity-90"
          >
            <VideoIcon className="size-3.5" />
            Join
          </button>
        )}
        <button
          type="button"
          onClick={() => act("open_event", item.id)}
          className="border-border hover:bg-accent text-foreground flex h-8 flex-1 items-center justify-center rounded-full border text-xs font-medium transition-colors"
        >
          Open notes
        </button>
      </div>
    </div>
  );
}

function AgendaRow({ item, now }: { item: TrayEventItem; now: Date }) {
  const end = item.end ? parseISO(item.end) : null;
  const done = end ? isPast(end) && end < now : false;

  return (
    <button
      type="button"
      onClick={() => act("open_event", item.id)}
      className={cn([
        "hover:bg-accent flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors",
        done && "opacity-50",
      ])}
    >
      <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">
        {item.start ? format(parseISO(item.start), "h:mm a") : ""}
      </span>
      <span
        className="h-4 w-0.5 shrink-0 rounded-full"
        style={{ backgroundColor: item.color || "var(--primary)" }}
      />
      <span className="text-foreground min-w-0 flex-1 truncate text-sm">
        {item.title}
      </span>
    </button>
  );
}

function ActionButton({
  icon: Icon,
  label,
  badge,
  onClick,
}: {
  icon: typeof PlusIcon;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-accent text-foreground relative flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors"
    >
      <Icon className="size-4" />
      {label}
      {badge ? (
        <span className="bg-primary text-primary-foreground absolute top-1 right-3 min-w-4 rounded-full px-1 text-center text-[10px] leading-4">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const items = [
    ["Open Notiz", "app_open"],
    ["Settings", "app_settings"],
    ["Check for updates", "app_update"],
    ["Quit Notiz", "app_quit"],
  ] as const;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="More"
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-full transition-colors"
      >
        <MoreHorizontalIcon className="size-4" />
      </button>
      {open && (
        <div className="border-border bg-popover absolute top-8 right-0 z-10 flex w-44 flex-col rounded-xl border p-1 shadow-lg">
          {items.map(([label, kind]) => (
            <button
              key={kind}
              type="button"
              onClick={() => act(kind)}
              className="hover:bg-accent text-foreground rounded-lg px-3 py-1.5 text-left text-sm transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TrayPanel() {
  const summary = useTraySummary();
  const now = useNow();

  useEffect(() => {
    const root = document.documentElement;
    const previous = [root.style.background, document.body.style.background];
    root.style.background = "transparent";
    document.body.style.background = "transparent";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") act("close");
    };
    window.addEventListener("keydown", onKey);

    return () => {
      root.style.background = previous[0];
      document.body.style.background = previous[1];
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const later = summary.agenda.filter((e) => e.id !== summary.next?.id);

  return (
    <div className="bg-background border-border flex h-screen flex-col overflow-hidden rounded-2xl border select-none [&_button]:outline-none [&_button]:focus-visible:ring-0 [&_button]:focus-visible:outline-none">
      <div className="flex items-start justify-between px-4 pt-4 pb-3">
        <div>
          <div className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
            {format(now, "EEEE")}
          </div>
          <div className="font-display text-foreground text-2xl">
            {format(now, "MMMM d")}
          </div>
        </div>
        <MoreMenu />
      </div>

      <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-3">
        {summary.next ? (
          <NextCard item={summary.next} now={now} />
        ) : (
          <div className="border-border text-muted-foreground flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
            <CheckIcon className="size-5" />
            Nothing else on your calendar today.
          </div>
        )}

        {later.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <div className="text-muted-foreground px-2 pb-1 text-[11px] font-medium tracking-wider uppercase">
              Later today
            </div>
            {later.map((item) => (
              <AgendaRow key={item.id} item={item} now={now} />
            ))}
          </div>
        )}
      </div>

      <div className="border-border flex gap-1 border-t px-2 py-2">
        <ActionButton
          icon={PlusIcon}
          label="New note"
          onClick={() => act("new_note")}
        />
        <ActionButton
          icon={CalendarDaysIcon}
          label="Calendar"
          onClick={() => act("open_calendar")}
        />
        <ActionButton
          icon={MailIcon}
          label="Inbox"
          badge={summary.unread}
          onClick={() => act("open_inbox")}
        />
      </div>
    </div>
  );
}
