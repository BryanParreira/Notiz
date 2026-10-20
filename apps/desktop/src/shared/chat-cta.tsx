import { useLingui } from "@lingui/react/macro";
import { SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@notiz/utils";

import { useShell } from "~/contexts/shell";

export function ChatCTA({
  label,
  ariaLabel,
}: {
  label?: ReactNode;
  ariaLabel?: string;
}) {
  const { t } = useLingui();
  const { chat } = useShell();
  const isChatOpen = chat.mode !== "FloatingClosed";
  const resolvedLabel = label ?? t`Ask anything`;

  const handleClick = () => {
    chat.sendEvent({ type: "OPEN" });
  };

  if (isChatOpen) {
    return null;
  }

  return (
    <button
      type="button"
      data-chat-cta-trigger
      aria-label={ariaLabel ?? t`Ask Notiz anything`}
      onClick={handleClick}
      className="group/notiz-chat-cta relative h-11 w-[28rem] max-w-full cursor-text focus-visible:outline-none"
    >
      <span
        data-chat-cta-surface
        aria-hidden="true"
        className={cn([
          "pointer-events-none absolute inset-0 flex items-center gap-3 rounded-full border px-5 text-sm",
          "border-border bg-card/95 text-muted-foreground backdrop-blur",
          "shadow-[0_8px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]",
          "transition-[border-color,box-shadow] duration-200 ease-out",
          "group-hover/notiz-chat-cta:border-primary/40 group-hover/notiz-chat-cta:shadow-[0_12px_36px_rgba(0,0,0,0.12)]",
          "group-focus-visible/notiz-chat-cta:ring-ring group-focus-visible/notiz-chat-cta:ring-2",
        ])}
      >
        <SparklesIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          {resolvedLabel}
        </span>
      </span>
    </button>
  );
}

export function FloatingChatCTA({ label }: { label?: ReactNode }) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex w-[calc(100%-2rem)] -translate-x-1/2 items-end justify-center">
      <div className="pointer-events-auto max-w-full">
        <ChatCTA label={label} />
      </div>
    </div>
  );
}
