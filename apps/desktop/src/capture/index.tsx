import { format } from "date-fns";
import { CornerDownLeftIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { md2json } from "@notiz/editor/markdown";
import { commands as windowsCommands } from "@notiz/plugin-windows";
import { cn } from "@notiz/utils";

import { applyCaptureHotkey, formatHotkey, readCaptureHotkey } from "./hotkey";

import { appendToDailyNote } from "~/daily/append";
import { todayKey } from "~/daily/open-daily-tab";
import { showTransientToast } from "~/sidebar/toast/transient";
import * as main from "~/store/tinybase/store/main";
import { createSession } from "~/store/tinybase/store/sessions";

type Target = "today" | "note";

export function CapturePanel() {
  const store = main.UI.useStore(main.STORE_ID);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<Target>("today");
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const reset = () => {
      setText("");
      setSaved(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    };

    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("notiz://capture-opened", reset).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      }),
    );
    window.addEventListener("focus", () => inputRef.current?.focus());
    inputRef.current?.focus();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const close = () => void windowsCommands.captureHide();

  const save = () => {
    const value = text.trim();
    if (!value || !store) return;

    const lines = value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (target === "today") {
      const time = format(new Date(), "h:mm a");
      const [first, ...rest] = lines;
      appendToDailyNote(
        store as main.Store,
        todayKey(),
        [`**${time}** ${first}`, ...rest].join("\n\n"),
      );
    } else {
      const [title, ...rest] = lines;
      const id = createSession(store, title);
      store.setCell(
        "sessions",
        id,
        "raw_md",
        JSON.stringify(md2json([`# ${title}`, ...rest].join("\n\n"))),
      );
    }

    setSaved(true);
    window.setTimeout(close, 450);
  };

  return (
    <div
      className="bg-background border-border flex h-screen flex-col gap-3 overflow-hidden rounded-2xl border p-4 select-none"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <textarea
        ref={inputRef}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
        placeholder="What's on your mind?"
        className="text-foreground placeholder:text-muted-foreground min-h-0 flex-1 resize-none bg-transparent text-lg outline-none select-text"
      />
      <div className="flex items-center justify-between">
        <div className="border-border flex items-center rounded-full border p-0.5 text-xs">
          {(
            [
              ["today", "Today's page"],
              ["note", "New note"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTarget(id)}
              className={cn([
                "rounded-full px-3 py-1 transition-colors outline-none",
                target === id
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              ])}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          {saved ? (
            <span className="text-primary font-medium">Saved</span>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <CornerDownLeftIcon className="size-3" /> save
              </span>
              <span>⇧↵ new line</span>
              <span>esc</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Registers the saved shortcut at startup; the shortcut itself lives in Rust, so
// it keeps working after the main window is closed.
export function QuickCaptureHotkey() {
  useEffect(() => {
    const hotkey = readCaptureHotkey();
    void applyCaptureHotkey(hotkey).catch((error) => {
      console.error("[capture] could not register shortcut", error);
      showTransientToast(
        {
          description: `Quick capture shortcut ${formatHotkey(hotkey)} is taken by another app. Choose another in Settings.`,
          variant: "error",
        },
        { durationMs: 6000 },
      );
    });
  }, []);

  return null;
}
