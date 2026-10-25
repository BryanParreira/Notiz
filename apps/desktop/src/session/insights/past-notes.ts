import { useIsMutating, useMutation } from "@tanstack/react-query";
import { generateText, type LanguageModel, Output } from "ai";
import { useCallback, useMemo } from "react";
import { z } from "zod";

import {
  commands as templateCommands,
  type JsonValue,
} from "@notiz/plugin-template";
import { format, safeParseDate } from "@notiz/utils";

import systemPromptTemplate from "./past-note-key-facts.system.md.jinja?raw";
import userPromptTemplate from "./past-note-key-facts.user.md.jinja?raw";

import { useLanguageModel } from "~/ai/hooks";
import { deterministicGenerationSettings } from "~/ai/model-settings";
import { extractPlainText } from "~/search/contexts/engine/utils";
import { getSessionEvent } from "~/session/utils";
import { createSourceHash } from "~/shared/hash";
import {
  ignoreCurrentNoteText,
  useStoreChangeVersion,
} from "~/shared/hooks/useStoreChangeVersion";
import { showTransientToast } from "~/sidebar/toast/transient";
import * as main from "~/store/tinybase/store/main";

export type PastSessionNote = {
  sessionId: string;
  title: string;
  dateLabel: string;
  participantNames?: string[];
  summary: string | null;
  isGenerating: boolean;
  isRegenerateDisabled?: boolean;
};

export type PastSessionNoteRequest = {
  sessionId: string;
  userId: string;
  title: string;
  dateLabel: string;
  sourceText: string;
  sourceHash: string;
  participantNames: string[];
};

export type PastSessionNotesResult = {
  notes: PastSessionNote[];
  hasPastNotes: boolean;
  isGenerating: boolean;
  canGenerate: boolean;
  regenerate: (sessionId: string) => void;
  regenerateAll: () => void;
};

type MainStore = NonNullable<ReturnType<typeof main.UI.useStore>>;

const MAX_PAST_NOTES = 8;
const MAX_SOURCE_LENGTH = 6000;
const MAX_KEY_FACTS = 3;
const KEY_FACTS_GENERATION_TIMEOUT_MS = 30_000;
const SPACE_REGEX = /\s+/g;
const GENERIC_TITLE_KEYS = new Set(["new note", "untitled"]);

const keyFactsSchema = z.object({
  facts: z.array(z.string()).min(1).max(MAX_KEY_FACTS),
});

export function usePastSessionNotes(
  sessionId: string,
  { enabled = true }: { enabled?: boolean } = {},
): PastSessionNotesResult {
  const mutationKey = useMemo(
    () => ["past-session-notes", sessionId],
    [sessionId],
  );
  const activeMutationCount = useIsMutating({ mutationKey });
  const store = main.UI.useStore(main.STORE_ID);
  // Rebuilt from the store when something relevant changes. Listening to the
  // whole tables would redo the work for every keystroke in the current note.
  const changes = useStoreChangeVersion(
    store,
    [
      "sessions",
      "mapping_session_participant",
      "humans",
      "enhanced_notes",
      "session_key_facts",
    ],
    { enabled, ignore: ignoreCurrentNoteText(sessionId) },
  );
  const userId = main.UI.useValue("user_id", main.STORE_ID);
  const model = useLanguageModel("enhance");

  const built = useMemo(() => {
    if (!enabled || !store) {
      return { notes: [], missing: [], requests: [] };
    }

    return buildPastSessionNotes(
      store,
      sessionId,
      typeof userId === "string" ? userId : null,
    );
  }, [store, enabled, sessionId, userId, changes]);

  const mutation = useMutation({
    mutationKey,
    mutationFn: async (requests: PastSessionNoteRequest[]) => {
      if (!store || !model || requests.length === 0) {
        return;
      }

      await generateAndSavePastSessionNotes({
        store,
        model,
        requests,
      });
    },
    onError: (error) => {
      console.error("Failed to generate meeting insights", error);
      showTransientToast({
        id: "past-note-key-facts-error",
        description: "Could not generate meeting insights. Try again.",
        variant: "error",
      });
    },
  });

  const {
    mutate,
    isPending: mutationIsPending,
    variables: mutationVariables,
  } = mutation;

  const generatingIds = useMemo(
    () =>
      mutationIsPending && mutationVariables
        ? new Set(mutationVariables.map((request) => request.sessionId))
        : new Set<string>(),
    [mutationIsPending, mutationVariables],
  );
  const isGenerating = mutationIsPending || activeMutationCount > 0;

  const notes = useMemo(
    () =>
      built.notes.map((note) => ({
        ...note,
        isGenerating: generatingIds.has(note.sessionId),
        isRegenerateDisabled: isGenerating,
      })),
    [built.notes, generatingIds, isGenerating],
  );

  const regenerate = useCallback(
    (targetSessionId: string) => {
      if (!enabled || !model || isGenerating) {
        return;
      }

      const request = built.requests.find(
        (request) => request.sessionId === targetSessionId,
      );
      if (!request) {
        return;
      }

      mutate([request]);
    },
    [built.requests, enabled, isGenerating, model, mutate],
  );

  const regenerateAll = useCallback(() => {
    if (!enabled || !model || built.requests.length === 0 || isGenerating) {
      return;
    }

    mutate(built.requests);
  }, [built.requests, enabled, isGenerating, model, mutate]);

  return {
    notes,
    hasPastNotes: notes.length > 0,
    isGenerating,
    canGenerate: enabled && Boolean(model),
    regenerate,
    regenerateAll,
  };
}

export type LastMeeting = {
  humanId: string;
  name: string;
  sessionId: string;
  title: string;
  dateLabel: string;
};

export function useLastMeetings(sessionId: string): LastMeeting[] {
  const store = main.UI.useStore(main.STORE_ID);
  const changes = useStoreChangeVersion(
    store,
    ["sessions", "mapping_session_participant", "humans"],
    { ignore: ignoreCurrentNoteText(sessionId) },
  );
  const userId = main.UI.useValue("user_id", main.STORE_ID);

  return useMemo(
    () =>
      store
        ? buildLastMeetings(
            store,
            sessionId,
            typeof userId === "string" ? userId : null,
          )
        : [],
    [store, sessionId, userId, changes],
  );
}

// "When did I last meet this person, and about what" is the single most useful
// line of history before a meeting. Only sessions before this one count.
export function buildLastMeetings(
  store: MainStore,
  sessionId: string,
  userId: string | null,
): LastMeeting[] {
  const currentSession = store.getRow("sessions", sessionId);
  if (!currentSession || Object.keys(currentSession).length === 0) {
    return [];
  }

  const participantIds = getSessionParticipantIds(store, sessionId, userId);
  if (participantIds.size === 0) {
    return [];
  }

  const currentTimestamp = getSessionTimestamp(currentSession);
  const latest = new Map<string, { sessionId: string; timestamp: number }>();

  store.forEachRow("mapping_session_participant", (mappingId, _forEachCell) => {
    const mapping = store.getRow("mapping_session_participant", mappingId);
    const humanId = mapping.human_id;
    const candidateSessionId = mapping.session_id;
    if (
      !humanId ||
      !candidateSessionId ||
      candidateSessionId === sessionId ||
      mapping.source === "excluded" ||
      !participantIds.has(humanId)
    ) {
      return;
    }

    const candidate = store.getRow("sessions", candidateSessionId);
    if (!candidate || Object.keys(candidate).length === 0) {
      return;
    }

    const timestamp = getSessionTimestamp(candidate);
    if (currentTimestamp > 0 && timestamp >= currentTimestamp) {
      return;
    }

    const existing = latest.get(humanId);
    if (!existing || timestamp > existing.timestamp) {
      latest.set(humanId, { sessionId: candidateSessionId, timestamp });
    }
  });

  return [...latest.entries()]
    .map(([humanId, { sessionId: pastSessionId }]) => {
      const human = store.getRow("humans", humanId);
      const session = store.getRow("sessions", pastSessionId);
      return {
        humanId,
        name:
          typeof human.name === "string" && human.name.trim()
            ? human.name.trim()
            : humanId,
        sessionId: pastSessionId,
        title: getSessionTitle(session),
        dateLabel: formatSessionDate(session),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function useCanShowInsights(sessionId: string): boolean {
  const useValue =
    (main.UI.useValue as typeof main.UI.useValue | undefined) ??
    ((() => undefined) as unknown as typeof main.UI.useValue);
  const store = main.UI.useStore(main.STORE_ID);
  const changes = useStoreChangeVersion(
    store,
    [
      "sessions",
      "mapping_session_participant",
      "humans",
      "enhanced_notes",
      "session_key_facts",
    ],
    { ignore: ignoreCurrentNoteText(sessionId) },
  );
  const userId = useValue("user_id", main.STORE_ID);

  return useMemo(() => {
    if (!store || typeof store.getRow !== "function") {
      return false;
    }

    return (
      buildPastSessionNotes(
        store,
        sessionId,
        typeof userId === "string" ? userId : null,
      ).notes.length > 0
    );
  }, [store, sessionId, userId, changes]);
}

export function buildPastSessionNotes(
  store: MainStore,
  sessionId: string,
  userId: string | null,
): {
  notes: PastSessionNote[];
  missing: PastSessionNoteRequest[];
  requests: PastSessionNoteRequest[];
} {
  const currentSession = store.getRow("sessions", sessionId);
  if (!currentSession) {
    return { notes: [], missing: [], requests: [] };
  }

  const index = buildSessionIndex(store);
  const currentParticipantIds = getSessionParticipantIds(
    store,
    sessionId,
    userId,
    index,
  );
  const currentEvent = getSessionEvent(currentSession);
  const currentSeriesId = getRecurrenceSeriesId(currentEvent);
  const currentTitleKey = getSessionTitleKey(currentSession);
  if (!currentSeriesId && !currentTitleKey) {
    return { notes: [], missing: [], requests: [] };
  }

  const currentTimestamp = getSessionTimestamp(currentSession);
  const items: Array<{
    note: PastSessionNote & { dateMs: number };
    request: PastSessionNoteRequest;
    isMissing: boolean;
  }> = [];

  store.forEachRow("sessions", (candidateSessionId, _forEachCell) => {
    if (candidateSessionId === sessionId) {
      return;
    }

    const candidateSession = store.getRow("sessions", candidateSessionId);
    if (!candidateSession) {
      return;
    }

    const candidateTimestamp = getSessionTimestamp(candidateSession);
    if (
      currentTimestamp > 0 &&
      candidateTimestamp > 0 &&
      candidateTimestamp >= currentTimestamp
    ) {
      return;
    }

    const candidateEvent = getSessionEvent(candidateSession);
    const candidateParticipantIds = getSessionParticipantIds(
      store,
      candidateSessionId,
      userId,
      index,
    );
    if (
      !isRelatedPastSession({
        currentParticipantIds,
        currentSeriesId,
        currentTitleKey,
        candidateParticipantIds,
        candidateSeriesId: getRecurrenceSeriesId(candidateEvent),
        candidateTitleKey: getSessionTitleKey(candidateSession),
      })
    ) {
      return;
    }

    const source = getSessionKeyFactsSource(store, candidateSessionId, index);
    if (!source) {
      return;
    }

    const title = getSessionTitle(candidateSession);
    const dateLabel = formatSessionDate(candidateSession);
    const sourceHash = createSourceHash([title, dateLabel, source].join("\n"));
    const saved = getSavedKeyFacts(store, candidateSessionId, sourceHash);
    const ownerUserId = getSessionUserId(candidateSession, userId);
    const participantNames = getSessionParticipantNames(
      store,
      new Set([...currentParticipantIds, ...candidateParticipantIds]),
    );
    const request = {
      sessionId: candidateSessionId,
      userId: ownerUserId,
      title,
      dateLabel,
      sourceText: source,
      sourceHash,
      participantNames,
    };

    items.push({
      note: {
        sessionId: candidateSessionId,
        title,
        dateLabel,
        participantNames,
        summary: saved,
        isGenerating: false,
        dateMs: candidateTimestamp,
      },
      request,
      isMissing: !saved,
    });
  });

  const selected = items
    .sort((a, b) => b.note.dateMs - a.note.dateMs)
    .slice(0, MAX_PAST_NOTES);

  return {
    notes: selected.map(({ note }) => {
      const { dateMs: _dateMs, ...rest } = note;
      return rest;
    }),
    missing: selected.flatMap((item) => (item.isMissing ? [item.request] : [])),
    requests: selected.map((item) => item.request),
  };
}

async function generateAndSavePastSessionNotes({
  store,
  model,
  requests,
}: {
  store: MainStore;
  model: LanguageModel;
  requests: PastSessionNoteRequest[];
}) {
  const rows: Array<PastSessionNoteRequest & { content: string }> = [];

  for (const request of requests) {
    const content = await generatePastSessionKeyFacts({ model, request });
    if (content) {
      rows.push({ ...request, content });
    }
  }

  if (rows.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  store.transaction(() => {
    for (const row of rows) {
      const existingCreatedAt = store.getCell(
        "session_key_facts",
        row.sessionId,
        "created_at",
      );

      store.setRow("session_key_facts", row.sessionId, {
        user_id: row.userId,
        session_id: row.sessionId,
        created_at:
          typeof existingCreatedAt === "string" && existingCreatedAt
            ? existingCreatedAt
            : now,
        updated_at: now,
        content: row.content,
        source_hash: row.sourceHash,
      });
    }
  });
}

async function generatePastSessionKeyFacts({
  model,
  request,
}: {
  model: LanguageModel;
  request: PastSessionNoteRequest;
}): Promise<string> {
  const system = await renderJinja(systemPromptTemplate, {});
  const prompt = await renderJinja(userPromptTemplate, {
    session: {
      title: request.title,
      date_label: request.dateLabel,
      participant_names: request.participantNames,
    },
    summaries: request.sourceText,
  });

  const result = await generateText({
    model,
    ...deterministicGenerationSettings(model),
    system,
    prompt,
    output: Output.object({ schema: keyFactsSchema }),
    maxRetries: 2,
    maxOutputTokens: 400,
    timeout: { totalMs: KEY_FACTS_GENERATION_TIMEOUT_MS },
  });

  return normalizeFacts(result.output?.facts ?? []).join("\n");
}

type TemplateContext = Partial<{ [key: string]: JsonValue }>;

async function renderJinja(templateContent: string, ctx: TemplateContext) {
  const result = await templateCommands.renderCustom(templateContent, ctx);
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.data;
}

function normalizeFacts(facts: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const fact of facts) {
    const text = fact
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(SPACE_REGEX, " ")
      .trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(text);
  }

  return normalized.slice(0, MAX_KEY_FACTS);
}

function getSavedKeyFacts(
  store: MainStore,
  sessionId: string,
  sourceHash: string,
): string | null {
  const row = store.getRow("session_key_facts", sessionId);
  if (
    row.session_id !== sessionId ||
    row.source_hash !== sourceHash ||
    !row.content?.trim()
  ) {
    return null;
  }

  return row.content.trim();
}

type Row = Record<string, any>;

// Each table is read once and grouped by note. Looking up one note's rows used to
// scan the whole table, and that happened for every candidate note, so a rebuild
// took time proportional to the square of the library.
type SessionIndex = {
  participants: Map<string, Row[]>;
  enhancedNotes: Map<string, Row[]>;
};

function groupBySession(store: MainStore, tableId: string) {
  const grouped = new Map<string, Row[]>();

  store.forEachRow(tableId as "sessions", (rowId, _forEachCell) => {
    const row = store.getRow(tableId as "sessions", rowId) as Row;
    const sessionId = row.session_id;
    if (typeof sessionId !== "string" || !sessionId) {
      return;
    }

    const rows = grouped.get(sessionId);
    if (rows) rows.push(row);
    else grouped.set(sessionId, [row]);
  });

  return grouped;
}

function buildSessionIndex(store: MainStore): SessionIndex {
  return {
    participants: groupBySession(store, "mapping_session_participant"),
    enhancedNotes: groupBySession(store, "enhanced_notes"),
  };
}

function getSessionKeyFactsSource(
  store: MainStore,
  sessionId: string,
  index?: SessionIndex,
): string | null {
  const summaries: Array<{ content: string; position: number }> = [];

  const notes: Row[] =
    index?.enhancedNotes.get(sessionId) ??
    (index
      ? []
      : [...(groupBySession(store, "enhanced_notes").get(sessionId) ?? [])]);

  for (const note of notes) {
    if (!note.content?.trim()) {
      continue;
    }

    summaries.push({
      content: note.content,
      position: typeof note.position === "number" ? note.position : 0,
    });
  }

  summaries.sort((a, b) => a.position - b.position);
  const summaryText = cleanSourceText(
    summaries.map((note) => extractPlainText(note.content)).join("\n\n"),
  );
  return summaryText ? truncateAtWord(summaryText, MAX_SOURCE_LENGTH) : null;
}

function cleanSourceText(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_~>#]/g, "")
    .replace(/(^|\s)([-+]|[0-9]+[.)])\s+/g, " ")
    .replace(SPACE_REGEX, " ")
    .trim();
}

function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const slice = text.slice(0, maxLength + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const end = lastSpace > maxLength * 0.6 ? lastSpace : maxLength;
  return `${slice.slice(0, end).trim()}...`;
}

function getSessionParticipantIds(
  store: MainStore,
  sessionId: string,
  userId: string | null,
  index?: SessionIndex,
): Set<string> {
  const participantIds = new Set<string>();

  const mappings: Row[] =
    index?.participants.get(sessionId) ??
    (index
      ? []
      : [
          ...(groupBySession(store, "mapping_session_participant").get(
            sessionId,
          ) ?? []),
        ]);

  for (const mapping of mappings) {
    if (mapping.source === "excluded" || !mapping.human_id) {
      continue;
    }

    const ownerUserId =
      typeof mapping.user_id === "string" && mapping.user_id.trim()
        ? mapping.user_id
        : null;
    const isCurrentUser =
      (userId && mapping.human_id === userId) ||
      (!userId && ownerUserId && mapping.human_id === ownerUserId);
    if (!isCurrentUser) {
      participantIds.add(mapping.human_id);
    }
  }

  return participantIds;
}

function getSessionParticipantNames(
  store: MainStore,
  participantIds: Set<string>,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const participantId of participantIds) {
    const human = store.getRow("humans", participantId);
    const name =
      typeof human.name === "string" && human.name.trim()
        ? human.name.trim()
        : participantId;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    names.push(name);
  }

  return names.sort((a, b) => a.localeCompare(b));
}

function isRelatedPastSession({
  currentParticipantIds,
  currentSeriesId,
  currentTitleKey,
  candidateParticipantIds,
  candidateSeriesId,
  candidateTitleKey,
}: {
  currentParticipantIds: Set<string>;
  currentSeriesId: string | null;
  currentTitleKey: string;
  candidateParticipantIds: Set<string>;
  candidateSeriesId: string | null;
  candidateTitleKey: string;
}) {
  if (currentSeriesId && candidateSeriesId === currentSeriesId) {
    return true;
  }

  if (!currentTitleKey || currentTitleKey !== candidateTitleKey) {
    return false;
  }

  if (currentParticipantIds.size === 0 || candidateParticipantIds.size === 0) {
    return true;
  }

  for (const participantId of candidateParticipantIds) {
    if (currentParticipantIds.has(participantId)) {
      return true;
    }
  }

  return false;
}

function getSessionTitle(session: { title?: string }): string {
  return session.title?.trim() || "Untitled";
}

function getSessionTitleKey(session: { title?: string }): string {
  const key = getSessionTitle(session).toLowerCase().replace(SPACE_REGEX, " ");
  return GENERIC_TITLE_KEYS.has(key) ? "" : key;
}

function getSessionUserId(
  session: { user_id?: string },
  fallbackUserId: string | null,
): string {
  return session.user_id?.trim() || fallbackUserId || "";
}

function getRecurrenceSeriesId(
  event: ReturnType<typeof getSessionEvent>,
): string | null {
  const seriesId = event?.recurrence_series_id?.trim();
  return seriesId || null;
}

function getSessionTimestamp(session: {
  created_at?: string;
  event_json?: string;
}): number {
  const event = getSessionEvent(session);
  const value = event?.started_at || session.created_at;
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatSessionDate(session: {
  created_at?: string;
  event_json?: string;
}): string {
  const event = getSessionEvent(session);
  const parsed = safeParseDate(event?.started_at || session.created_at);
  return parsed ? format(parsed, "MMM d, yyyy") : "";
}
