import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfDay, format, isToday, parseISO, startOfDay } from "date-fns";
import { CheckIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { commands as openerCommands } from "@notiz/plugin-opener2";
import { commands as todoCommands, type Reminder } from "@notiz/plugin-todo";
import { cn } from "@notiz/utils";

const REMINDERS_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders";

function useReminderAccess() {
  return useQuery({
    queryKey: ["reminders-access"],
    queryFn: async () => {
      const result = await todoCommands.authorizationStatus();
      return result.status === "ok" ? result.data : "Unsupported";
    },
    refetchInterval: (query) =>
      query.state.data === "Authorized" ? false : 3000,
  });
}

function dueLabel(reminder: Reminder) {
  const due = reminder.due_date_components;
  if (!due?.date) return null;
  if (!due.time) return null;
  const date = parseISO(`${due.date}T${due.time}`);
  return Number.isNaN(date.getTime()) ? null : format(date, "h:mm a");
}

export function RemindersSection({ day }: { day: Date }) {
  const queryClient = useQueryClient();
  const access = useReminderAccess();
  const [draft, setDraft] = useState("");
  const dayKey = format(day, "yyyy-MM-dd");
  const authorized = access.data === "Authorized";

  const reminders = useQuery({
    queryKey: ["reminders", dayKey],
    enabled: authorized,
    refetchInterval: 60_000,
    queryFn: async () => {
      const result = await todoCommands.fetchTodos({
        kind: {
          Incomplete: {
            // Today also shows what is overdue; other days show only their own.
            from: isToday(day) ? null : startOfDay(day).toISOString(),
            to: endOfDay(day).toISOString(),
          },
        },
        list_ids: null,
      });
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["reminders", dayKey] });

  const complete = useMutation({
    mutationFn: async (reminder: Reminder) => {
      const result = await todoCommands.completeTodo({
        calendar_item_identifier: reminder.calendar_item_identifier,
        external_identifier: reminder.external_identifier,
        list_id: reminder.list.id,
      });
      if (result.status === "error") throw new Error(result.error);
    },
    onSuccess: refresh,
  });

  const create = useMutation({
    mutationFn: async (title: string) => {
      const result = await todoCommands.createTodo({
        title,
        list_id: null,
        notes: null,
        url: null,
        priority: null,
        due_date: { date: dayKey, time: null, time_zone: null },
        start_date: null,
      });
      if (result.status === "error") throw new Error(result.error);
    },
    onSuccess: () => {
      setDraft("");
      return refresh();
    },
  });

  const request = useMutation({
    mutationFn: () => todoCommands.requestFullAccess(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["reminders-access"] }),
  });

  if (access.data === "Unsupported" || access.isPending) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-foreground text-2xl leading-none">
        Reminders
      </h2>

      {!authorized ? (
        <div className="border-border text-muted-foreground flex flex-col items-start gap-3 rounded-2xl border border-dashed px-5 py-4 text-sm">
          <p>
            {access.data === "Denied"
              ? "Reminders access is off. Turn it on in System Settings to see and add reminders here."
              : "Show your Apple Reminders next to your day. Notiz only reads them on this Mac."}
          </p>
          <button
            type="button"
            onClick={() =>
              access.data === "Denied"
                ? void openerCommands.openUrl(REMINDERS_SETTINGS_URL, null)
                : request.mutate()
            }
            className="bg-primary text-primary-foreground rounded-full px-4 py-1.5 text-sm transition-opacity hover:opacity-90"
          >
            {access.data === "Denied" ? "Open System Settings" : "Allow access"}
          </button>
        </div>
      ) : (
        <div className="border-border bg-card overflow-hidden rounded-2xl border">
          {(reminders.data ?? []).length === 0 && !reminders.isPending && (
            <p className="text-muted-foreground px-5 py-3 text-sm">
              Nothing due.
            </p>
          )}
          <ul className="divide-border divide-y divide-dashed">
            {(reminders.data ?? []).map((reminder) => (
              <li key={reminder.calendar_item_identifier}>
                <button
                  type="button"
                  disabled={complete.isPending}
                  onClick={() => complete.mutate(reminder)}
                  className="hover:bg-accent group flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
                >
                  <span
                    className={cn([
                      "border-border group-hover:border-primary flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                    ])}
                  >
                    <CheckIcon className="text-primary size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                    {reminder.title}
                  </span>
                  {dueLabel(reminder) && (
                    <span className="text-muted-foreground text-xs">
                      {dueLabel(reminder)}
                    </span>
                  )}
                  <span className="text-muted-foreground/80 text-xs">
                    {reminder.list.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const title = draft.trim();
              if (title) create.mutate(title);
            }}
            className="border-border flex items-center gap-3 border-t px-5 py-2.5"
          >
            <PlusIcon className="text-muted-foreground size-4 shrink-0" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                isToday(day) ? "Add a reminder for today" : "Add a reminder"
              }
              aria-label="Add a reminder"
              className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </form>
          {create.isError && (
            <p className="text-destructive px-5 pb-3 text-xs">
              {create.error instanceof Error
                ? create.error.message
                : "Could not add the reminder."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
