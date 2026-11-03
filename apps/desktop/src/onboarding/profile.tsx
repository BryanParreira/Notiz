import { Trans } from "@lingui/react/macro";

import { ProfileForm } from "~/settings/profile/profile-form";

export function ProfileSection({ onContinue }: { onContinue: () => void }) {
  return (
    <ProfileForm submitLabel={<Trans>Continue</Trans>} onSaved={onContinue} />
  );
}
