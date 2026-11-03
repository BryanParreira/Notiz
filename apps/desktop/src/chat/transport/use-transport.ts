import type { LanguageModel, ToolSet } from "ai";
import { useEffect, useMemo, useState } from "react";

import { commands as templateCommands } from "@notiz/plugin-template";

import {
  buildLeanPrompt,
  buildProfileBlock,
  SMALL_TALK_INSTRUCTION,
} from "./guidance";
import { isSmallTalk, wantsCardOnly } from "./helpers";
import { CustomChatTransport } from "./index";
import type { DataContext, ResolvedChatContext } from "./index";

import { useLanguageModel } from "~/ai/hooks";
import { warmUpLocalModel } from "~/ai/hooks/useLLMConnection";
import {
  buildAgenda,
  buildScheduleContext,
  emptyScheduleMessage,
  rangeForMessage,
} from "~/chat/context/daily-context";
import { pickEmailCards } from "~/chat/context/email-cards";
import type { ContextRef } from "~/chat/context/entities";
import { createInboxCache } from "~/chat/context/inbox-cache";
import {
  buildInboxContext,
  buildInboxSnapshot,
  wantsEmailBody,
} from "~/chat/context/inbox-context";
import {
  fetchInboxMessage,
  fetchInboxMessages,
} from "~/chat/context/inbox-data";
import { hydrateSessionContextFromFs } from "~/chat/context/session-context-hydrator";
import type { AgendaDay, EmailCard } from "~/chat/types";
import { useToolRegistry } from "~/contexts/tool";
import { useConfigValue } from "~/shared/config";
import * as main from "~/store/tinybase/store/main";
import * as settings from "~/store/tinybase/store/settings";

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

const inboxCache = createInboxCache(() => fetchInboxMessages(40));

// Email subjects are only added to every message when the model runs on this
// Mac. With any other provider they are sent only when the user asks about email.
const ON_DEVICE_PROVIDERS = new Set(["notiz_local", "ollama", "lmstudio"]);

// The email part of a card-only reply: the cards, or a plain sentence when there
// is nothing to show (no account, nothing unread, or mail could not be read).
async function loadInboxCards(
  text: string,
): Promise<{ emailCards?: EmailCard[]; plain?: string }> {
  const { inbox, error } = await inboxCache.get(8000);

  if (!inbox) {
    console.error("[chat] could not load the inbox", error);
    return {
      plain: `I couldn't load your email just now${error ? ` (${error})` : ""}.`,
    };
  }
  if (!inbox.connected) {
    return {
      plain:
        "No email account is connected yet. You can connect one in Settings > Email.",
    };
  }

  const emailCards = pickEmailCards(inbox.messages, text);
  if (emailCards.length > 0) return { emailCards };

  return {
    plain: /\bunread\b/i.test(text)
      ? "You have no unread email."
      : "Your inbox is empty.",
  };
}

// The email part of a reply the model writes (drafting, explaining, planning).
async function loadInboxContext(text: string): Promise<string> {
  const { inbox, error } = await inboxCache.get(8000);

  if (!inbox) {
    console.error("[chat] could not load the inbox", error);
    return `The user's email could not be loaded right now${error ? ` (${error})` : ""}. Tell them you could not check it and why.`;
  }

  const candidates = /\bunread\b/i.test(text)
    ? inbox.messages.filter((message) => message.unread)
    : inbox.messages;
  const newestId = wantsEmailBody(text) ? candidates[0]?.id : undefined;
  const newest = newestId
    ? await fetchInboxMessage(newestId).catch(() => null)
    : null;

  return buildInboxContext(inbox, text, newest);
}

async function loadInboxSnapshot(): Promise<string | null> {
  const { inbox } = await inboxCache.get(600);
  return inbox ? buildInboxSnapshot(inbox) : null;
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
  const userName = useConfigValue("user_name");
  const userAbout = useConfigValue("user_about");
  const { current_llm_provider } = settings.UI.useValues(settings.STORE_ID);
  const modelIsOnDevice = ON_DEVICE_PROVIDERS.has(current_llm_provider ?? "");

  // Start reading mail as soon as chat is open, so it is ready by the first
  // message instead of making that message wait.
  useEffect(() => {
    if (modelIsOnDevice) {
      inboxCache.refresh().catch(() => {});
    }
    // Load the built-in model while the user is still typing, so the first
    // answer does not wait for it to start. It unloads again if unused.
    if (current_llm_provider === "notiz_local") {
      warmUpLocalModel();
    }
  }, [modelIsOnDevice, current_llm_provider]);
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

  const profileBlock = useMemo(
    () => buildProfileBlock(userName, userAbout),
    [userName, userAbout],
  );
  const baseSystemPrompt = systemPromptOverride ?? systemPrompt;
  const effectiveSystemPrompt =
    baseSystemPrompt !== undefined && profileBlock && !systemPromptOverride
      ? `${baseSystemPrompt}\n\n${profileBlock}`
      : baseSystemPrompt;
  const leanPrompt = useMemo(
    () =>
      systemPromptOverride
        ? undefined
        : [buildLeanPrompt(language), profileBlock]
            .filter(Boolean)
            .join("\n\n"),
    [language, profileBlock, systemPromptOverride],
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
      async (groups, text): Promise<DataContext | null> => {
        // A greeting gets a greeting, with none of the user's week attached.
        if (isSmallTalk(text)) return { text: SMALL_TALK_INSTRUCTION };

        const asksCalendar = groups.includes("calendar");
        const asksInbox = groups.includes("inbox");

        // "Show me" questions are answered with cards and nothing else, so the
        // reply is instant and nothing is typed out twice.
        if ((asksCalendar || asksInbox) && wantsCardOnly(text)) {
          const plain: string[] = [];
          let agenda: AgendaDay[] | undefined;
          let emailCards: EmailCard[] | undefined;

          if (asksCalendar && store) {
            const range = rangeForMessage(text);
            const days = buildAgenda(store, range);
            if (days.length > 0) agenda = days;
            else plain.push(emptyScheduleMessage(store, range));
          }

          if (asksInbox) {
            const inbox = await loadInboxCards(text);
            emailCards = inbox.emailCards;
            if (inbox.plain) plain.push(inbox.plain);
          }

          if (agenda || emailCards || plain.length > 0) {
            return {
              direct: true,
              text: plain.join("\n\n") || null,
              agenda,
              emailCards,
            };
          }
        }

        const parts: string[] = [];

        // The calendar is always there for the model: the days asked about, or
        // today and tomorrow as background.
        if (store) {
          parts.push(
            buildScheduleContext(
              store,
              rangeForMessage(asksCalendar ? text : ""),
            ),
          );
        }

        if (asksInbox) {
          parts.push(await loadInboxContext(text));
        } else if (modelIsOnDevice) {
          const snapshot = await loadInboxSnapshot();
          if (snapshot) parts.push(snapshot);
        }

        return parts.length > 0 ? { text: parts.join("\n\n") } : null;
      },
      leanPrompt,
    );
  }, [model, tools, effectiveSystemPrompt, leanPrompt, store, modelIsOnDevice]);

  return {
    transport,
    isSystemPromptReady,
  };
}
