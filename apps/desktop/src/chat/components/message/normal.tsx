import { useLingui } from "@lingui/react/macro";
import { BrainIcon, CheckIcon, CopyIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import { cn } from "@notiz/utils";

import { Disclosure, MessageBubble, MessageContainer } from "./shared";
import { Tool } from "./tool";
import type { Part } from "./types";

import { hasRenderableContent } from "~/chat/components/shared";
import type { NotizUIMessage } from "~/chat/types";

function getMessageText(message: NotizUIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<Part, { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

export function NormalMessage({
  message,
  handleReload,
}: {
  message: NotizUIMessage;
  handleReload?: () => void;
}) {
  const { t } = useLingui();
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const copiedResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedResetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    const text = getMessageText(message);
    try {
      await navigator.clipboard.writeText(text);
      if (copiedResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedResetTimeoutRef.current);
      }
      setCopied(true);
      copiedResetTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedResetTimeoutRef.current = null;
      }, 2000);
    } catch {
      // ignore
    }
  }, [message]);

  if (!hasRenderableContent(message)) {
    return null;
  }

  return (
    <MessageContainer align={isUser ? "end" : "start"}>
      <div
        className={cn([
          "flex min-w-0 flex-col",
          isUser ? "max-w-[85%] items-end" : "group w-full",
        ])}
      >
        <MessageBubble variant={isUser ? "user" : "assistant"}>
          {message.parts.map((part, i) => (
            <Part key={i} part={part as Part} />
          ))}
        </MessageBubble>
        {!isUser && (
          <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={handleCopy}
              className={`p-1 transition-colors ${copied ? "text-green-500" : "text-muted-foreground hover:text-foreground"}`}
              aria-label={t`Copy message`}
            >
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            </button>
            {handleReload && (
              <button
                onClick={handleReload}
                className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                aria-label={t`Regenerate message`}
              >
                <RotateCcwIcon size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </MessageContainer>
  );
}

function Part({ part }: { part: Part }) {
  if (part.type === "reasoning") {
    return <Reasoning part={part} />;
  }
  if (part.type === "text") {
    return <Text part={part} />;
  }
  if (part.type === "step-start") {
    return null;
  }

  return <Tool part={part} />;
}

function Reasoning({ part }: { part: Extract<Part, { type: "reasoning" }> }) {
  const raw = part.text.trim();

  if (!raw) {
    return null;
  }

  const cleaned = raw
    .replace(/[\n`*#"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const streaming = part.state !== "done";
  const title = streaming ? cleaned.slice(-150) : cleaned;

  if (!title) {
    return null;
  }

  return (
    <Disclosure
      icon={<BrainIcon className="h-3 w-3" />}
      title={title}
      disabled={streaming}
    >
      <div className="text-muted-foreground text-sm whitespace-pre-wrap">
        {part.text}
      </div>
    </Disclosure>
  );
}

const chatComponents = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="font-display mt-5 mb-2 text-xl first:mt-0">
      {props.children as React.ReactNode}
    </h1>
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="font-display mt-5 mb-2 text-lg first:mt-0">
      {props.children as React.ReactNode}
    </h2>
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-foreground mt-4 mb-1.5 text-[15px] font-semibold first:mt-0">
      {props.children as React.ReactNode}
    </h3>
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="marker:text-muted-foreground mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
      {props.children as React.ReactNode}
    </ul>
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="marker:text-muted-foreground mb-3 list-decimal space-y-1.5 pl-5 last:mb-0">
      {props.children as React.ReactNode}
    </ol>
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="pl-0.5">{props.children as React.ReactNode}</li>
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-3 last:mb-0">{props.children as React.ReactNode}</p>
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="text-foreground font-semibold">
      {props.children as React.ReactNode}
    </strong>
  ),
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="border-border text-muted-foreground my-3 border-l-2 pl-4 italic">
      {props.children as React.ReactNode}
    </blockquote>
  ),
} as const;

function Text({ part }: { part: Extract<Part, { type: "text" }> }) {
  const isAnimating = part.state !== "done";

  return (
    <Streamdown
      components={chatComponents}
      className="[&_a]:text-primary px-0.5 py-1 [&_a]:underline-offset-2 hover:[&_a]:underline"
      caret="block"
      isAnimating={isAnimating}
      linkSafety={{ enabled: false }}
    >
      {part.text}
    </Streamdown>
  );
}
