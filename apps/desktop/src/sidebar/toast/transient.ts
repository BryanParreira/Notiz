import { create } from "zustand";

import type { ToastType } from "./types";

const DEFAULT_TRANSIENT_TOAST_DURATION_MS = 2400;
const READABLE_TOAST_DURATION_MS = 9000;
const SHORT_TOAST_MAX_LENGTH = 36;

// Errors and longer messages stay long enough to actually be read.
function defaultDuration(toast: { variant?: string; description?: unknown }) {
  const long =
    typeof toast.description === "string" &&
    toast.description.length > SHORT_TOAST_MAX_LENGTH;
  return toast.variant === "error" || long
    ? READABLE_TOAST_DURATION_MS
    : DEFAULT_TRANSIENT_TOAST_DURATION_MS;
}

type TransientToastInput = Omit<ToastType, "dismissible" | "id"> & {
  dismissible?: boolean;
  id?: string;
};

type TransientToast = ToastType & {
  key: string;
};

type TransientToastState = {
  toast: TransientToast | null;
  showToast: (
    toast: TransientToastInput,
    options?: { durationMs?: number },
  ) => void;
  clearToast: (key?: string) => void;
};

let toastSequence = 0;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

export const useTransientToast = create<TransientToastState>((set, get) => ({
  toast: null,
  showToast: (toast, options) => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }

    const key = `${toast.id ?? "transient-toast"}:${++toastSequence}`;
    const nextToast: TransientToast = {
      ...toast,
      id: toast.id ?? "transient-toast",
      dismissible: toast.dismissible ?? false,
      key,
    };

    set({ toast: nextToast });

    dismissTimer = setTimeout(
      () => {
        if (get().toast?.key === key) {
          set({ toast: null });
        }
        dismissTimer = null;
      },
      options?.durationMs ?? defaultDuration(toast),
    );
  },
  clearToast: (key) => {
    if (key && get().toast?.key !== key) {
      return;
    }

    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }

    set({ toast: null });
  },
}));

export function showTransientToast(
  toast: TransientToastInput,
  options?: { durationMs?: number },
) {
  useTransientToast.getState().showToast(toast, options);
}
