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

import type { NoteEditorRef } from "@notiz/editor/note";

import { NoteMetaRow } from "./meta-row";
import { RawEditor } from "./raw";
import { SearchBar } from "./search/bar";
import { useSearch } from "./search/context";

import { useCaretNearBottom } from "~/session/components/caret-position-context";
import { useScrollPreservation } from "~/shared/hooks/useScrollPreservation";
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
          </div>
        </div>
      </div>
    </div>
  );
});
