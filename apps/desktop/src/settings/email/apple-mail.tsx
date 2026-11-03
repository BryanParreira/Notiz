import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { MailIcon } from "lucide-react";

import { commands as mailCommands } from "@notiz/plugin-mail";
import { Button } from "@notiz/ui/components/ui/button";

import { invalidateMail, useMailAccounts } from "./accounts";

export const APPLE_MAIL_HOST = "apple-mail";

export function useConnectAppleMail(onConnected?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await mailCommands.addAppleMailAccount();
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
    onSuccess: async () => {
      await invalidateMail(queryClient);
      onConnected?.();
    },
  });
}

export function AppleMailConnect({
  onConnected,
  className,
}: {
  onConnected?: () => void;
  className?: string;
}) {
  const { data: accounts = [] } = useMailAccounts();
  const connect = useConnectAppleMail(onConnected);

  if (platform() !== "macos") return null;

  const connected = accounts.some((a) => a.host === APPLE_MAIL_HOST);
  if (connected) return null;

  return (
    <div className={className}>
      <Button
        type="button"
        onClick={() => connect.mutate()}
        disabled={connect.isPending}
        className="w-fit gap-2 rounded-full"
      >
        <MailIcon className="size-4" />
        {connect.isPending ? (
          <Trans>Waiting for Mail…</Trans>
        ) : (
          <Trans>Use Mail on this Mac</Trans>
        )}
      </Button>
      <p className="text-muted-foreground mt-2 text-xs">
        <Trans>
          Reads your Mail app inbox, every account you have added there. macOS
          will ask once to let Notiz control Mail. Read-only; no password is
          stored.
        </Trans>
      </p>
      {connect.isError && (
        <p className="text-destructive mt-2 text-sm">
          {connect.error instanceof Error
            ? connect.error.message
            : String(connect.error)}
        </p>
      )}
    </div>
  );
}
