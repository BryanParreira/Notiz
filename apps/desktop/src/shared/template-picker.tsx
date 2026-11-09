import { Trans } from "@lingui/react/macro";
import {
  BookOpenIcon,
  BriefcaseIcon,
  CalendarCheckIcon,
  CheckSquareIcon,
  ChefHatIcon,
  FileTextIcon,
  FlameIcon,
  GraduationCapIcon,
  HandshakeIcon,
  LightbulbIcon,
  MicIcon,
  NotebookPenIcon,
  PlaneIcon,
  PlusIcon,
  RocketIcon,
  RotateCcwIcon,
  ScaleIcon,
  SearchIcon,
  StickyNoteIcon,
  SunIcon,
  TargetIcon,
  Trash2Icon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@notiz/utils";

import {
  BUILT_IN_TEMPLATES,
  createNoteFromTemplate,
  deleteCustomTemplate,
  insertTemplateIntoNote,
  type NoteTemplate,
  resolveTemplateBody,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
  useCustomTemplates,
} from "./note-templates";

import * as main from "~/store/tinybase/store/main";
import { createSession } from "~/store/tinybase/store/sessions";
import { useTabs } from "~/store/zustand/tabs";

export const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  meeting: UsersIcon,
  "one-on-one": HandshakeIcon,
  standup: SunIcon,
  "client-call": BriefcaseIcon,
  interview: MicIcon,
  project: RocketIcon,
  spec: FileTextIcon,
  decision: ScaleIcon,
  retro: RotateCcwIcon,
  brainstorm: LightbulbIcon,
  "weekly-plan": CalendarCheckIcon,
  "weekly-review": CalendarCheckIcon,
  goals: TargetIcon,
  trip: PlaneIcon,
  journal: NotebookPenIcon,
  morning: SunIcon,
  habits: FlameIcon,
  checklist: CheckSquareIcon,
  recipe: ChefHatIcon,
  book: BookOpenIcon,
  lecture: GraduationCapIcon,
};

export function templateIcon(template: NoteTemplate): LucideIcon {
  return (
    TEMPLATE_ICONS[template.id] ??
    (template.custom ? StickyNoteIcon : FileTextIcon)
  );
}

type PickerState = { open: boolean; sessionId: string | null };

let state: PickerState = { open: false, sessionId: null };
const listeners = new Set<() => void>();

function setState(next: PickerState) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Choose a template for a new note, or start a blank one. */
export function openTemplatePicker() {
  setState({ open: true, sessionId: null });
}

/** Choose a template to add into an existing note. */
export function openTemplatePickerForNote(sessionId: string) {
  setState({ open: true, sessionId });
}

function close() {
  setState({ open: false, sessionId: null });
}

function usePickerState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

// The few markdown shapes the templates use, drawn like the editor draws them.
function renderInline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

function TemplatePreview({ body }: { body: string }) {
  const blocks = useMemo(() => {
    const result: ReactNode[] = [];
    body.split("\n").forEach((raw, index) => {
      const line = raw.trimEnd();
      if (!line.trim()) return;
      if (/^---+$/.test(line.trim())) {
        result.push(<hr key={index} className="my-3 border-neutral-300" />);
      } else if (line.startsWith("## ")) {
        result.push(
          <h3
            key={index}
            className="mt-4 mb-1 text-[13px] font-semibold text-neutral-900"
          >
            {line.slice(3)}
          </h3>,
        );
      } else if (line.startsWith("# ")) {
        result.push(
          <h2 key={index} className="mt-3 mb-1 text-base font-semibold">
            {line.slice(2)}
          </h2>,
        );
      } else if (line.startsWith("> ")) {
        result.push(
          <div
            key={index}
            className="my-2 border-l-2 border-neutral-400 pl-3 text-neutral-600"
          >
            {renderInline(line.slice(2))}
          </div>,
        );
      } else if (/^- \[ \]/.test(line)) {
        result.push(
          <div key={index} className="flex items-center gap-2 py-0.5">
            <span className="size-3 shrink-0 rounded-[3px] border border-neutral-400" />
            <span>{renderInline(line.replace(/^- \[ \]\s*/, ""))}</span>
          </div>,
        );
      } else if (/^- /.test(line)) {
        result.push(
          <div key={index} className="flex gap-2 py-0.5">
            <span className="text-neutral-400">•</span>
            <span>{renderInline(line.slice(2))}</span>
          </div>,
        );
      } else if (/^\d+\.\s/.test(line)) {
        result.push(
          <div key={index} className="flex gap-2 py-0.5">
            <span className="text-neutral-400">{line.match(/^\d+/)?.[0]}.</span>
            <span>{renderInline(line.replace(/^\d+\.\s*/, ""))}</span>
          </div>,
        );
      } else {
        result.push(
          <p key={index} className="py-0.5 text-neutral-600">
            {renderInline(line)}
          </p>,
        );
      }
    });
    return result;
  }, [body]);

  return (
    <div className="text-[12px] leading-relaxed text-neutral-800">{blocks}</div>
  );
}

type Entry = { kind: "blank" } | { kind: "template"; template: NoteTemplate };

export function TemplatePickerDialog() {
  const { open, sessionId } = usePickerState();
  if (!open) return null;
  return <PickerContent key={sessionId ?? "new"} sessionId={sessionId} />;
}

function PickerContent({ sessionId }: { sessionId: string | null }) {
  const store = main.UI.useStore(main.STORE_ID);
  const openNew = useTabs((tabs) => tabs.openNew);
  const openCurrent = useTabs((tabs) => tabs.openCurrent);
  const custom = useCustomTemplates();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TemplateCategory | "All">("All");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => [...custom, ...BUILT_IN_TEMPLATES], [custom]);

  const categories = useMemo(
    () =>
      TEMPLATE_CATEGORIES.map((name) => ({
        name,
        count: all.filter((template) => template.category === name).length,
      })).filter((item) => item.count > 0),
    [all],
  );

  const entries = useMemo<Entry[]>(() => {
    const needle = query.trim().toLowerCase();
    const list: Entry[] = all
      .filter(
        (template) =>
          (category === "All" || template.category === category) &&
          (!needle ||
            template.title.toLowerCase().includes(needle) ||
            template.description.toLowerCase().includes(needle)),
      )
      .map((template) => ({ kind: "template", template }));
    return sessionId === null && !needle && category === "All"
      ? [{ kind: "blank" }, ...list]
      : list;
  }, [all, query, category, sessionId]);

  useEffect(() => {
    setIndex(0);
  }, [query, category]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const selected = entries[Math.min(index, entries.length - 1)];

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    if (sessionId !== null) {
      if (entry.kind === "template") {
        insertTemplateIntoNote(sessionId, entry.template);
      }
      close();
      return;
    }
    if (!store) return;
    const id =
      entry.kind === "blank"
        ? createSession(store as main.Store)
        : createNoteFromTemplate(store as main.Store, entry.template);
    const onHome = useTabs.getState().currentTab?.type === "empty";
    (onHome ? openCurrent : openNew)({ type: "sessions", id });
    close();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((value) => Math.min(value + 1, entries.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((value) => Math.max(value - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        choose(selected);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  });

  const insertMode = sessionId !== null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-xs"
      onClick={close}
    >
      <div
        role="dialog"
        aria-label={insertMode ? "Insert template" : "New note"}
        onClick={(event) => event.stopPropagation()}
        className="border-border bg-background flex h-[34rem] max-h-full w-full max-w-4xl overflow-hidden rounded-2xl border shadow-2xl"
      >
        <aside className="border-border bg-secondary/40 flex w-52 shrink-0 flex-col gap-4 border-r p-4">
          <h2 className="font-display text-foreground text-xl leading-none">
            {insertMode ? (
              <Trans>Insert template</Trans>
            ) : (
              <Trans>New note</Trans>
            )}
          </h2>
          <label className="border-border bg-background flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
            <SearchIcon size={14} className="text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search templates"
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <nav className="flex flex-col gap-0.5">
            {[{ name: "All" as const, count: all.length }, ...categories].map(
              (item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setCategory(item.name)}
                  className={cn([
                    "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                    category === item.name
                      ? "bg-background text-foreground font-medium shadow-xs"
                      : "text-muted-foreground hover:bg-background/60",
                  ])}
                >
                  {item.name}
                  <span className="text-muted-foreground/70 text-xs tabular-nums">
                    {item.count}
                  </span>
                </button>
              ),
            )}
          </nav>
          <p className="text-muted-foreground mt-auto text-xs leading-relaxed">
            <Trans>
              Up and down to browse, Enter to choose. Save any note as a
              template from its menu.
            </Trans>
          </p>
        </aside>

        <div
          ref={listRef}
          className="scrollbar-hide border-border flex w-72 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2"
        >
          {entries.length === 0 && (
            <p className="text-muted-foreground px-3 py-6 text-sm">
              <Trans>No templates match.</Trans>
            </p>
          )}
          {entries.map((entry, position) => {
            const Icon =
              entry.kind === "blank" ? PlusIcon : templateIcon(entry.template);
            return (
              <button
                key={entry.kind === "blank" ? "blank" : entry.template.id}
                type="button"
                data-index={position}
                onMouseEnter={() => setIndex(position)}
                onClick={() => choose(entry)}
                className={cn([
                  "flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                  position === index ? "bg-accent" : "hover:bg-accent/50",
                ])}
              >
                <span
                  className="bg-secondary flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral-700"
                  style={
                    entry.kind === "template"
                      ? { backgroundColor: entry.template.accent }
                      : undefined
                  }
                >
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-foreground truncate text-sm font-medium">
                    {entry.kind === "blank" ? (
                      <Trans>Blank note</Trans>
                    ) : (
                      entry.template.title
                    )}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {entry.kind === "blank" ? (
                      <Trans>Start with an empty page</Trans>
                    ) : (
                      entry.template.description
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <section className="flex min-w-0 flex-1 flex-col">
          <div
            className="bg-secondary flex-1 overflow-y-auto p-5"
            style={
              selected?.kind === "template"
                ? { backgroundColor: selected.template.accent }
                : undefined
            }
          >
            <div className="mx-auto min-h-full max-w-sm rounded-lg bg-white px-6 py-5 shadow-sm">
              {selected?.kind === "template" ? (
                <>
                  <h3 className="mb-2 text-base font-semibold text-neutral-900">
                    {selected.template.title}
                  </h3>
                  <TemplatePreview
                    body={resolveTemplateBody(selected.template)}
                  />
                </>
              ) : (
                <p className="py-10 text-center text-xs text-neutral-400">
                  <Trans>An empty page, ready for anything.</Trans>
                </p>
              )}
            </div>
          </div>
          <footer className="border-border flex items-center justify-between gap-3 border-t px-5 py-3">
            {selected?.kind === "template" && selected.template.custom ? (
              <button
                type="button"
                onClick={() => deleteCustomTemplate(selected.template.id)}
                className="text-muted-foreground hover:text-destructive flex items-center gap-1.5 text-xs transition-colors"
              >
                <Trash2Icon size={13} />
                <Trans>Delete</Trans>
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={close}
                className="text-muted-foreground hover:bg-accent rounded-full px-4 py-2 text-sm transition-colors"
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={() => choose(selected)}
                className="bg-primary text-primary-foreground rounded-full px-5 py-2 text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {insertMode ? (
                  <Trans>Insert</Trans>
                ) : selected?.kind === "blank" ? (
                  <Trans>Start writing</Trans>
                ) : (
                  <Trans>Use template</Trans>
                )}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}
