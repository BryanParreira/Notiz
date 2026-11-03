import type { EditorView } from "prosemirror-view";
import { forwardRef, useCallback, useEffect, useMemo, useRef } from "react";

import { parseJsonContent } from "@notiz/editor/markdown";
import {
  NoteEditor,
  type JSONContent,
  type NoteEditorRef,
} from "@notiz/editor/note";
import { cn } from "@notiz/utils";

import { AppLinkView } from "~/editor-bridge/app-link-view";
import { useMentionConfig } from "~/editor-bridge/mention-config";
import { openEditorLink } from "~/editor-bridge/open-editor-link";
import { sessionMentionDropConfig } from "~/editor-bridge/session-mention-drop";
import { SessionNodeView } from "~/editor-bridge/session-view";
import { hasStoredNoteContent } from "~/session/components/shared";
import { emitRawEditorSync } from "~/session/raw-editor-sync";
import {
  ensureFirstLineTitle,
  extractFirstLineTitle,
} from "~/session/title-content";
import * as main from "~/store/tinybase/store/main";

const extraNodeViews = { appLink: AppLinkView, session: SessionNodeView };

const notePlaceholder = ({ node }: { node: { type: { name: string } } }) =>
  node.type.name === "heading" ? "Untitled" : "Write something…";

export const RawEditor = forwardRef<
  NoteEditorRef,
  {
    sessionId: string;
    className?: string;
    onNavigateToTitle?: (pixelWidth?: number) => void;
    syncTasks?: boolean;
    showFormatToolbar?: boolean;
    onViewReady?: (view: EditorView) => void;
    onViewDisposed?: (view: EditorView) => void;
  }
>(
  (
    {
      sessionId,
      className,
      onNavigateToTitle,
      syncTasks = true,
      showFormatToolbar = true,
      onViewReady,
      onViewDisposed,
    },
    ref,
  ) => {
    const rawMd = main.UI.useCell(
      "sessions",
      sessionId,
      "raw_md",
      main.STORE_ID,
    );
    const sessionTitle = main.UI.useCell(
      "sessions",
      sessionId,
      "title",
      main.STORE_ID,
    ) as string | undefined;
    const syncSourceId = useRawEditorSyncSourceId();

    const initialContent = useMemo<JSONContent>(
      () =>
        ensureFirstLineTitle(parseJsonContent(rawMd as string), sessionTitle),
      [rawMd, sessionTitle],
    );

    const persistChange = main.UI.useSetPartialRowCallback(
      "sessions",
      sessionId,
      (input: JSONContent) => {
        const title = extractFirstLineTitle(input);
        return {
          raw_md: JSON.stringify(input),
          ...(title !== null || hasStoredNoteContent(rawMd)
            ? { title: title ?? "" }
            : {}),
        };
      },
      [rawMd],
      main.STORE_ID,
    );

    const hasTrackedWriteRef = useRef(false);

    useEffect(() => {
      hasTrackedWriteRef.current = false;
    }, [sessionId]);

    const hasNonEmptyText = useCallback(
      (node?: JSONContent): boolean =>
        !!node?.text?.trim() ||
        !!node?.content?.some((child: JSONContent) => hasNonEmptyText(child)),
      [],
    );

    const handleChange = useCallback(
      (input: JSONContent) => {
        const nextRawMd = JSON.stringify(input);
        persistChange(input);
        emitRawEditorSync({
          sessionId,
          rawMd: nextRawMd,
          sourceId: syncSourceId,
        });

        if (!hasTrackedWriteRef.current) {
          const hasContent = hasNonEmptyText(input);
          if (hasContent) {
            hasTrackedWriteRef.current = true;
          }
        }
      },
      [persistChange, sessionId, syncSourceId, hasNonEmptyText],
    );

    const mentionConfig = useMentionConfig();

    return (
      <NoteEditor
        ref={ref}
        className={cn(["session-note-editor", className])}
        key={`session-${sessionId}-raw`}
        initialContent={initialContent}
        handleChange={handleChange}
        placeholderComponent={notePlaceholder as never}
        mentionConfig={mentionConfig}
        sessionMentionDropConfig={sessionMentionDropConfig}
        onNavigateToTitle={onNavigateToTitle}
        onLinkOpen={openEditorLink}
        taskSource={
          syncTasks ? { type: "session_raw_note", id: sessionId } : undefined
        }
        extraNodeViews={extraNodeViews}
        showFormatToolbar={showFormatToolbar}
        onViewReady={onViewReady}
        onViewDisposed={onViewDisposed}
      />
    );
  },
);

function useRawEditorSyncSourceId() {
  const sourceIdRef = useRef<string | null>(null);
  if (!sourceIdRef.current) {
    sourceIdRef.current = crypto.randomUUID();
  }

  return sourceIdRef.current;
}
