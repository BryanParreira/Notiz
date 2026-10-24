import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { commands as localSttCommands } from "@notiz/plugin-local-stt";
import type { AIProviderStorage } from "@notiz/store";

import { useBillingAccess } from "~/auth/billing";
import { providerRowId } from "~/settings/ai/shared";
import { type ProviderId } from "~/settings/ai/stt/shared";
import * as settings from "~/store/tinybase/store/settings";
import { isNotizCloudSttModel, isNotizLocalSttModel } from "~/stt/capabilities";

export const useSTTConnection = () => {
  const billing = useBillingAccess();
  const { current_stt_provider, current_stt_model } = settings.UI.useValues(
    settings.STORE_ID,
  ) as {
    current_stt_provider: ProviderId | undefined;
    current_stt_model: string | undefined;
  };

  const providerConfig = settings.UI.useRow(
    "ai_providers",
    current_stt_provider ? providerRowId("stt", current_stt_provider) : "",
    settings.STORE_ID,
  ) as AIProviderStorage | undefined;

  // First-run only, mirrors the same pattern for the local LLM provider:
  // once the background-prefetched Parakeet Streaming model finishes
  // downloading, auto-select it — but only if the user hasn't configured
  // *any* STT provider yet. Never overrides an existing choice.
  const defaultLocalModel = "soniqo-parakeet-streaming" as const;
  const isDefaultLocalModelDownloaded = useQuery({
    queryKey: ["stt-default-local-model-downloaded"],
    queryFn: () => localSttCommands.isModelDownloaded(defaultLocalModel),
    refetchInterval: (query) =>
      query.state.data?.status === "ok" && query.state.data.data ? false : 5000,
    select: (result) => result.status === "ok" && result.data,
  }).data;
  const setSttProvider = settings.UI.useSetValueCallback(
    "current_stt_provider",
    (provider: string) => provider,
    [],
    settings.STORE_ID,
  );
  const setSttModel = settings.UI.useSetValueCallback(
    "current_stt_model",
    (model: string) => model,
    [],
    settings.STORE_ID,
  );
  useEffect(() => {
    if (!current_stt_provider && isDefaultLocalModelDownloaded) {
      setSttProvider("notiz");
      setSttModel(defaultLocalModel);
    }
  }, [
    current_stt_provider,
    isDefaultLocalModelDownloaded,
    setSttProvider,
    setSttModel,
  ]);

  const localModel = isNotizLocalSttModel(
    current_stt_provider,
    current_stt_model,
  )
    ? current_stt_model
    : null;
  const isLocalModel = !!localModel;

  const isCloudModel = isNotizCloudSttModel(
    current_stt_provider,
    current_stt_model,
  );

  const local = useQuery({
    enabled: current_stt_provider === "notiz",
    queryKey: ["stt-connection", current_stt_provider, localModel],
    // Every open note mounts this. Poll quickly until the speech server is
    // ready, then back off; a crash is still noticed within ten seconds.
    refetchInterval: (query) =>
      query.state.data?.status === "ready" ? 10_000 : 1000,
    queryFn: async () => {
      if (!localModel) {
        return null;
      }

      const downloaded = await localSttCommands.isModelDownloaded(localModel);
      if (downloaded.status !== "ok" || !downloaded.data) {
        return { status: "not_downloaded" as const, connection: null };
      }

      const serverResult = await localSttCommands.getServerForModel(localModel);

      if (serverResult.status !== "ok") {
        return null;
      }

      const server = serverResult.data;

      if (server?.status === "ready" && server.url) {
        return {
          status: "ready" as const,
          connection: {
            provider: current_stt_provider!,
            model: localModel,
            baseUrl: server.url,
            apiKey: "",
          },
        };
      }

      return {
        status: server?.status ?? "loading",
        connection: null,
      };
    },
  });

  const baseUrl = providerConfig?.base_url?.trim();
  const apiKey = providerConfig?.api_key?.trim();

  const connection = useMemo(() => {
    if (!current_stt_provider || !current_stt_model) {
      return null;
    }

    if (isLocalModel) {
      return local.data?.connection ?? null;
    }

    if (isCloudModel) {
      return null;
    }

    if (!baseUrl || !apiKey) {
      return null;
    }

    return {
      provider: current_stt_provider,
      model: current_stt_model,
      baseUrl,
      apiKey,
    };
  }, [
    current_stt_provider,
    current_stt_model,
    localModel,
    isLocalModel,
    isCloudModel,
    local.data,
    baseUrl,
    apiKey,
    billing.isPaid,
  ]);

  return {
    conn: connection,
    local,
    isLocalModel,
    isCloudModel,
  };
};
