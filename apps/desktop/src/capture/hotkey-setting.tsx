import { useEffect, useState } from "react";

import { Button } from "@notiz/ui/components/ui/button";
import { cn } from "@notiz/utils";

import {
  acceleratorFromEvent,
  applyCaptureHotkey,
  CAPTURE_HOTKEY_PRESETS,
  DEFAULT_CAPTURE_HOTKEY,
  formatHotkey,
  readCaptureHotkey,
} from "./hotkey";

export function QuickCaptureSetting() {
  const [hotkey, setHotkey] = useState(readCaptureHotkey);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string) => {
    setError(null);
    try {
      await applyCaptureHotkey(next);
      setHotkey(next);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "That shortcut is not available. Try another.",
      );
    }
  };

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }
      const next = acceleratorFromEvent(event);
      if (next) {
        setRecording(false);
        void save(next);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Capture shortcut</span>
          <span className="text-muted-foreground text-xs">
            Press it anywhere to jot something down. Pick a quick one, or record
            any key combo (two keys is easiest).
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRecording((r) => !r);
          }}
          className={cn([
            "border-border min-w-36 rounded-full border px-4 py-1.5 text-sm transition-colors",
            recording
              ? "border-primary text-primary"
              : "hover:bg-accent text-foreground",
          ])}
        >
          {recording ? "Press shortcut…" : formatHotkey(hotkey)}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">Quick picks</span>
        {CAPTURE_HOTKEY_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => void save(preset)}
            className={cn([
              "rounded-full border px-3 py-1 text-xs transition-colors",
              hotkey === preset
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            ])}
          >
            {formatHotkey(preset)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {hotkey !== DEFAULT_CAPTURE_HOTKEY && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => void save(DEFAULT_CAPTURE_HOTKEY)}
          >
            Reset to default
          </Button>
        )}
        {hotkey !== "" && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => void save("")}
          >
            Turn off
          </Button>
        )}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
