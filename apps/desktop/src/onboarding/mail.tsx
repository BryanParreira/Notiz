import { Trans } from "@lingui/react/macro";

import { OnboardingButton } from "./shared";

import { useMailAccounts } from "~/settings/email/accounts";
import { AppleMailConnect } from "~/settings/email/apple-mail";

export function MailSection({ onContinue }: { onContinue: () => void }) {
  const { data: accounts = [] } = useMailAccounts();

  return (
    <div className="flex flex-col gap-4">
      <AppleMailConnect onConnected={onContinue} />
      {accounts.length > 0 && (
        <>
          <p className="text-muted-foreground text-sm">
            <Trans>
              Mail connected. Add more inboxes any time in Settings.
            </Trans>
          </p>
          <OnboardingButton onClick={onContinue}>
            <Trans>Continue</Trans>
          </OnboardingButton>
        </>
      )}
    </div>
  );
}
