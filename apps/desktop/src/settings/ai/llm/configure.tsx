import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { commands as localLlmCommands } from "@notiz/plugin-local-llm";
import { Accordion } from "@notiz/ui/components/ui/accordion";

import { useLlmSettings } from "./context";
import { ProviderId, PROVIDERS } from "./shared";

import {
  useLocalLlmModelDownload,
  useRecommendedLocalLlmModel,
} from "~/ai/hooks/useLocalLlmModel";
import { NonNotizProviderCard, StyledStreamdown } from "~/settings/ai/shared";

export function ConfigureProviders() {
  const { accordionValue, setAccordionValue } = useLlmSettings();

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-md font-sans font-semibold">
        <Trans>Configure Providers</Trans>
      </h3>
      <Accordion
        type="single"
        collapsible
        className="flex flex-col gap-3"
        value={accordionValue}
        onValueChange={setAccordionValue}
      >
        {PROVIDERS.filter((provider) => provider.id !== "notiz").map(
          (provider) => (
            <NonNotizProviderCard
              key={provider.id}
              config={provider}
              providerType="llm"
              providers={PROVIDERS}
              providerContext={<ProviderContext providerId={provider.id} />}
            />
          ),
        )}
      </Accordion>
    </div>
  );
}

function ProviderContext({ providerId }: { providerId: ProviderId }) {
  if (providerId === "notiz_local") {
    return <LocalLlmDownloadStatus />;
  }

  const content =
    providerId === "lmstudio"
      ? "- Ensure LM Studio server is **running.** (Default port is 1234)\n- Enable **CORS** in LM Studio config."
      : providerId === "ollama"
        ? "- Ensure Ollama is **running** (`ollama serve`)\n- Pull a model first (`ollama pull llama3.2`)"
        : providerId === "custom"
          ? "We only support **OpenAI-compatible** endpoints for now."
          : providerId === "openrouter"
            ? "We filter out models from the combobox based on heuristics like **input modalities** and **tool support**."
            : providerId === "azure_openai"
              ? "Enter your **Azure OpenAI endpoint** (e.g. `https://your-resource.openai.azure.com`) as the Base URL and your **API key**. [Report issues](https://github.com/BryanParreira/Notiz/issues)"
              : providerId === "azure_ai"
                ? "Enter your **Azure AI Foundry endpoint** as the Base URL and your **API key**. Supports Claude and other models deployed via Azure AI Foundry. [Report issues](https://github.com/BryanParreira/Notiz/issues)"
                : providerId === "google_generative_ai"
                  ? "Visit [AI Studio](https://aistudio.google.com/api-keys) to create an API key."
                  : providerId === "cloudflare_workers_ai"
                    ? "Enter the Workers AI **OpenAI-compatible base URL** as `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1` and use a Cloudflare API token with Workers AI access."
                    : "";

  if (!content) {
    return null;
  }

  return <StyledStreamdown className="mb-3">{content}</StyledStreamdown>;
}

function LocalLlmDownloadStatus() {
  const {
    isDownloaded,
    showProgress,
    progress,
    hasError,
    errorMessage,
    handleDownload,
    handleCancel,
  } = useLocalLlmModelDownload();
  const recommended = useRecommendedLocalLlmModel();
  const { data: supported } = useQuery({
    queryKey: ["local-llm", "supported"],
    queryFn: async () => {
      const result = await localLlmCommands.listSupportedModel();
      return result.status === "ok" ? result.data : [];
    },
    staleTime: Infinity,
  });
  const info = supported?.find((model) => model.key === recommended);

  return (
    <div className="mb-3 flex flex-col gap-2">
      <StyledStreamdown>
        Runs fully on-device — no account, no external server to install or
        configure. The model downloads once and stays local.
      </StyledStreamdown>

      {info && (
        <p className="text-xs">
          <span className="font-medium">{info.name}</span>
          {" · "}
          {(info.size_bytes / 1024 ** 3).toFixed(1)} GB
          <span className="text-muted-foreground"> · {info.description}</span>
        </p>
      )}

      {hasError && errorMessage && (
        <p className="text-destructive text-xs">{errorMessage}</p>
      )}

      {isDownloaded ? (
        <span className="text-muted-foreground text-xs">
          <Trans>Model downloaded and ready.</Trans>
        </span>
      ) : showProgress ? (
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="size-3 animate-spin" />
          <span>{Math.round(progress)}%</span>
          <button
            type="button"
            className="text-muted-foreground underline"
            onClick={handleCancel}
          >
            <Trans>Cancel</Trans>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={[
            "w-fit rounded-full px-3 py-1 text-[11px] font-medium",
            "from-muted to-accent text-foreground bg-linear-to-t shadow-xs hover:shadow-md",
          ].join(" ")}
          onClick={handleDownload}
        >
          <Trans>Download model</Trans>
        </button>
      )}
    </div>
  );
}
