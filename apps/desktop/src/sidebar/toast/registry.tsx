import type { ToastCondition, ToastType } from "./types";

import type { DevtoolsToastPreview } from "~/store/zustand/devtools-toast-preview";

type ToastRegistryEntry = {
  toast: ToastType;
  condition: ToastCondition;
};

type DevtoolsToastPreviewParams = {
  preview: DevtoolsToastPreview;
  onSignIn: () => void | Promise<void>;
};

export function createToastRegistry(): ToastRegistryEntry[] {
  return [];
}

export function getToastToShow(
  registry: ToastRegistryEntry[],
  isDismissed: (id: string) => boolean,
): ToastType | null {
  for (const entry of registry) {
    if (entry.condition() && !isDismissed(entry.toast.id)) {
      return entry.toast;
    }
  }
  return null;
}

export function createDevtoolsToastPreview({
  preview,
  onSignIn,
}: DevtoolsToastPreviewParams): ToastType {
  switch (preview) {
    case "pro":
      return {
        id: "devtools-upgrade-to-pro",
        description: "Pro features available",
        primaryAction: {
          label: "Upgrade",
          onClick: onSignIn,
        },
        dismissible: true,
      };
  }
}
