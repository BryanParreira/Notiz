import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";

import { Button } from "@notiz/ui/components/ui/button";
import { Input } from "@notiz/ui/components/ui/input";
import { Textarea } from "@notiz/ui/components/ui/textarea";

import { useConfigValue } from "~/shared/config";
import * as settings from "~/store/tinybase/store/settings";

const MAX_NAME = 60;
const MAX_ABOUT = 400;

export function ProfileForm({
  submitLabel,
  onSaved,
}: {
  submitLabel: React.ReactNode;
  onSaved?: () => void;
}) {
  const { t } = useLingui();
  const name = useConfigValue("user_name");
  const about = useConfigValue("user_about");
  const store = settings.UI.useStore(settings.STORE_ID);

  const form = useForm({
    defaultValues: { name, about },
    onSubmit: ({ value }) => {
      store?.setValue("user_name", value.name.trim().slice(0, MAX_NAME));
      store?.setValue("user_about", value.about.trim().slice(0, MAX_ABOUT));
      onSaved?.();
    },
  });

  return (
    <form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name">
        {(field) => (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              <Trans>What should I call you?</Trans>
            </span>
            <Input
              value={field.state.value}
              maxLength={MAX_NAME}
              autoComplete="off"
              placeholder={t`Your first name`}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>

      <form.Field name="about">
        {(field) => (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              <Trans>Anything I should know about you? (optional)</Trans>
            </span>
            <Textarea
              value={field.state.value}
              maxLength={MAX_ABOUT}
              rows={3}
              placeholder={t`For example: I run a small bakery, I prefer short answers, I work in two time zones.`}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <span className="text-muted-foreground text-xs">
              <Trans>
                Stays on this device. Your assistant uses it to feel like yours.
              </Trans>
            </span>
          </label>
        )}
      </form.Field>

      <Button type="submit" className="w-fit rounded-full">
        {submitLabel}
      </Button>
    </form>
  );
}
