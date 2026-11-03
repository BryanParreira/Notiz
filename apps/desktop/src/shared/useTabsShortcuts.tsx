import { useCallback, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useShallow } from "zustand/shallow";

import { useMountEffect } from "~/shared/hooks/useMountEffect";
import { useNewNote } from "~/shared/useNewNote";
import { uniqueIdfromTab, useTabs } from "~/store/zustand/tabs";

export function useMainTabsShortcuts({ onModT }: { onModT: () => void }) {
  const runEscapeShortcut = useMainEscapeShortcutAction();
  const {
    tabs,
    currentTab,
    close,
    select,
    selectNext,
    selectPrev,
    restoreLastClosedTab,
    openNew,
    unpin,
  } = useTabs(
    useShallow((state) => ({
      tabs: state.tabs,
      currentTab: state.currentTab,
      close: state.close,
      select: state.select,
      selectNext: state.selectNext,
      selectPrev: state.selectPrev,
      restoreLastClosedTab: state.restoreLastClosedTab,
      openNew: state.openNew,
      unpin: state.unpin,
    })),
  );

  const newNote = useNewNote();
  const newNoteCurrent = useNewNote({ behavior: "current" });

  const escapeShortcutRef = useRef(runEscapeShortcut);
  escapeShortcutRef.current = runEscapeShortcut;

  useMountEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      const fromProseMirrorEditor = isFromProseMirrorEditor(event.target);
      const fromSessionTitleInput = isFromSessionTitleInput(event.target);
      const fromSessionSurface = isFromSessionSurface(event.target);
      const hadEditorEscapeConsumer =
        fromProseMirrorEditor &&
        document.querySelector("[data-editor-escape-consumer]") !== null;
      const hadMeaningfulFocus = hasMeaningfulFocus(event.target);

      window.setTimeout(() => {
        if (
          shouldSkipEscapeShortcut(event, {
            fromProseMirrorEditor,
            fromSessionTitleInput,
            fromSessionSurface,
            hadEditorEscapeConsumer,
            hadMeaningfulFocus,
          })
        ) {
          return;
        }

        escapeShortcutRef.current();
      });
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  });

  useHotkeys(
    "mod+n",
    () => {
      if (currentTab?.type === "empty") {
        newNoteCurrent();
      } else {
        newNote();
      }
    },
    {
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [currentTab, newNote, newNoteCurrent],
  );

  useHotkeys(
    "mod+t",
    () => onModT(),
    {
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [onModT],
  );

  useHotkeys(
    "mod+w",
    async () => {
      if (currentTab) {
        if (currentTab.pinned) {
          unpin(currentTab);
        } else {
          close(currentTab);
        }
      }
    },
    {
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [currentTab, close, unpin],
  );

  useHotkeys(
    "mod+1, mod+2, mod+3, mod+4, mod+5, mod+6, mod+7, mod+8, mod+9",
    (event) => {
      const key = event.key;
      const targetIndex =
        key === "9" ? tabs.length - 1 : Number.parseInt(key, 10) - 1;
      const target = tabs[targetIndex];
      if (target) {
        select(target);
      }
    },
    {
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [tabs, select],
  );

  useHotkeys(
    "mod+alt+left",
    () => selectPrev(),
    {
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [selectPrev],
  );

  useHotkeys(
    "mod+alt+right",
    () => selectNext(),
    {
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [selectNext],
  );

  useHotkeys(
    "mod+shift+t",
    () => restoreLastClosedTab(),
    {
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [restoreLastClosedTab],
  );

  useHotkeys(
    "mod+shift+comma",
    () => openNew({ type: "settings", state: { tab: "general" } }),
    {
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [openNew],
  );

  return { runEscapeShortcut };
}

export function useMainEscapeShortcutAction() {
  return useCallback(() => {
    const { tabs, currentTab, openCurrent, select, goBack, canGoBack } =
      useTabs.getState();

    if (currentTab?.type === "onboarding" || currentTab?.type === "empty") {
      return;
    }

    const returnToSlotId = currentTab?.returnToSlotId;
    const returnToTab = returnToSlotId
      ? tabs.find(
          (tab) =>
            tab.slotId === returnToSlotId &&
            tab.slotId !== currentTab?.slotId &&
            (!currentTab?.returnToTabId ||
              uniqueIdfromTab(tab) === currentTab.returnToTabId),
        )
      : null;
    if (returnToTab) {
      select(returnToTab);
      return;
    }

    if (returnToSlotId === currentTab?.slotId && canGoBack) {
      goBack();
      return;
    }

    const existingHomeTab = tabs.find((tab) => tab.type === "empty");
    if (existingHomeTab) {
      select(existingHomeTab);
      return;
    }

    openCurrent({ type: "empty" });
  }, []);
}

function shouldSkipEscapeShortcut(
  event: KeyboardEvent,
  {
    fromProseMirrorEditor,
    fromSessionTitleInput,
    fromSessionSurface,
    hadEditorEscapeConsumer,
    hadMeaningfulFocus,
  }: {
    fromProseMirrorEditor: boolean;
    fromSessionTitleInput: boolean;
    fromSessionSurface: boolean;
    hadEditorEscapeConsumer: boolean;
    hadMeaningfulFocus: boolean;
  },
) {
  if (!event.defaultPrevented) {
    return false;
  }

  if (!hadMeaningfulFocus) {
    return false;
  }

  if (fromSessionTitleInput || fromSessionSurface) {
    return false;
  }

  if (!fromProseMirrorEditor) {
    return true;
  }

  return hadEditorEscapeConsumer;
}

function hasMeaningfulFocus(target: EventTarget | null) {
  if (isMeaningfulEscapeTarget(target)) {
    return true;
  }

  const activeElement = document.activeElement;

  return (
    activeElement instanceof HTMLElement &&
    activeElement !== document.body &&
    activeElement !== document.documentElement
  );
}

function isMeaningfulEscapeTarget(target: EventTarget | null) {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

  return (
    element !== null &&
    element !== document.body &&
    element !== document.documentElement
  );
}

function isFromProseMirrorEditor(target: EventTarget | null) {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

  return element !== null && element.closest(".ProseMirror") !== null;
}

function isFromSessionTitleInput(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest("[data-session-title-input]") !== null
  );
}

function isFromSessionSurface(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest("[data-session-surface]") !== null
  );
}
