import { useMutation, useQuery } from "@tanstack/react-query";
import { XCircleIcon } from "lucide-react";
import { useState } from "react";

import {
  commands,
  type ImportSourceInfo,
  type ImportSourceKind,
  type ImportStats,
} from "@notiz/plugin-importer";

import { ImportPreview } from "./import-preview";
import { SourceItem } from "./source-item";

import { importData } from "~/store/tinybase/store/importer";
import * as main from "~/store/tinybase/store/main";
import { save } from "~/store/tinybase/store/save";

type DryRunResult = {
  source: ImportSourceKind;
  stats: ImportStats;
};

export function Data() {
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [successfulSource, setSuccessfulSource] =
    useState<ImportSourceKind | null>(null);
  const store = main.UI.useStore(main.STORE_ID);
  const { user_id } = main.UI.useValues(main.STORE_ID);

  const { data: sources } = useQuery({
    queryKey: ["import-sources"],
    queryFn: async () => {
      const result = await commands.listAvailableSources();
      if (result.status === "error") {
        throw new Error(result.error);
      }
      return result.data;
    },
  });

  const importMutation = useMutation({
    mutationFn: async (source: ImportSourceKind) => {
      const result = await commands.runImport(source, user_id ?? "");
      if (result.status === "error") {
        throw new Error(result.error);
      }

      if (!store) {
        throw new Error("Store not available");
      }

      const importResult = await importData(
        store as main.Store,
        result.data.data,
        save,
      );
      if (importResult.status === "error") {
        throw new Error(importResult.error);
      }

      return result.data.stats;
    },
    onSuccess: () => {
      const source = dryRunResult?.source;
      if (source) {
        setSuccessfulSource(source);
      }
      setDryRunResult(null);
    },
  });

  const dryImportMutation = useMutation({
    mutationFn: async (source: ImportSourceKind) => {
      const result = await commands.runImportDry(source);
      if (result.status === "error") {
        throw new Error(result.error);
      }
      return { source, stats: result.data };
    },
    onSuccess: (result) => {
      setDryRunResult(result);
    },
  });

  const handleCancel = () => {
    setDryRunResult(null);
    dryImportMutation.reset();
    importMutation.reset();
    setSuccessfulSource(null);
  };

  const isPending = importMutation.isPending || dryImportMutation.isPending;

  return (
    <div>
      <p className="text-muted-foreground mt-1 text-sm">
        Import data from other apps.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {dryRunResult ? (
          <ImportPreview
            stats={dryRunResult.stats}
            sourceName={
              sources?.find((s) => s.kind === dryRunResult.source)?.name ??
              "Unknown"
            }
            onConfirm={() => importMutation.mutate(dryRunResult.source)}
            onCancel={handleCancel}
            isPending={importMutation.isPending}
          />
        ) : (
          sources
            ?.filter(
              (
                source,
              ): source is ImportSourceInfo & { kind: ImportSourceKind } =>
                source.kind !== null,
            )
            .map((source) => (
              <SourceItem
                key={source.kind}
                source={source}
                onScan={() => {
                  setSuccessfulSource(null);
                  dryImportMutation.mutate(source.kind);
                }}
                disabled={isPending}
                isScanning={
                  dryImportMutation.isPending &&
                  dryImportMutation.variables === source.kind
                }
                isSuccess={successfulSource === source.kind}
              />
            ))
        )}

        {(importMutation.isError || dryImportMutation.isError) && (
          <div className="flex items-center gap-2 text-xs text-red-600">
            <XCircleIcon size={14} />
            <span>
              {importMutation.isError
                ? `Import failed: ${importMutation.error.message}`
                : `Scan failed: ${dryImportMutation.error?.message}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
