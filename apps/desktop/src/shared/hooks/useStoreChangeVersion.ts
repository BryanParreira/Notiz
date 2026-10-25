import { useEffect, useRef, useState } from "react";

import * as main from "~/store/tinybase/store/main";

type Store = NonNullable<ReturnType<typeof main.UI.useStore>>;

export type StoreChange = { tableId: string; rowId: string; cellId: string };

// The store is typed per table, which gets in the way of listening to tables
// chosen at run time. This is just the two methods used, with plain strings.
type CellListening = {
  addCellListener(
    tableId: string,
    rowId: null,
    cellId: null,
    listener: (
      store: unknown,
      tableId: string,
      rowId: string,
      cellId: string,
    ) => void,
  ): string;
  delListener(listenerId: string): void;
};

// A counter that goes up when something the caller cares about changes. Useful
// when a value is rebuilt by reading the store directly: subscribing to a whole
// table (`useTable`) re-renders on every edit anywhere in it, such as each
// keystroke in a note, while this can skip changes that cannot matter. Changes
// that arrive together are collapsed into one update per frame.
export function useStoreChangeVersion(
  store: Store | undefined,
  tableIds: readonly string[],
  {
    enabled = true,
    ignore,
  }: {
    enabled?: boolean;
    ignore?: (change: StoreChange, store: Store) => boolean;
  } = {},
) {
  const [version, setVersion] = useState(0);
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;
  const tableKey = tableIds.join("|");

  useEffect(() => {
    if (!store || !enabled) return;

    let frame: number | null = null;
    const bump = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setVersion((current) => current + 1);
      });
    };

    const listening = store as unknown as CellListening;
    const listenerIds = tableKey.split("|").map((tableId) =>
      listening.addCellListener(
        tableId,
        null,
        null,
        (_store, changedTable, rowId, cellId) => {
          const change = { tableId: changedTable, rowId, cellId };
          if (ignoreRef.current?.(change, store)) return;
          bump();
        },
      ),
    );

    return () => {
      for (const id of listenerIds) listening.delListener(id);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [store, enabled, tableKey]);

  return version;
}

// Typing in a note, or streaming its AI notes, changes the current note's text.
// The history around it never reads that text, so those changes are skipped.
export function ignoreCurrentNoteText(sessionId: string) {
  return (change: StoreChange, store: Store) => {
    if (change.tableId === "sessions") {
      return change.rowId === sessionId && change.cellId === "raw_md";
    }
    if (change.tableId === "enhanced_notes") {
      return (
        change.cellId === "content" &&
        store.getCell("enhanced_notes", change.rowId, "session_id") ===
          sessionId
      );
    }
    return false;
  };
}
