import { describe, expect, test, vi } from "vitest";

import { buildNoteSaveOps } from "./note";

import { createTestMainStore } from "~/store/tinybase/persister/testing/mocks";

vi.mock("@tauri-apps/api/path", () => ({
  sep: () => "/",
}));

describe("buildNoteSaveOps", () => {
  test("does not delete empty memos when folder-only changes are saved", () => {
    const store = createTestMainStore();
    store.setRow("sessions", "session-1", {
      user_id: "user-1",
      created_at: "2024-01-01T00:00:00Z",
      title: "Test Session",
      folder_id: "work",
      event_json: "",
      raw_md: "",
    });

    const ops = buildNoteSaveOps(
      store,
      store.getTables(),
      "/data",
      new Set(["session-1"]),
      { deleteEmptyMemos: false },
    );

    expect(ops).toEqual([]);
  });

  test("deletes empty memos when note content is cleared", () => {
    const store = createTestMainStore();
    store.setRow("sessions", "session-1", {
      user_id: "user-1",
      created_at: "2024-01-01T00:00:00Z",
      title: "Test Session",
      folder_id: "work",
      event_json: "",
      raw_md: "",
    });

    const ops = buildNoteSaveOps(
      store,
      store.getTables(),
      "/data",
      new Set(["session-1"]),
      { deleteEmptyMemos: true },
    );

    expect(ops).toEqual([
      {
        type: "delete",
        paths: ["/data/sessions/work/session-1/_memo.md"],
      },
    ]);
  });

  test("never deletes memos when every note is saved at once", () => {
    const store = createTestMainStore();
    for (const id of ["a", "b"]) {
      store.setRow("sessions", id, {
        user_id: "user-1",
        created_at: "2024-01-01T00:00:00Z",
        title: id,
        folder_id: "",
        event_json: "",
        raw_md: "",
      });
    }

    const ops = buildNoteSaveOps(store, store.getTables(), "/data", undefined, {
      deleteEmptyMemos: true,
    });

    expect(ops).toEqual([]);
  });

  test("does not delete the memo of a note that did not change", () => {
    const store = createTestMainStore();
    for (const id of ["opened", "untouched"]) {
      store.setRow("sessions", id, {
        user_id: "user-1",
        created_at: "2024-01-01T00:00:00Z",
        title: id,
        folder_id: "",
        event_json: "",
        raw_md: "",
      });
    }

    const ops = buildNoteSaveOps(
      store,
      store.getTables(),
      "/data",
      new Set(["opened"]),
      { deleteEmptyMemos: true },
    );

    expect(ops).toEqual([
      { type: "delete", paths: ["/data/sessions/opened/_memo.md"] },
    ]);
  });
});
