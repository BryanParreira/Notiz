import type { EditorView } from "prosemirror-view";
import {
  forwardRef,
  type UIEventHandler,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { md2json } from "@notiz/editor/markdown";
import type { JSONContent, NoteEditorRef } from "@notiz/editor/note";

import { Backlinks } from "./backlinks";
import { NoteMetaRow } from "./meta-row";
import { RawEditor } from "./raw";
import { SearchBar } from "./search/bar";
import { useSearch } from "./search/context";
import { TemplateStrip } from "./template-strip";

import { useCaretNearBottom } from "~/session/components/caret-position-context";
import { useScrollPreservation } from "~/shared/hooks/useScrollPreservation";
import { onTemplateInsert } from "~/shared/note-templates";
import type { Tab } from "~/store/zustand/tabs";

export interface NoteInputHandle {
  focus: () => void;
  focusAtStart: () => void;
  focusAtPixelWidth: (pixelWidth: number) => void;
  insertAtStartAndFocus: (content: string) => void;
  prepareForTabChange: () => void;
}

export const NoteInput = forwardRef<
  NoteInputHandle,
  {
    tab: Extract<Tab, { type: "sessions" }>;
    onNavigateToTitle?: (pixelWidth?: number) => void;
    onScroll?: UIEventHandler<HTMLDivElement>;
  }
>(({ tab, onNavigateToTitle, onScroll }, ref) => {
  const editorRef = useRef<NoteEditorRef>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const sessionId = tab.id;

  const { scrollRef, onBeforeTabChange } = useScrollPreservation("raw");

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.commands.focus(),
      focusAtStart: () => editorRef.current?.commands.focusAtStart(),
      focusAtPixelWidth: (px) =>
        editorRef.current?.commands.focusAtPixelWidth(px),
      insertAtStartAndFocus: (content) =>
        editorRef.current?.commands.insertAtStartAndFocus(content),
      prepareForTabChange: onBeforeTabChange,
    }),
    [onBeforeTabChange],
  );

  const handleViewReady = useCallback((editorView: EditorView) => {
    setView(editorView);
  }, []);

  const handleViewDisposed = useCallback((editorView: EditorView) => {
    setView((current) => (current === editorView ? null : current));
  }, []);

  useCaretNearBottom({ view, container, enabled: true });

  useEffect(
    () =>
      onTemplateInsert(({ sessionId: target, template }) => {
        if (target !== sessionId) return;
        const editor = editorRef.current;
        const current = editor?.view?.state.doc.toJSON() as
          | JSONContent
          | undefined;
        if (!editor || !current) return;

        const blocks = [...(current.content ?? [])];
        while (blocks.length > 1 && isEmptyBlock(blocks[blocks.length - 1])) {
          blocks.pop();
        }
        const [first] = blocks;
        const titled =
          first?.type === "heading" && !blockText(first).trim()
            ? [
                {
                  type: "heading",
                  attrs: { level: 1 },
                  content: [{ type: "text", text: template.title }],
                },
                ...blocks.slice(1),
              ]
            : blocks;

        editor.commands.replaceContent({
          type: "doc",
          content: [...titled, ...(md2json(template.body).content ?? [])],
        });
        editor.commands.focus();
      }),
    [sessionId],
  );

  const search = useSearch();
  const showSearchBar = search?.isVisible ?? false;

  useEffect(() => {
    search?.close();
  }, [sessionId]);

  return (
    <div className="-mx-2 flex h-full flex-col">
      <div className="mx-auto w-full max-w-3xl">
        <NoteMetaRow sessionId={sessionId} />
      </div>

      {showSearchBar && (
        <div className="px-3 pt-1">
          <SearchBar editorRef={editorRef} readOnly={false} />
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={(node) => {
            scrollRef.current = node;
            setContainer(node);
          }}
          onClick={() => editorRef.current?.commands.focus()}
          onScroll={onScroll}
          className="scroll-fade-y h-full overflow-auto px-3 pt-2 pb-6"
        >
          <div className="mx-auto w-full max-w-3xl">
            <RawEditor
              ref={editorRef}
              sessionId={sessionId}
              onNavigateToTitle={onNavigateToTitle}
              onViewReady={handleViewReady}
              onViewDisposed={handleViewDisposed}
            />
            <TemplateStrip sessionId={sessionId} />
            <Backlinks sessionId={sessionId} />
          </div>
        </div>
      </div>
    </div>
  );
});

export function blockText(node: JSONContent | undefined): string {
  if (!node) return "";
  if (node.text) return node.text;
  return (node.content ?? []).map(blockText).join("");
}

function isEmptyBlock(node: JSONContent): boolean {
  return node.type === "paragraph" && !blockText(node).trim();
}
