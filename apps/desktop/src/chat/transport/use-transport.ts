import type { LanguageModel, ToolSet } from "ai";
import { useEffect, useMemo, useState } from "react";

import { commands as templateCommands } from "@notiz/plugin-template";

import { CustomChatTransport } from "./index";
import type { ResolvedChatContext } from "./index";

import { useLanguageModel } from "~/ai/hooks";
import type { ContextRef } from "~/chat/context/entities";
import { hydrateSessionContextFromFs } from "~/chat/context/session-context-hydrator";
import { useToolRegistry } from "~/contexts/tool";
import { useConfigValue } from "~/shared/config";
import * as main from "~/store/tinybase/store/main";

export const FILE_CONTEXT_TOOL_GUIDANCE = `
You are a general-purpose assistant first. Answer directly from your own knowledge for anything that does not depend on the user's own data: questions, writing, brainstorming, explanations, code, maths, advice and plain conversation. Do not mention notes or meetings unless the user does.

Tool use:
- Only use a tool when the answer depends on the user's own notes, meetings, schedule, contacts, or on current information from the web. For greetings, small talk, opinions, writing, coding and general-knowledge questions, do not call any tool.
- Never call the same tool twice with the same input. If a tool fails or finds nothing useful, stop using it and answer as well as you can, saying briefly what you could not find.
- Schedule questions ("what do I have today", "this week", "am I free tomorrow"): use list_schedule with a range. To find one event by name, use search_calendar_events.
- Questions about past meetings or notes when no note is attached: use search_sessions with key names and topics. Pass filters only as a JSON object like {"created_at":{"kind":"relative","recent_days":7}}, never as a string. If a result looks relevant, answer from it or call read_note with the returned session id.
- Use read_current_note only when the user says "this note", "this meeting" or similar and a note is open. If it fails, there is no open note: continue without it.
- To find exact wording in notes, use grep_notes, then read_note with the returned session id if you need the full source.
- For people from the current note or related meetings, use list_related_notes and then read_note as needed. To look someone up, use search_contacts.
- When the user corrects note content with wording like "it's not X but Y", use apply_session_correction to update the current session summary and/or transcript. Do not merely acknowledge a correction that should update the note.
- Do not assume note contents from chat history when a tool can read the current source of truth.

Web search:
- Use web_search for public websites, URLs, companies, products, people, news, or current facts that may be outside local data, and include source URLs in the answer.
- Do not use web_search for questions that only need local notes, contacts, or calendar events.
`.trim();

export function appendFileContextToolGuidance(
  prompt: string | undefined,
): string | undefined {
  if (prompt === undefined) {
    return undefined;
  }

  if (!prompt.trim()) {
    return FILE_CONTEXT_TOOL_GUIDANCE;
  }

  return `${prompt.trim()}\n\n${FILE_CONTEXT_TOOL_GUIDANCE}`;
}

function renderHumanContext(
  store: ReturnType<typeof main.UI.useStore>,
  humanId: string,
): string | null {
  if (!store) {
    return null;
  }

  const human = store.getRow("humans", humanId);
  const orgId = typeof human.org_id === "string" ? human.org_id : "";
  const organization =
    orgId && store.hasRow("organizations", orgId)
      ? store.getRow("organizations", orgId)
      : {};

  const name =
    typeof human.name === "string" && human.name.trim() ? human.name : null;
  const email =
    typeof human.email === "string" && human.email.trim() ? human.email : null;
  const jobTitle =
    typeof human.job_title === "string" && human.job_title.trim()
      ? human.job_title
      : null;
  const organizationName =
    typeof organization.name === "string" && organization.name.trim()
      ? organization.name
      : null;
  const memo =
    typeof human.memo === "string" && human.memo.trim() ? human.memo : null;

  if (!name && !email) {
    return null;
  }

  const details = [
    jobTitle,
    organizationName ? `Organization: ${organizationName}` : null,
    email ? `Email: ${email}` : null,
    memo ? `Notes: ${memo}` : null,
  ].filter(Boolean);

  return [`Referenced contact: ${name ?? email}`, ...details].join("\n");
}

function renderOrganizationContext(
  store: ReturnType<typeof main.UI.useStore>,
  organizationId: string,
): string | null {
  if (!store) {
    return null;
  }

  const organization = store.getRow("organizations", organizationId);
  const name =
    typeof organization.name === "string" && organization.name.trim()
      ? organization.name
      : null;

  return name ? `Referenced organization: ${name}` : null;
}

export function useTransport(
  modelOverride?: LanguageModel,
  extraTools?: ToolSet,
  systemPromptOverride?: string,
  store?: ReturnType<typeof main.UI.useStore>,
) {
  const registry = useToolRegistry();
  const configuredModel = useLanguageModel("chat");
  const model = modelOverride ?? configuredModel;
  const language = useConfigValue("ai_language") || "en";
  const [systemPrompt, setSystemPrompt] = useState<string | undefined>();

  useEffect(() => {
    if (systemPromptOverride) {
      setSystemPrompt(systemPromptOverride);
      return;
    }

    let stale = false;

    templateCommands
      .render({
        chatSystem: {
          language,
        },
      })
      .then((result) => {
        if (stale) {
          return;
        }

        if (result.status === "ok") {
          setSystemPrompt(result.data);
        } else {
          setSystemPrompt("");
        }
      })
      .catch((error) => {
        console.error(error);
        if (!stale) {
          setSystemPrompt("");
        }
      });

    return () => {
      stale = true;
    };
  }, [language, systemPromptOverride]);

  const effectiveSystemPrompt = appendFileContextToolGuidance(
    systemPromptOverride ?? systemPrompt,
  );
  const isSystemPromptReady =
    typeof systemPromptOverride === "string" || systemPrompt !== undefined;

  const tools = useMemo(() => {
    const localTools = registry.getTools("chat-general");

    if (extraTools && import.meta.env.DEV) {
      for (const key of Object.keys(extraTools)) {
        if (key in localTools) {
          console.warn(
            `[ChatSession] Tool name collision: "${key}" exists in both local registry and extraTools. extraTools will take precedence.`,
          );
        }
      }
    }

    return {
      ...localTools,
      ...extraTools,
    };
  }, [registry, extraTools]);

  const transport = useMemo(() => {
    if (!model) {
      return null;
    }

    return new CustomChatTransport(
      model,
      tools,
      effectiveSystemPrompt,
      async (ref: ContextRef) => {
        if (!store) {
          return null;
        }
        if (ref.kind === "session") {
          const context = await hydrateSessionContextFromFs(
            store,
            ref.sessionId,
          );
          return context
            ? ({ kind: "session", context } satisfies ResolvedChatContext)
            : null;
        }

        if (ref.kind === "human") {
          const text = renderHumanContext(store, ref.humanId);
          return text
            ? ({ kind: "text", text } satisfies ResolvedChatContext)
            : null;
        }

        const text = renderOrganizationContext(store, ref.organizationId);
        return text
          ? ({ kind: "text", text } satisfies ResolvedChatContext)
          : null;
      },
    );
  }, [model, tools, effectiveSystemPrompt, store]);

  return {
    transport,
    isSystemPromptReady,
  };
}
