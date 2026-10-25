import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { useQuery } from "@tanstack/react-query";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { extractReasoningMiddleware, wrapLanguageModel } from "ai";
import { useEffect, useMemo, useRef } from "react";

import type { NotizTask } from "@notiz/api-client";
import { commands as localLlmCommands } from "@notiz/plugin-local-llm";
import type { AIProviderStorage } from "@notiz/store";

import { createAuthFetch } from "../auth-fetch";
import {
  createLocalLlmFetch,
  LOCAL_LLM_PLACEHOLDER_ORIGIN,
} from "../local-llm-fetch";
import { createTracedFetch, tracedFetch } from "../traced-fetch";
import { DEFAULT_LOCAL_LLM_MODEL, localLlmQueries } from "./useLocalLlmModel";

import { useAuth } from "~/auth";
import { useBillingAccess } from "~/auth/billing";
import { env } from "~/env";
import { type ProviderId, PROVIDERS } from "~/settings/ai/llm/shared";
import { providerRowId } from "~/settings/ai/shared";
import {
  getProviderSelectionBlockers,
  type ProviderEligibilityContext,
} from "~/settings/ai/shared/eligibility";
import * as settings from "~/store/tinybase/store/settings";

type LanguageModelV3 = Parameters<typeof wrapLanguageModel>[0]["model"];

type LLMConnectionInfo = {
  providerId: ProviderId;
  modelId: string;
  baseUrl: string;
  apiKey: string;
};

export type LLMConnectionStatus =
  | { status: "pending"; reason: "missing_provider" }
  | { status: "pending"; reason: "missing_model"; providerId: ProviderId }
  | {
      status: "pending";
      reason: "local_server_starting";
      providerId: "notiz_local";
    }
  | { status: "error"; reason: "provider_not_found"; providerId: string }
  | { status: "error"; reason: "unauthenticated"; providerId: "notiz" }
  | { status: "error"; reason: "not_pro"; providerId: "notiz" }
  | {
      status: "error";
      reason: "missing_config";
      providerId: ProviderId;
      missing: Array<"base_url" | "api_key">;
    }
  | { status: "success"; providerId: ProviderId; isHosted: boolean };

type LLMConnectionResult = {
  conn: LLMConnectionInfo | null;
  status: LLMConnectionStatus;
};

export const useLanguageModel = (task?: NotizTask): LanguageModelV3 | null => {
  const { conn } = useLLMConnection();
  const accessTokenRef = useRef<string | undefined>(undefined);

  return useMemo(() => {
    if (!conn) return null;

    const hostedFetch =
      conn.providerId === "notiz"
        ? createAuthFetch(
            task ? createTracedFetch(task) : tracedFetch,
            () => accessTokenRef.current,
          )
        : undefined;

    return createLanguageModel(conn, task, hostedFetch);
  }, [conn, task]);
};

export const useLLMConnection = (): LLMConnectionResult => {
  const auth = useAuth();
  const billing = useBillingAccess();

  const { current_llm_provider, current_llm_model } = settings.UI.useValues(
    settings.STORE_ID,
  );
  const providerConfig = settings.UI.useRow(
    "ai_providers",
    current_llm_provider ? providerRowId("llm", current_llm_provider) : "",
    settings.STORE_ID,
  ) as AIProviderStorage | undefined;

  // Once the local model has been downloaded from Settings, auto-select it,
  // but only if the user hasn't configured *any* provider yet. Never
  // overrides an existing choice.
  const isLocalModelDownloaded = useQuery(
    localLlmQueries.isDownloaded(DEFAULT_LOCAL_LLM_MODEL),
  ).data;
  const setLlmProvider = settings.UI.useSetValueCallback(
    "current_llm_provider",
    (provider: string) => provider,
    [],
    settings.STORE_ID,
  );
  const setLlmModel = settings.UI.useSetValueCallback(
    "current_llm_model",
    (model: string) => model,
    [],
    settings.STORE_ID,
  );
  useEffect(() => {
    if (!current_llm_provider && isLocalModelDownloaded) {
      setLlmProvider("notiz_local");
      setLlmModel(DEFAULT_LOCAL_LLM_MODEL);
    }
  }, [
    current_llm_provider,
    isLocalModelDownloaded,
    setLlmProvider,
    setLlmModel,
  ]);

  return useMemo<LLMConnectionResult>(
    () =>
      resolveLLMConnection({
        providerId: current_llm_provider,
        modelId: current_llm_model,
        providerConfig,
        session: auth?.session,
        isPaid: billing.isPaid,
        isLocalModelDownloaded: isLocalModelDownloaded ?? false,
      }),
    [
      auth,
      billing.isPaid,
      current_llm_model,
      current_llm_provider,
      providerConfig,
      isLocalModelDownloaded,
    ],
  );
};

export const useLLMConnectionStatus = (): LLMConnectionStatus => {
  const { status } = useLLMConnection();
  return status;
};

const resolveLLMConnection = (params: {
  providerId: string | undefined;
  modelId: string | undefined;
  providerConfig: AIProviderStorage | undefined;
  session: { access_token: string } | null | undefined;
  isPaid: boolean;
  isLocalModelDownloaded: boolean;
}): LLMConnectionResult => {
  const {
    providerId: rawProviderId,
    modelId,
    providerConfig,
    session,
    isPaid,
    isLocalModelDownloaded,
  } = params;

  if (!rawProviderId) {
    return {
      conn: null,
      status: { status: "pending", reason: "missing_provider" },
    };
  }

  const providerId = rawProviderId as ProviderId;

  if (!modelId) {
    return {
      conn: null,
      status: { status: "pending", reason: "missing_model", providerId },
    };
  }

  const providerDefinition = PROVIDERS.find((p) => p.id === rawProviderId);

  if (!providerDefinition) {
    return {
      conn: null,
      status: {
        status: "error",
        reason: "provider_not_found",
        providerId: rawProviderId,
      },
    };
  }

  if (providerId === "notiz_local") {
    if (!isLocalModelDownloaded) {
      return {
        conn: null,
        status: { status: "pending", reason: "missing_model", providerId },
      };
    }

    // The server starts on the first request (see local-llm-fetch), so there is
    // no port yet; the fetch swaps this placeholder for the real one.
    return {
      conn: {
        providerId,
        modelId,
        baseUrl: `${LOCAL_LLM_PLACEHOLDER_ORIGIN}/v1`,
        apiKey: "",
      },
      status: { status: "success", providerId, isHosted: false },
    };
  }

  const baseUrl =
    providerConfig?.base_url?.trim() ||
    providerDefinition.baseUrl?.trim() ||
    "";
  const apiKey = providerConfig?.api_key?.trim() || "";

  const context: ProviderEligibilityContext = {
    isAuthenticated: !!session,
    isPaid,
    config: { base_url: baseUrl, api_key: apiKey },
  };

  const blockers = getProviderSelectionBlockers(
    providerDefinition.requirements,
    context,
  );

  if (blockers.length > 0) {
    const blocker = blockers[0];
    if (blocker.code === "requires_auth" && providerId === "notiz") {
      return {
        conn: null,
        status: { status: "error", reason: "unauthenticated", providerId },
      };
    }
    if (blocker.code === "requires_entitlement" && providerId === "notiz") {
      return {
        conn: null,
        status: { status: "error", reason: "not_pro", providerId },
      };
    }
    if (blocker.code === "missing_config") {
      return {
        conn: null,
        status: {
          status: "error",
          reason: "missing_config",
          providerId,
          missing: blocker.fields,
        },
      };
    }
  }

  if (providerId === "notiz" && session) {
    return {
      conn: {
        providerId,
        modelId,
        baseUrl: baseUrl ?? new URL("/llm", env.VITE_API_URL).toString(),
        apiKey: session.access_token,
      },
      status: { status: "success", providerId, isHosted: true },
    };
  }

  return {
    conn: { providerId, modelId, baseUrl, apiKey },
    status: { status: "success", providerId, isHosted: false },
  };
};

const wrapWithThinkingMiddleware = (
  model: LanguageModelV3,
): LanguageModelV3 => {
  return wrapLanguageModel({
    model,
    middleware: [
      extractReasoningMiddleware({ tagName: "think" }),
      extractReasoningMiddleware({ tagName: "thinking" }),
    ],
  });
};

const localLlmFetch = createLocalLlmFetch({
  start: async () => {
    const result = await localLlmCommands.startServer(DEFAULT_LOCAL_LLM_MODEL);
    if (result.status === "error") throw new Error(String(result.error));
    return result.data;
  },
  stop: () => localLlmCommands.stopServer(),
  send: tauriFetch,
});

// Called when chat opens, so the built-in model is loading while the user types.
export const warmUpLocalModel = () => localLlmFetch.warm();

const createLanguageModel = (
  conn: LLMConnectionInfo,
  task?: NotizTask,
  hostedFetch?: typeof fetch,
): LanguageModelV3 => {
  switch (conn.providerId) {
    case "notiz": {
      const provider = createOpenRouter({
        fetch: hostedFetch ?? (task ? createTracedFetch(task) : tracedFetch),
        baseURL: conn.baseUrl,
        apiKey: conn.apiKey,
      });
      return wrapWithThinkingMiddleware(provider.chat(conn.modelId));
    }

    case "anthropic": {
      const provider = createAnthropic({
        fetch: tauriFetch,
        apiKey: conn.apiKey,
        headers: {
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      return wrapWithThinkingMiddleware(provider(conn.modelId));
    }

    case "google_generative_ai": {
      const provider = createGoogleGenerativeAI({
        fetch: tauriFetch,
        baseURL: conn.baseUrl,
        apiKey: conn.apiKey,
      });
      return wrapWithThinkingMiddleware(provider(conn.modelId));
    }

    case "openrouter": {
      const provider = createOpenRouter({
        fetch: tauriFetch,
        apiKey: conn.apiKey,
      });
      return wrapWithThinkingMiddleware(provider.chat(conn.modelId));
    }

    case "openai": {
      const provider = createOpenAI({
        fetch: tauriFetch,
        baseURL: conn.baseUrl,
        apiKey: conn.apiKey,
      });
      return wrapWithThinkingMiddleware(provider(conn.modelId));
    }

    case "azure_openai": {
      const provider = createAzure({
        fetch: tauriFetch,
        baseURL: conn.baseUrl,
        apiKey: conn.apiKey,
      });
      return wrapWithThinkingMiddleware(provider(conn.modelId));
    }

    case "azure_ai": {
      const provider = createOpenAICompatible({
        fetch: tauriFetch,
        name: "azure_ai",
        baseURL: conn.baseUrl,
        apiKey: conn.apiKey,
        headers: { "api-key": conn.apiKey },
      });
      return wrapWithThinkingMiddleware(provider.chatModel(conn.modelId));
    }

    case "notiz_local": {
      const provider = createOpenAICompatible({
        fetch: localLlmFetch,
        name: conn.providerId,
        baseURL: conn.baseUrl,
      });
      return wrapWithThinkingMiddleware(provider.chatModel(conn.modelId));
    }

    case "ollama": {
      const ollamaOrigin = new URL(conn.baseUrl.replace(/\/v1\/?$/, "")).origin;
      const ollamaFetch: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Origin", ollamaOrigin);
        return tauriFetch(input as RequestInfo | URL, {
          ...init,
          headers,
        });
      };
      const provider = createOpenAICompatible({
        fetch: ollamaFetch,
        name: conn.providerId,
        baseURL: conn.baseUrl,
      });
      return wrapWithThinkingMiddleware(provider.chatModel(conn.modelId));
    }

    default: {
      const config: Parameters<typeof createOpenAICompatible>[0] = {
        fetch: tauriFetch,
        name: conn.providerId,
        baseURL: conn.baseUrl,
      };
      if (conn.apiKey) {
        config.apiKey = conn.apiKey;
      }
      const provider = createOpenAICompatible(config);
      return wrapWithThinkingMiddleware(provider.chatModel(conn.modelId));
    }
  }
};
