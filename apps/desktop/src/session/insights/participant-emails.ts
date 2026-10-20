import { useMemo } from "react";

import * as main from "~/store/tinybase/store/main";

export function useParticipantEmails(sessionId: string): string[] {
  const participants = main.UI.useTable(
    "mapping_session_participant",
    main.STORE_ID,
  );
  const humans = main.UI.useTable("humans", main.STORE_ID);

  return useMemo(() => {
    const emails = Object.values(participants)
      .filter((row) => row.session_id === sessionId)
      .map((row) => String(humans[String(row.human_id)]?.email ?? "").trim())
      .filter(Boolean);

    return [...new Set(emails)];
  }, [participants, humans, sessionId]);
}
