import type { ChatStatus } from "ai";
import { AnimatePresence, motion } from "motion/react";

import { ErrorMessage } from "~/chat/components/message/error";
import { LoadingMessage } from "~/chat/components/message/loading";
import { NormalMessage } from "~/chat/components/message/normal";
import { hasRenderableContent } from "~/chat/components/shared";
import type { NotizUIMessage } from "~/chat/types";

export function ChatBodyNonEmpty({
  messages,
  status,
  error,
  onReload,
}: {
  messages: NotizUIMessage[];
  status: ChatStatus;
  error?: Error;
  onReload?: () => void;
}) {
  const showErrorState = status === "error" && error;
  const lastMessage = messages[messages.length - 1];
  const showLoadingState =
    (status === "submitted" || status === "streaming") &&
    (lastMessage?.role !== "assistant" || !hasRenderableContent(lastMessage));

  // A model can finish without writing anything, or only print a tool call that
  // is hidden. Never leave the user staring at their own message in silence.
  const noReply =
    status === "ready" &&
    !showErrorState &&
    (lastMessage?.role === "user" ||
      (lastMessage?.role === "assistant" &&
        !hasRenderableContent(lastMessage)));

  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  return (
    <div className="flex flex-col">
      {messages.map((message, index) => (
        <motion.div
          key={message.id}
          // The user's own message is already on screen as they hit send, so it
          // must not fade in from nothing.
          initial={message.role === "user" ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <NormalMessage
            message={message}
            handleReload={
              message.role === "assistant" &&
              index === lastAssistantIndex &&
              onReload
                ? onReload
                : undefined
            }
          />
        </motion.div>
      ))}
      <AnimatePresence>
        {showLoadingState && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <LoadingMessage />
          </motion.div>
        )}
      </AnimatePresence>
      {showErrorState && <ErrorMessage error={error} onRetry={onReload} />}
      {noReply && (
        <ErrorMessage
          error={new Error("No answer came back. Try again.")}
          onRetry={onReload}
        />
      )}
    </div>
  );
}
