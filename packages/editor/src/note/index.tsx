import "prosemirror-view/style/prosemirror.css";
import "prosemirror-gapcursor/style/gapcursor.css";
import "../styles/prosemirror.css";

import {
  ProseMirror,
  ProseMirrorDoc,
  reactKeys,
  useEditorEffect,
} from "@handlewithcare/react-prosemirror";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { history } from "prosemirror-history";
import { Node as PMNode } from "prosemirror-model";
import {
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  type ComponentProps,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@notiz/utils";

import { EditorErrorBoundary } from "../editor-error-boundary";
import {
  FileAttachmentView,
  getNodeViewFallbackTag,
  MentionNodeView,
  ResizableImageView,
  TaskItemView,
  withNodeViewErrorBoundary,
} from "../node-views";
import {
  appLinkPastePlugin,
  autolinkPlugin,
  type FileHandlerConfig,
  type PlaceholderFunction,
  SearchQuery,
  clearMarksOnEnterPlugin,
  clipboardPlugin,
  clipPastePlugin,
  ensureImageTrailingParagraphs,
  fileHandlerPlugin,
  getSearchState,
  hashtagPlugin,
  imageTrailingParagraphPlugin,
  type LinkOpenHandler,
  linkBoundaryGuardPlugin,
  linkOpenPlugin,
  placeholderPlugin,
  searchPlugin,
  searchReplaceAll,
  searchReplaceCurrent,
  setSearchState,
  taskIdentityPlugin,
  codeHighlightPlugin,
} from "../plugins";
import { TaskSourceProvider } from "../task-source";
import { useTaskStorageOptional } from "../task-storage";
import {
  extractTasksFromContent,
  hydrateTaskContent,
  normalizeTaskContent,
  type TaskSource,
} from "../tasks";
import { dispatchEditorTransaction } from "../transaction-guard";
import {
  FormatToolbar,
  type MentionConfig,
  MentionSuggestion,
  SlashCommandMenu,
  mentionSkipPlugin,
} from "../widgets";
import { buildInputRules, buildKeymap } from "./keymap";
import {
  LinkedItemOpenBehaviorContext,
  type LinkedItemOpenBehavior,
  useLinkedItemOpenBehavior,
} from "./linked-item-open-behavior";
import { schema } from "./schema";
import { normalizeTitleHeadingDoc, titleHeadingPlugin } from "./title-layout";
import { trailingEmptyLineClickPlugin } from "./trailing-empty-line-click";

export type { MentionConfig, FileHandlerConfig, PlaceholderFunction };
export { schema };
export { useLinkedItemOpenBehavior };

// Registry of every mounted editor's pending (debounced) update flush, so
// the app shell can force all in-flight edits into the store before quitting
// — the 500ms debounce below has no way to know the process is about to die.
const pendingFlushers = new Set<() => void>();

export function flushAllPendingNoteUpdates() {
  pendingFlushers.forEach((flush) => flush());
}

export interface JSONContent {
  type?: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: { type: string; attrs?: Record<string, any> }[];
  text?: string;
}

// JSON.stringify is key-insertion-order sensitive, so two objects that
// are semantically identical but built via different code paths (e.g.
// hand-authored editor content vs. objects reconstructed by
// cloneContentArray/createTaskItemNode during task hydration) can
// serialize to different strings. Sorting keys recursively before
// stringifying makes the comparison care about content, not
// construction order.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface SearchReplaceParams {
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  all: boolean;
  matchIndex: number;
}

export interface EditorCommands {
  focus: () => void;
  focusAtStart: () => void;
  focusAtPixelWidth: (pixelWidth: number) => void;
  insertAtStartAndFocus: (content: string) => void;
  replaceContent: (content: JSONContent) => void;
  setSearch: (query: string, caseSensitive: boolean) => void;
  replace: (params: SearchReplaceParams) => void;
}

export interface NoteEditorRef {
  view: EditorView | null;
  commands: EditorCommands;
}

export type SessionMentionDropData = {
  id: string;
  label: string;
};

export type SessionMentionDropConfig = {
  has?: (
    dataTransfer: Pick<DataTransfer, "types"> | null | undefined,
  ) => boolean;
  read: (
    dataTransfer: Pick<DataTransfer, "getData" | "types"> | null | undefined,
  ) => SessionMentionDropData | null;
};

type NodeViewComponents = NonNullable<
  ComponentProps<typeof ProseMirror>["nodeViewComponents"]
>;

export interface NoteEditorProps {
  className?: string;
  handleChange?: (content: JSONContent) => void;
  initialContent?: JSONContent;
  mentionConfig?: MentionConfig;
  placeholderComponent?: PlaceholderFunction;
  fileHandlerConfig?: FileHandlerConfig;
  onNavigateToTitle?: (pixelWidth?: number) => void;
  onLinkOpen?: LinkOpenHandler;
  linkedItemOpenBehavior?: LinkedItemOpenBehavior;
  taskSource?: TaskSource;
  extraNodeViews?: NodeViewComponents;
  sessionMentionDropConfig?: SessionMentionDropConfig;
  showFormatToolbar?: boolean;
  onViewReady?: (view: EditorView) => void;
  onViewDisposed?: (view: EditorView) => void;
  syncContentWhenFocused?: boolean;
  enforceTitleHeading?: boolean;
}

const baseNodeViews = {
  fileAttachment: withNodeViewErrorBoundary<HTMLDivElement>(
    FileAttachmentView,
    { name: "fileAttachment" },
  ),
  image: withNodeViewErrorBoundary<HTMLDivElement>(ResizableImageView, {
    name: "image",
  }),
  "mention-@": withNodeViewErrorBoundary<HTMLElement>(MentionNodeView, {
    name: "mention-@",
  }),
  taskItem: withNodeViewErrorBoundary<HTMLLIElement>(TaskItemView, {
    name: "taskItem",
  }),
};

function wrapNodeViewComponents(nodeViews?: NodeViewComponents) {
  if (!nodeViews) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(nodeViews).map(([name, Component]) => [
      name,
      withNodeViewErrorBoundary(Component, {
        fallbackTag: getNodeViewFallbackTag(name),
        name,
      }),
    ]),
  ) as NodeViewComponents;
}

function createSessionMentionDropPlugin(config: SessionMentionDropConfig) {
  const hasSession = (dataTransfer: DataTransfer | null) =>
    config.has ? config.has(dataTransfer) : Boolean(config.read(dataTransfer));
  const readSession = (dataTransfer: DataTransfer | null) =>
    config.read(dataTransfer);

  return new Plugin({
    key: new PluginKey("sessionMentionDrop"),
    props: {
      handleDOMEvents: {
        dragover(_view, event) {
          const dataTransfer = (event as DragEvent).dataTransfer;
          if (!hasSession(dataTransfer)) {
            return false;
          }

          event.preventDefault();
          if (dataTransfer) {
            dataTransfer.dropEffect = "copy";
          }
          return true;
        },
      },
      handleDrop(view, event) {
        const session = readSession(event.dataTransfer);
        const mentionType = view.state.schema.nodes["mention-@"];
        if (!session || !mentionType) {
          return false;
        }

        event.preventDefault();
        event.stopPropagation();

        const mentionNode = mentionType.create({
          id: session.id,
          type: "session",
          label: session.label,
        });
        const space = view.state.schema.text(" ");
        const pos =
          view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })?.pos ?? view.state.selection.from;

        try {
          const tr = view.state.tr.insert(pos, [mentionNode, space]);
          tr.setSelection(
            TextSelection.create(
              tr.doc,
              pos + mentionNode.nodeSize + space.nodeSize,
            ),
          );
          view.dispatch(tr.scrollIntoView());
        } catch {
          const tr = view.state.tr
            .replaceSelectionWith(mentionNode)
            .insertText(" ");
          view.dispatch(tr.scrollIntoView());
        }

        view.focus();
        return true;
      },
    },
  });
}

function ViewCapture({
  viewRef,
  onViewReady,
  onViewDisposed,
}: {
  viewRef: React.RefObject<EditorView | null>;
  onViewReady: (view: EditorView) => void;
  onViewDisposed?: (view: EditorView) => void;
}) {
  const callbacksRef = useRef({ onViewReady, onViewDisposed });
  callbacksRef.current = { onViewReady, onViewDisposed };

  useEditorEffect(
    (view) => {
      if (view && viewRef.current !== view) {
        viewRef.current = view;
        callbacksRef.current.onViewReady(view);
      }

      return () => {
        if (viewRef.current === view) {
          viewRef.current = null;
          callbacksRef.current.onViewDisposed?.(view);
        }
      };
    },
    [viewRef],
  );
  return null;
}

const noopCommands: EditorCommands = {
  focus: () => {},
  focusAtStart: () => {},
  focusAtPixelWidth: () => {},
  insertAtStartAndFocus: () => {},
  replaceContent: () => {},
  setSearch: () => {},
  replace: () => {},
};

function EditorCommandsBridge({
  commandsRef,
}: {
  commandsRef: React.RefObject<EditorCommands>;
}) {
  useEditorEffect(
    (view) => {
      if (!view) {
        commandsRef.current = noopCommands;
        return;
      }

      commandsRef.current = {
        focus: () => {
          view.focus();
        },
        focusAtStart: () => {
          view.dispatch(
            view.state.tr.setSelection(Selection.atStart(view.state.doc)),
          );
          view.focus();
        },
        focusAtPixelWidth: (pixelWidth: number) => {
          const blockStart = Selection.atStart(view.state.doc).from;
          const firstTextNode = view.dom.querySelector(".ProseMirror > *");
          if (firstTextNode) {
            const editorStyle = window.getComputedStyle(firstTextNode);
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.font = `${editorStyle.fontWeight} ${editorStyle.fontSize} ${editorStyle.fontFamily}`;
              const firstBlock = view.state.doc.firstChild;
              if (firstBlock && firstBlock.textContent) {
                const text = firstBlock.textContent;
                let charPos = 0;
                for (let i = 0; i <= text.length; i++) {
                  const currentWidth = ctx.measureText(text.slice(0, i)).width;
                  if (currentWidth >= pixelWidth) {
                    charPos = i;
                    break;
                  }
                  charPos = i;
                }
                const targetPos = Math.min(
                  blockStart + charPos,
                  view.state.doc.content.size - 1,
                );
                view.dispatch(
                  view.state.tr.setSelection(
                    TextSelection.create(view.state.doc, targetPos),
                  ),
                );
                view.focus();
                return;
              }
            }
          }

          view.dispatch(
            view.state.tr.setSelection(Selection.atStart(view.state.doc)),
          );
          view.focus();
        },
        insertAtStartAndFocus: (content: string) => {
          if (!content) return;
          const pos = Selection.atStart(view.state.doc).from;
          const tr = view.state.tr.insertText(content, pos);
          tr.setSelection(TextSelection.create(tr.doc, pos));
          view.dispatch(tr);
          view.focus();
        },
        replaceContent: (content: JSONContent) => {
          if (content.type !== "doc") return;

          try {
            const nextDoc = PMNode.fromJSON(schema, content);
            if (nextDoc.eq(view.state.doc)) {
              return;
            }

            view.dispatch(
              view.state.tr.replaceWith(
                0,
                view.state.doc.content.size,
                nextDoc.content,
              ),
            );
          } catch {
            // invalid content
          }
        },
        setSearch: (query: string, caseSensitive: boolean) => {
          const q = new SearchQuery({ search: query, caseSensitive });
          const current = getSearchState(view.state);
          if (current && current.query.eq(q)) return;
          view.dispatch(setSearchState(view.state.tr, q));
        },
        replace: (params: SearchReplaceParams) => {
          const query = new SearchQuery({
            search: params.query,
            replace: params.replacement,
            caseSensitive: params.caseSensitive,
            wholeWord: params.wholeWord,
          });

          view.dispatch(setSearchState(view.state.tr, query));

          if (params.all) {
            searchReplaceAll(view.state, (tr) => view.dispatch(tr));
          } else {
            let result = query.findNext(view.state);
            let idx = 0;
            while (result && idx < params.matchIndex) {
              result = query.findNext(view.state, result.to);
              idx++;
            }
            if (!result) return;
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(view.state.doc, result.from, result.to),
              ),
            );
            searchReplaceCurrent(view.state, (tr) => view.dispatch(tr));
          }
        },
      };

      return () => {
        commandsRef.current = noopCommands;
      };
    },
    [commandsRef],
  );

  return null;
}

export const NoteEditor = forwardRef<NoteEditorRef, NoteEditorProps>(
  function NoteEditor(props, ref) {
    const {
      handleChange,
      className,
      initialContent,
      mentionConfig,
      placeholderComponent,
      fileHandlerConfig,
      onNavigateToTitle,
      onLinkOpen,
      linkedItemOpenBehavior = "current",
      taskSource,
      extraNodeViews,
      sessionMentionDropConfig,
      showFormatToolbar = true,
      onViewReady: onViewReadyProp,
      onViewDisposed,
      syncContentWhenFocused = false,
      enforceTitleHeading = true,
    } = props;

    const taskStorage = useTaskStorageOptional();
    const normalizedInitialContent = useMemo(
      () => normalizeTaskContent(initialContent),
      [initialContent],
    );
    const reconciledInitialContent = useMemo(() => {
      if (!normalizedInitialContent) {
        return normalizedInitialContent;
      }

      const hydrated =
        taskSource && taskStorage
          ? (() => {
              try {
                const sourceTasks = taskStorage.getTasksForSource(taskSource);
                if (sourceTasks.length === 0) return normalizedInitialContent;
                return hydrateTaskContent({
                  content: normalizedInitialContent,
                  sourceTasks,
                  getTask: taskStorage.getTask,
                });
              } catch (error) {
                console.error("Task hydration failed", error);
                return normalizedInitialContent;
              }
            })()
          : normalizedInitialContent;

      try {
        return ensureImageTrailingParagraphs(hydrated);
      } catch (error) {
        console.error("Image paragraph reconciliation failed", error);
        return hydrated;
      }
    }, [normalizedInitialContent, taskSource, taskStorage]);
    const viewRef = useRef<EditorView | null>(null);
    const commandsRef = useRef<EditorCommands>(noopCommands);

    useImperativeHandle(
      ref,
      () => ({
        get view() {
          return viewRef.current;
        },
        get commands() {
          return commandsRef.current;
        },
      }),
      [],
    );

    const syncTasks = useCallback(
      (content: JSONContent) => {
        if (!taskSource || !taskStorage) {
          return;
        }

        try {
          const previousTasks = new Map(
            taskStorage
              .getTasksForSource(taskSource)
              .map((task) => [task.taskId, task]),
          );
          taskStorage.upsertTasksForSource(
            taskSource,
            extractTasksFromContent(content, taskSource, previousTasks),
          );
        } catch (error) {
          console.error("Task sync failed", error);
        }
      },
      [taskSource, taskStorage],
    );

    const pendingFlushRef = useRef<(() => void) | null>(null);
    const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flushPendingUpdate = useCallback(() => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }
      const flush = pendingFlushRef.current;
      if (!flush) {
        return;
      }
      pendingFlushRef.current = null;
      flush();
    }, []);

    // Bind syncTasks/handleChange by value at the moment each edit happens,
    // not via a ref that tracks whatever the latest render's props are. If
    // this component doesn't remount between sessions (props update instead
    // of a fresh mount), a ref would flush a pending edit through the *new*
    // session's handleChange, writing stale content into the wrong note.
    const onUpdate = useCallback(
      (content: JSONContent) => {
        pendingFlushRef.current = () => {
          syncTasks(content);
          handleChange?.(content);
        };
        if (updateTimerRef.current) {
          clearTimeout(updateTimerRef.current);
        }
        updateTimerRef.current = setTimeout(flushPendingUpdate, 500);
      },
      [flushPendingUpdate, syncTasks, handleChange],
    );

    // usehooks-ts's useDebounceCallback cancels a *different* debounce
    // instance than the one it returns, so its unmount cleanup never
    // actually stops a pending call. Flushing here on unmount (and
    // whenever the bound callbacks change, i.e. the session changed)
    // guarantees an in-flight edit lands on the session it was typed
    // into instead of leaking into whichever session mounts/renders next.
    useEffect(() => {
      pendingFlushers.add(flushPendingUpdate);
      return () => {
        pendingFlushers.delete(flushPendingUpdate);
        flushPendingUpdate();
      };
    }, [flushPendingUpdate, onUpdate]);

    const plugins = useMemo(
      () => [
        reactKeys(),
        buildInputRules(),
        ...(enforceTitleHeading ? [titleHeadingPlugin()] : []),
        taskIdentityPlugin(),
        buildKeymap(onNavigateToTitle),
        trailingEmptyLineClickPlugin(),
        history(),
        dropCursor(),
        gapCursor(),
        clipboardPlugin(),
        hashtagPlugin(),
        codeHighlightPlugin(),
        imageTrailingParagraphPlugin(),
        searchPlugin(),
        placeholderPlugin(placeholderComponent),
        clearMarksOnEnterPlugin(),
        clipPastePlugin(),
        appLinkPastePlugin(),
        autolinkPlugin(),
        linkBoundaryGuardPlugin(),
        ...(onLinkOpen ? [linkOpenPlugin(onLinkOpen)] : []),
        ...(mentionConfig ? [mentionSkipPlugin()] : []),
        ...(sessionMentionDropConfig
          ? [createSessionMentionDropPlugin(sessionMentionDropConfig)]
          : []),
        ...(fileHandlerConfig ? [fileHandlerPlugin(fileHandlerConfig)] : []),
      ],
      [
        placeholderComponent,
        fileHandlerConfig,
        mentionConfig,
        sessionMentionDropConfig,
        onNavigateToTitle,
        onLinkOpen,
        enforceTitleHeading,
      ],
    );
    const nodeViews = useMemo(
      () => ({ ...baseNodeViews, ...wrapNodeViewComponents(extraNodeViews) }),
      [extraNodeViews],
    );

    // react-prosemirror's EditorView is a special subclass that only
    // commits state updates driven through its own event/effect cycle
    // (dispatchTransaction, or its useEditorEffect hook). Calling
    // view.updateState() imperatively from a plain effect -- which is
    // what this code used to do -- updates ProseMirror's internal state
    // but never flushes to the DOM, since it bypasses that commit cycle.
    // The reliable way to force new content in is a genuine React
    // remount: renderGeneration is bumped whenever we accept new
    // content, and used as the ProseMirror subtree's key below.
    const [renderedContent, setRenderedContent] = useState(
      reconciledInitialContent,
    );
    const [renderGeneration, setRenderGeneration] = useState(0);
    const resyncAttemptsRef = useRef<{ count: number; windowStart: number }>({
      count: 0,
      windowStart: 0,
    });

    // Circuit breaker: whatever upstream source of "new but semantically
    // equal" content we haven't found yet, this guarantees the resync
    // mechanism below can never crash the editor via React's "Maximum
    // update depth exceeded" guard again. If content genuinely keeps
    // differing many times in a short window, something upstream is
    // unstable -- stop remounting and let the note render as-is rather
    // than looping forever.
    const RESYNC_BUDGET = 8;
    const RESYNC_WINDOW_MS = 3000;
    const acceptResync = () => {
      const now = Date.now();
      const state = resyncAttemptsRef.current;
      if (now - state.windowStart > RESYNC_WINDOW_MS) {
        state.windowStart = now;
        state.count = 0;
      }
      state.count += 1;
      if (state.count > RESYNC_BUDGET) {
        console.error(
          "[NoteEditor] content kept changing on every resync attempt; " +
            "giving up to avoid an update-depth crash. This means some " +
            "upstream data source is regenerating non-idempotent content.",
        );
        return false;
      }
      return true;
    };

    useEffect(() => {
      if (
        !reconciledInitialContent ||
        reconciledInitialContent.type !== "doc"
      ) {
        return;
      }
      // Compare by content, not reference: reconciledInitialContent is
      // rebuilt fresh on renders triggered by unrelated causes (e.g. a
      // background writer like live transcription touching the store
      // while this note isn't focused). A reference check never
      // settles against those semantically-identical-but-new objects,
      // so this effect re-fires and remounts the editor every single
      // time, cascading into React's "Maximum update depth exceeded"
      // loop guard instead of converging.
      if (
        stableStringify(renderedContent) ===
        stableStringify(reconciledInitialContent)
      ) {
        return;
      }

      const view = viewRef.current;
      const focused = view?.hasFocus() ?? false;
      if (focused && !syncContentWhenFocused) {
        if (!view) return;
        // Content differs but the view is currently focused (e.g. the
        // session changed while the user was still typing into the old
        // one). Retry as soon as focus leaves the view.
        const handleBlur = () => {
          // The view may already have been torn down (e.g. this whole
          // NoteEditor is being unmounted because the session changed)
          // by the time a stale blur fires. Bumping renderGeneration on
          // a disposed view forces a remount racing against that
          // teardown, cascading into React's "Maximum update depth
          // exceeded" loop guard instead of a clean unmount.
          if (viewRef.current !== view) return;
          if (!acceptResync()) return;
          setRenderedContent(reconciledInitialContent);
          setRenderGeneration((n) => n + 1);
        };
        view.dom.addEventListener("blur", handleBlur);
        return () => {
          view.dom.removeEventListener("blur", handleBlur);
        };
      }

      if (!acceptResync()) return;
      setRenderedContent(reconciledInitialContent);
      setRenderGeneration((n) => n + 1);
    }, [reconciledInitialContent, syncContentWhenFocused]);

    const defaultState = useMemo(() => {
      let doc: PMNode;
      try {
        doc =
          renderedContent && renderedContent.type === "doc"
            ? PMNode.fromJSON(schema, renderedContent)
            : schema.node("doc", null, [schema.node("paragraph")]);
        if (enforceTitleHeading) {
          doc = normalizeTitleHeadingDoc(doc);
        }
      } catch {
        doc = schema.node("doc", null, [
          enforceTitleHeading
            ? schema.node("heading", { level: 1 })
            : schema.node("paragraph"),
        ]);
      }
      return EditorState.create({ doc, plugins });
    }, [renderedContent, plugins, enforceTitleHeading]);

    const onViewReady = useCallback(
      (view: EditorView) => {
        onViewReadyProp?.(view);
        syncTasks(view.state.doc.toJSON() as JSONContent);
      },
      [onViewReadyProp, syncTasks],
    );

    return (
      <TaskSourceProvider source={taskSource ?? null}>
        <LinkedItemOpenBehaviorContext.Provider value={linkedItemOpenBehavior}>
          <EditorErrorBoundary
            resetKey={
              taskSource ? `${taskSource.type}:${taskSource.id}` : "note"
            }
          >
            <ProseMirror
              key={renderGeneration}
              defaultState={defaultState}
              nodeViewComponents={nodeViews}
              dispatchTransaction={function (
                this: EditorView,
                tr: Transaction,
              ) {
                dispatchEditorTransaction({
                  view: this,
                  transaction: tr,
                  onDocChanged: () =>
                    onUpdate(this.state.doc.toJSON() as JSONContent),
                });
              }}
              attributes={{
                spellCheck: "false",
                autoComplete: "off",
                autoCorrect: "off",
                autoCapitalize: "off",
                role: "textbox",
                class: cn([
                  "prosemirror-editor",
                  enforceTitleHeading && "note-title-editor",
                  className,
                ]),
              }}
            >
              <ProseMirrorDoc />
              <ViewCapture
                viewRef={viewRef}
                onViewReady={onViewReady}
                onViewDisposed={onViewDisposed}
              />
              <EditorCommandsBridge commandsRef={commandsRef} />
              {showFormatToolbar && <FormatToolbar />}
              <SlashCommandMenu />
              {mentionConfig && <MentionSuggestion config={mentionConfig} />}
            </ProseMirror>
          </EditorErrorBoundary>
        </LinkedItemOpenBehaviorContext.Provider>
      </TaskSourceProvider>
    );
  },
);
