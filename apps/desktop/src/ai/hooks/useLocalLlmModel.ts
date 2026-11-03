import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import {
  commands as localLlmCommands,
  events as localLlmEvents,
  type GgufLlmModel,
} from "@notiz/plugin-local-llm";

// Used until the Mac's memory has been read: the smaller model is the safe
// choice on any machine.
const FALLBACK_LOCAL_LLM_MODEL: GgufLlmModel = "Qwen3p5_4bQ4";

// Best first, so a Mac that already has a bigger model keeps using it.
const PREFERENCE: GgufLlmModel[] = [
  "Qwen3p5_9bQ4",
  "Qwen3p5_4bQ4",
  "Llama3p2_3bQ4",
];

// The model recommended for this Mac's memory when it is downloaded. Failing
// that, one the user already has (the old default, for existing installs), so
// an update never leaves chat without a model. Failing that, the recommendation,
// which is what the download button then fetches.
export async function pickLocalLlmModel(): Promise<GgufLlmModel> {
  const recommended = await localLlmCommands.recommendedModel();
  const wanted =
    recommended.status === "ok" ? recommended.data : FALLBACK_LOCAL_LLM_MODEL;

  const downloaded = await localLlmCommands.listDownloadedModel();
  if (downloaded.status !== "ok") return wanted;
  if (downloaded.data.includes(wanted)) return wanted;

  const have = PREFERENCE.find((model) => downloaded.data.includes(model));
  return have ?? wanted;
}

export const localLlmKeys = {
  all: ["local-llm"] as const,
  default: ["local-llm", "default"] as const,
  recommended: ["local-llm", "recommended"] as const,
  model: (model: GgufLlmModel) =>
    [...localLlmKeys.all, "model", model] as const,
  downloaded: (model: GgufLlmModel) =>
    [...localLlmKeys.model(model), "downloaded"] as const,
  downloading: (model: GgufLlmModel) =>
    [...localLlmKeys.model(model), "downloading"] as const,
};

export const localLlmQueries = {
  isDownloaded: (model: GgufLlmModel) =>
    queryOptions({
      // Checked app-wide, so don't poll: nothing downloads in the background
      // any more, and a finished download invalidates this query.
      queryKey: localLlmKeys.downloaded(model),
      queryFn: () => localLlmCommands.isModelDownloaded(model),
      select: (result) => {
        if (result.status === "error") {
          throw new Error(result.error);
        }
        return result.data;
      },
    }),
  isDownloading: (model: GgufLlmModel) =>
    queryOptions({
      refetchInterval: 1000,
      queryKey: localLlmKeys.downloading(model),
      queryFn: () => localLlmCommands.isModelDownloading(model),
      select: (result) => {
        if (result.status === "error") {
          throw new Error(result.error);
        }
        return result.data;
      },
    }),
};

async function fetchRecommendedLocalLlmModel(): Promise<GgufLlmModel> {
  const result = await localLlmCommands.recommendedModel();
  return result.status === "ok" ? result.data : FALLBACK_LOCAL_LLM_MODEL;
}

// The model to offer for download on this Mac, even when an older one is
// already installed. Not the same as the one in use (see pickLocalLlmModel).
export function useRecommendedLocalLlmModel(): GgufLlmModel | undefined {
  return useQuery({
    queryKey: localLlmKeys.recommended,
    queryFn: fetchRecommendedLocalLlmModel,
    staleTime: Infinity,
  }).data;
}

// Every model worth showing in a picker: the recommendation first, then
// anything already downloaded.
export async function listLocalLlmModels(): Promise<GgufLlmModel[]> {
  const recommended = await fetchRecommendedLocalLlmModel();
  const downloaded = await localLlmCommands.listDownloadedModel();
  const others =
    downloaded.status === "ok"
      ? PREFERENCE.filter(
          (model) => model !== recommended && downloaded.data.includes(model),
        )
      : [];
  return [recommended, ...others];
}

// Undefined until the Mac's memory has been read.
export function useDefaultLocalLlmModel(): GgufLlmModel | undefined {
  return useQuery({
    queryKey: localLlmKeys.default,
    queryFn: pickLocalLlmModel,
    staleTime: Infinity,
  }).data;
}

export function useLocalLlmModelDownload(modelOverride?: GgufLlmModel) {
  const queryClient = useQueryClient();
  const recommendedModel = useRecommendedLocalLlmModel();
  const model = modelOverride ?? recommendedModel ?? FALLBACK_LOCAL_LLM_MODEL;
  const [progress, setProgress] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isDownloaded = useQuery(localLlmQueries.isDownloaded(model));
  const isDownloading = useQuery(localLlmQueries.isDownloading(model));

  const showProgress =
    !isDownloaded.data && (isStarting || (isDownloading.data ?? false));

  // Global broadcast, not tied to whoever's `Channel` triggered the
  // download — this is what makes progress visible here even when the
  // download was kicked off silently from app startup, not this button.
  useEffect(() => {
    const unlisten = localLlmEvents.downloadProgressPayload.listen((event) => {
      if (event.payload.model !== model) {
        return;
      }

      const { status } = event.payload;
      if (typeof status === "object" && "failed" in status) {
        setErrorMessage(status.failed);
        setIsStarting(false);
        setProgress(0);
      } else if (status === "completed") {
        setErrorMessage(null);
        setIsStarting(false);
        setProgress(100);
        void queryClient.invalidateQueries({
          queryKey: localLlmKeys.downloaded(model),
        });
        void queryClient.invalidateQueries({ queryKey: localLlmKeys.default });
        // A model that is already loaded keeps serving until it stops, so
        // stop it and the next message starts the one just downloaded.
        void localLlmCommands.stopServer();
      } else if (typeof status === "object" && "downloading" in status) {
        setErrorMessage(null);
        setIsStarting(false);
        setProgress(Math.max(0, Math.min(100, status.downloading)));
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [model, queryClient]);

  const handleDownload = useCallback(() => {
    if (isDownloaded.data || isDownloading.data || isStarting) {
      return;
    }

    setErrorMessage(null);
    setIsStarting(true);
    setProgress(0);

    const channel = new Channel<number>();
    channel.onmessage = (value) => {
      // Real failure text arrives via `downloadProgressPayload` (the
      // `DownloadStatus::Failed(reason)` broadcast handled above) — don't
      // clobber it here with a generic message, since ordering between
      // this channel and that event isn't guaranteed.
      setIsStarting(false);
      setProgress(value < 0 ? 0 : value);
    };

    void localLlmCommands.downloadModel(model, channel).then((result) => {
      if (result.status === "error") {
        setErrorMessage(result.error);
        setIsStarting(false);
      }
    });
  }, [isDownloaded.data, isDownloading.data, isStarting, model]);

  const handleCancel = useCallback(() => {
    void localLlmCommands.cancelDownload(model);
    setIsStarting(false);
    setProgress(0);
  }, [model]);

  return {
    progress,
    hasError: errorMessage !== null,
    errorMessage,
    isDownloaded: isDownloaded.data ?? false,
    isDownloadedLoading: isDownloaded.isLoading,
    showProgress,
    handleDownload,
    handleCancel,
  };
}
