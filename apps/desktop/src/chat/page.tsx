import "./page.css";

import { Trans } from "@lingui/react/macro";
import { format } from "date-fns";
import { MessageCircleIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect } from "react";

import { ChatBody } from "./components/body";
import { ChatSessionHost } from "./components/chat-panel";
import { ChatContent } from "./components/content";
import { ChatToolbarControls } from "./components/toolbar-controls";
import { ChatPageProvider } from "./page-context";
import { takePendingChatPrompt } from "./pending-prompt";
import { useChatActions } from "./store/use-chat-actions";

import { useLanguageModel } from "~/ai/hooks";
import { useShell } from "~/contexts/shell";
import { StandardTabWrapper } from "~/shared/main";
import * as main from "~/store/tinybase/store/main";
import { useTabs } from "~/store/zustand/tabs";

export function TabContentChat() {
  return (
    <StandardTabWrapper>
      <ChatSessionHost>
        {(sessionProps) =>
          sessionProps ? <ChatPage sp={sessionProps} /> : null
        }
      </ChatSessionHost>
    </StandardTabWrapper>
  );
}

type SessionProps = NonNullable<
  Parameters<Parameters<typeof ChatSessionHost>[0]["children"]>[0]
>;

function ChatPage({ sp }: { sp: SessionProps }) {
  const { chat } = useShell();
  const openCurrent = useTabs((state) => state.openCurrent);
  const model = useLanguageModel("chat");
  const { groupId, setGroupId } = chat;

  const { handleSendMessage } = useChatActions({
    groupId,
    onGroupCreated: useCallback(
      (newGroupId: string) => setGroupId(newGroupId),
      [setGroupId],
    ),
  });

  const userId = main.UI.useValues(main.STORE_ID).user_id;
  const name = main.UI.useCell(
    "humans",
    String(userId ?? ""),
    "name",
    main.STORE_ID,
  );
  const firstName = String(name ?? "").split(" ")[0];

  const isEmpty = sp.messages.length === 0;

  const send = useCallback(
    (content: string) =>
      handleSendMessage(
        content,
        [{ type: "text", text: content }],
        sp.sendMessage,
        sp.pendingRefs,
      ),
    [handleSendMessage, sp.sendMessage, sp.pendingRefs],
  );

  // A question typed on Home is answered here, so the user never has to ask twice.
  useEffect(() => {
    if (!model) return;
    const prompt = takePendingChatPrompt();
    if (prompt) send(prompt);
  }, [model, send]);

  return (
    <ChatPageProvider value>
      <div
        data-chat-empty={isEmpty ? "" : undefined}
        className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-4"
      >
        <div className="h-12 shrink-0">
          <ChatToolbarControls
            currentChatGroupId={groupId}
            layout="right-panel"
            onClose={() => openCurrent({ type: "empty" })}
            onNewChat={chat.startNewChat}
            onSelectChat={chat.selectChat}
            surface="light"
          />
        </div>

        <ChatContent
          {...sp}
          layout="right-panel"
          model={model}
          handleSendMessage={handleSendMessage}
        >
          {isEmpty ? (
            <>
              <Landing firstName={firstName} modelReady={!!model} />
              <Recents onSelect={chat.selectChat} />
            </>
          ) : (
            <ChatBody
              messages={sp.messages}
              status={sp.status}
              error={sp.error}
              onReload={sp.regenerate}
              isModelConfigured={!!model}
              hasContext={sp.contextEntities.length > 0}
              onSendMessage={(content, parts) =>
                handleSendMessage(
                  content,
                  parts,
                  sp.sendMessage,
                  sp.pendingRefs,
                )
              }
            />
          )}
        </ChatContent>
      </div>
    </ChatPageProvider>
  );
}

function Landing({
  firstName,
  modelReady,
}: {
  firstName: string;
  modelReady: boolean;
}) {
  return (
    <div
      data-chat-part="greeting"
      className="flex flex-none flex-col gap-3 pb-6"
    >
      <h1 className="font-display text-foreground text-4xl leading-tight">
        {firstName ? (
          <Trans>Hi {firstName}, ask anything</Trans>
        ) : (
          <Trans>Ask anything</Trans>
        )}
      </h1>
      {!modelReady && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <SparklesIcon className="size-4" />
          <Trans>
            Set up a language model in Settings to start chatting. It runs on
            this device.
          </Trans>
        </p>
      )}
    </div>
  );
}

function compactAgo(createdAt: string | undefined): string {
  if (!createdAt) return "";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - date.getTime()) / 60000),
  );
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return format(date, "MMM d");
}

function Recents({ onSelect }: { onSelect: (chatGroupId: string) => void }) {
  const ids = main.UI.useSortedRowIds(
    "chat_groups",
    "created_at",
    true,
    0,
    4,
    main.STORE_ID,
  );

  if (ids.length === 0) return null;

  return (
    <section data-chat-part="recents" className="flex flex-none flex-col pt-10">
      <h2 className="text-muted-foreground px-1 pb-2 text-sm">
        <Trans>Recents</Trans>
      </h2>
      {ids.map((id) => (
        <RecentRow key={id} groupId={id} onSelect={onSelect} />
      ))}
    </section>
  );
}

function RecentRow({
  groupId,
  onSelect,
}: {
  groupId: string;
  onSelect: (chatGroupId: string) => void;
}) {
  const group = main.UI.useRow("chat_groups", groupId, main.STORE_ID);
  if (!group) return null;

  return (
    <button
      type="button"
      onClick={() => onSelect(groupId)}
      className="hover:bg-accent flex items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors"
    >
      <span className="bg-secondary text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
        <MessageCircleIcon className="size-4" />
      </span>
      <span className="text-foreground min-w-0 flex-1 truncate text-[15px]">
        {String(group.title || "") || <Trans>Untitled chat</Trans>}
      </span>
      <span className="text-muted-foreground shrink-0 pr-2 text-xs">
        {compactAgo(group.created_at as string | undefined)}
      </span>
    </button>
  );
}
