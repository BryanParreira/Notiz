import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfDay, format, isToday, parseISO, startOfDay } from "date-fns";
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { commands as openerCommands } from "@notiz/plugin-opener2";
import { commands as todoCommands, type Reminder } from "@notiz/plugin-todo";
import { cn } from "@notiz/utils";

const identify = (reminder: Reminder) => ({
  calendar_item_identifier: reminder.calendar_item_identifier,
  external_identifier: reminder.external_identifier,
  list_id: reminder.list.id,
});

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
        alarms: null,
        recurrence_rules: null,
        is_completed: null,
        completion_date: null,
      });
      if (result.status === "error") throw new Error(result.error);
    },
    onSuccess: () => {
      setDraft("");
      return refresh();
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: async (value: {
      reminder: Reminder;
      title: string;
      notes: string;
      date: string;
    }) => {
      const result = await todoCommands.updateTodo(identify(value.reminder), {
        title: value.title,
        notes: value.notes,
        due_date: value.date
          ? { date: value.date, time: null, time_zone: null }
          : null,
        clear_due_date: value.date ? null : true,
        is_completed: null,
      });
      if (result.status === "error") throw new Error(result.error);
    },
    onSuccess: () => {
      setEditingId(null);
      return refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async (reminder: Reminder) => {
      const result = await todoCommands.deleteTodo(identify(reminder));
      if (result.status === "error") throw new Error(result.error);
    },
    onSuccess: refresh,
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
                {editingId === reminder.calendar_item_identifier ? (
                  <ReminderEditor
                    reminder={reminder}
                    saving={update.isPending}
                    error={update.isError ? update.error : null}
                    onCancel={() => setEditingId(null)}
                    onSave={(value) => update.mutate({ reminder, ...value })}
                  />
                ) : (
                  <div className="hover:bg-accent group flex items-center gap-3 px-5 py-2.5 transition-colors">
                    <button
                      type="button"
                      aria-label={`Complete ${reminder.title}`}
                      disabled={complete.isPending}
                      onClick={() => complete.mutate(reminder)}
                      className="border-border hover:border-primary flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors"
                    >
                      <CheckIcon className="text-primary size-3 opacity-0 transition-opacity hover:opacity-100" />
                    </button>
                    <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                      {reminder.title}
                    </span>
                    {dueLabel(reminder) && (
                      <span className="text-muted-foreground text-xs">
                        {dueLabel(reminder)}
                      </span>
                    )}
                    <span className="text-muted-foreground/80 text-xs group-hover:hidden">
                      {reminder.list.title}
                    </span>
                    <span className="hidden items-center gap-0.5 group-hover:flex">
                      <button
                        type="button"
                        aria-label="Edit reminder"
                        onClick={() =>
                          setEditingId(reminder.calendar_item_identifier)
                        }
                        className="text-muted-foreground hover:text-foreground rounded-full p-1"
                      >
                        <PencilIcon className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete reminder"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(reminder)}
                        className="text-muted-foreground hover:text-destructive rounded-full p-1"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    </span>
                  </div>
                )}
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

function ReminderEditor({
  reminder,
  saving,
  error,
  onCancel,
  onSave,
}: {
  reminder: Reminder;
  saving: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (value: { title: string; notes: string; date: string }) => void;
}) {
  const [title, setTitle] = useState(reminder.title);
  const [notes, setNotes] = useState(reminder.notes ?? "");
  const [date, setDate] = useState(reminder.due_date_components?.date ?? "");
  const field =
    "border-border bg-background text-foreground rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-primary/50";

  return (
    <form
      className="flex flex-col gap-2 px-5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSave({ title: title.trim(), notes, date });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Reminder title"
        className={field}
      />
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Due date"
          className={cn([field, "flex-1"])}
        />
        <button
          type="button"
          onClick={() => setDate("")}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          No date
        </button>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        aria-label="Notes"
        rows={2}
        className={cn([field, "resize-none"])}
      />
      {error ? (
        <p className="text-destructive text-xs">
          {error instanceof Error ? error.message : "Could not save."}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground rounded-full px-3 py-1 text-sm"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="bg-primary text-primary-foreground rounded-full px-4 py-1 text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
