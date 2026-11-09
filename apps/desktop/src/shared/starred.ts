import { useSyncExternalStore } from "react";

const STORAGE_KEY = "notiz-starred-notes";
const EVENT = "notiz-starred-change";

let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    cache = Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(ids: string[]) {
  cache = ids;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // The in-memory copy still works for this run.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useStarredIds(): string[] {
  return useSyncExternalStore(subscribe, read, read);
}

export function toggleStarred(sessionId: string) {
  const ids = read();
  write(
    ids.includes(sessionId)
      ? ids.filter((id) => id !== sessionId)
      : [sessionId, ...ids],
  );
}
