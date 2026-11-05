import { format, parseISO } from "date-fns";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { commands as calendarCommands } from "@notiz/plugin-calendar";
import { Button } from "@notiz/ui/components/ui/button";

import { useSync } from "./context";

import { showTransientToast } from "~/sidebar/toast/transient";
import * as main from "~/store/tinybase/store/main";

// Turns the native error into something a person can act on.
export function friendlyCalendarError(raw: string): string {
  const text = raw.toLowerCase();
  if (text.includes("event not found")) {
    return "Notiz can't find that event any more. Refresh the calendar and try again.";
  }
  if (text.includes("access denied") || text.includes("permission")) {
    return "Notiz needs full Calendar access. Turn it on in System Settings > Privacy & Security > Calendars.";
  }
  if (
    text.includes("doesn't allow") ||
    text.includes("does not allow") ||
    text.includes("read-only") ||
    text.includes("read only") ||
    text.includes("modif")
  ) {
    return "This calendar is read-only (for example a subscribed or shared calendar), so its events can't be changed here.";
  }
  return raw;
}

const inputClass =
  "border-border bg-background text-foreground w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-primary/50";

function useEditableEvent(eventId: string) {
  const row = main.UI.useRow("events", eventId, main.STORE_ID);
  const provider = String(row.provider ?? "");
  const trackingId = String(row.tracking_id_event ?? "");
  const recurring = Boolean(row.has_recurrence_rules);

  return {
    row,
    trackingId,
    // Only Apple Calendar can be written to, and recurring events need a
    // "this one or all" choice, which Calendar itself handles best.
    canEdit: provider === "apple" && !!trackingId && !recurring,
    isRecurringApple: provider === "apple" && recurring,
  };
}

function toLocalParts(iso: unknown) {
  const date = typeof iso === "string" ? parseISO(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return { day: "", time: "" };
  return { day: format(date, "yyyy-MM-dd"), time: format(date, "HH:mm") };
}

export function EventActions({
  eventId,
  onEdit,
}: {
  eventId: string;
  onEdit: () => void;
}) {
  const store = main.UI.useStore(main.STORE_ID);
  const { scheduleSync } = useSync();
  const { trackingId, canEdit, isRecurringApple } = useEditableEvent(eventId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isRecurringApple) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="w-full rounded-full"
        onClick={() => void calendarCommands.openCalendar("apple")}
      >
        Edit in Calendar
      </Button>
    );
  }
  if (!canEdit) return null;

  const remove = async () => {
    setBusy(true);
    const result = await calendarCommands.deleteEvent("apple", trackingId);
    setBusy(false);
    if (result.status === "error") {
      showTransientToast({
        description: friendlyCalendarError(String(result.error)),
        variant: "error",
      });
      return;
    }
    store?.delRow("events", eventId);
    scheduleSync();
    showTransientToast({ description: "Event deleted" });
  };

  if (confirming) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-center text-xs">
          Delete this event from Apple Calendar?
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="flex-1 rounded-full"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="flex-1 rounded-full"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        className="flex-1 gap-1.5 rounded-full"
        onClick={onEdit}
      >
        <PencilIcon className="size-3.5" />
        Edit
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="hover:text-destructive flex-1 gap-1.5 rounded-full"
        onClick={() => setConfirming(true)}
      >
        <Trash2Icon className="size-3.5" />
        Delete
      </Button>
    </div>
  );
}

export function EditEventForm({
  eventId,
  onDone,
}: {
  eventId: string;
  onDone: () => void;
}) {
  const store = main.UI.useStore(main.STORE_ID);
  const { scheduleSync } = useSync();
  const { row, trackingId } = useEditableEvent(eventId);
  const start = toLocalParts(row.started_at);
  const end = toLocalParts(row.ended_at);

  const [title, setTitle] = useState(String(row.title ?? ""));
  const [day, setDay] = useState(start.day);
  const [startTime, setStartTime] = useState(start.time);
  const [endTime, setEndTime] = useState(end.time);
  const [location, setLocation] = useState(String(row.location ?? ""));
  const [notes, setNotes] = useState(String(row.description ?? ""));
  const [saving, setSaving] = useState(false);

  const startedAt = new Date(`${day}T${startTime}`);
  const endedAt = new Date(`${day}T${endTime}`);
  const valid =
    title.trim().length > 0 &&
    !Number.isNaN(startedAt.getTime()) &&
    !Number.isNaN(endedAt.getTime()) &&
    endedAt > startedAt;

  const save = async () => {
    setSaving(true);
    const result = await calendarCommands.updateEvent("apple", {
      event_tracking_id: trackingId,
      title: title.trim(),
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      is_all_day: null,
      location,
      notes,
    });
    setSaving(false);

    if (result.status === "error") {
      showTransientToast({
        description: friendlyCalendarError(String(result.error)),
        variant: "error",
      });
      return;
    }

    store?.setPartialRow("events", eventId, {
      title: title.trim(),
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      location,
      description: notes,
    });
    scheduleSync();
    showTransientToast({ description: "Event updated" });
    onDone();
  };

  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !saving) void save();
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        aria-label="Title"
        className={inputClass}
      />
      <input
        type="date"
        value={day}
        onChange={(e) => setDay(e.target.value)}
        aria-label="Date"
        className={inputClass}
      />
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          aria-label="Start time"
          className={inputClass}
        />
        <span className="text-muted-foreground text-xs">to</span>
        <input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          aria-label="End time"
          className={inputClass}
        />
      </div>
      <input
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Location"
        aria-label="Location"
        className={inputClass}
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        aria-label="Notes"
        rows={3}
        className={`${inputClass} resize-none`}
      />
      {!valid && title.trim() && (
        <p className="text-destructive text-xs">
          End time must be after the start.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="flex-1 rounded-full"
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="flex-1 rounded-full"
          disabled={!valid || saving}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
