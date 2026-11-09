import { Trans } from "@lingui/react/macro";
import { Link2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import * as main from "~/store/tinybase/store/main";
import { useTabs } from "~/store/zustand/tabs";

// Mentions are stored inline in the note body, so a note links here when its
// body contains a mention node pointing at this session id.
const REFRESH_MS = 2000;

function scan(
  store: NonNullable<ReturnType<typeof main.UI.useStore>>,
  sessionId: string,
) {
  const result: { id: string; title: string }[] = [];
  for (const id of store.getRowIds("sessions")) {
    if (id === sessionId) continue;
    const body = store.getCell("sessions", id, "raw_md");
    if (
      typeof body === "string" &&
      body.includes(sessionId) &&
      body.includes("mention")
    ) {
      const title = store.getCell("sessions", id, "title");
      result.push({ id, title: (title as string) || "Untitled" });
    }
  }
  return result.slice(0, 20);
}

export function Backlinks({ sessionId }: { sessionId: string }) {
  const store = main.UI.useStore(main.STORE_ID);
  const openNew = useTabs((state) => state.openNew);
  const [linking, setLinking] = useState<{ id: string; title: string }[]>([]);

  // Throttled so typing in any note never triggers a rescan per keystroke.
  useEffect(() => {
    if (!store) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      timer = null;
      setLinking(scan(store, sessionId));
    };
    run();
    const listenerId = store.addTableListener("sessions", () => {
      if (!timer) timer = setTimeout(run, REFRESH_MS);
    });
    return () => {
      store.delListener(listenerId);
      if (timer) clearTimeout(timer);
    };
  }, [store, sessionId]);

  if (linking.length === 0) return null;

  return (
    <section className="border-border/60 mt-10 border-t pt-4">
      <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
        <Link2Icon size={12} />
        <Trans>Linked from</Trans>
      </h3>
      <ul className="flex flex-col gap-0.5">
        {linking.map((note) => (
          <li key={note.id}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openNew({ type: "sessions", id: note.id });
              }}
              className="text-muted-foreground hover:text-foreground hover:bg-accent/50 w-full truncate rounded-md px-2 py-1 text-left text-sm transition-colors"
            >
              {note.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
