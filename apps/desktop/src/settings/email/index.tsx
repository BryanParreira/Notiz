import { Trans } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";

import { commands as mailCommands } from "@notiz/plugin-mail";
import { commands as openerCommands } from "@notiz/plugin-opener2";
import { Button } from "@notiz/ui/components/ui/button";
import { Input } from "@notiz/ui/components/ui/input";
import { cn } from "@notiz/utils";

import { getPreset, MAIL_PRESETS } from "./presets";

import { SettingsPageTitle } from "~/settings/page-title";

export const MAIL_ACCOUNTS_QUERY_KEY = ["mail-accounts"] as const;

export function useMailAccounts() {
  return useQuery({
    queryKey: MAIL_ACCOUNTS_QUERY_KEY,
    queryFn: async () => {
      const result = await mailCommands.listMailAccounts();
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
  });
}

export function SettingsEmail() {
  const { data: accounts = [] } = useMailAccounts();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const result = await mailCommands.removeMailAccount(id);
      if (result.status === "error") throw new Error(result.error);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: MAIL_ACCOUNTS_QUERY_KEY }),
  });

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <SettingsPageTitle title={<Trans>Email</Trans>} />
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            <Trans>
              Optional and read-only. Notiz talks straight to your mail provider
              from this device, keeps the password in your Keychain, and only
              reads message headers to show context for your meetings. It never
              sends, deletes or marks mail as read.
            </Trans>
          </span>
        </p>
      </div>

      {accounts.length > 0 && (
        <ul className="border-border divide-border divide-y rounded-2xl border">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              <MailIcon className="text-muted-foreground size-4 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{account.label}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {account.host}
                </span>
              </div>
              <button
                type="button"
                aria-label="Remove account"
                disabled={remove.isPending}
                onClick={() => remove.mutate(account.id)}
                className="text-muted-foreground hover:text-destructive rounded-full p-2 transition-colors"
              >
                <Trash2Icon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddAccountForm />
    </div>
  );
}

function AddAccountForm() {
  const queryClient = useQueryClient();

  const add = useMutation({
    mutationFn: async (value: {
      preset: string;
      host: string;
      username: string;
      password: string;
    }) => {
      const preset = getPreset(value.preset);
      const result = await mailCommands.addMailAccount({
        label: null,
        host: preset.id === "custom" ? value.host : preset.host,
        port: preset.port,
        username: value.username,
        password: value.password,
      });
      if (result.status === "error") throw new Error(result.error);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: MAIL_ACCOUNTS_QUERY_KEY }),
  });

  const form = useForm({
    defaultValues: { preset: "gmail", host: "", username: "", password: "" },
    onSubmit: async ({ value, formApi }) => {
      await add.mutateAsync(value);
      formApi.reset();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <h3 className="text-sm font-medium">
        <Trans>Add an account</Trans>
      </h3>

      <form.Field name="preset">
        {(field) => (
          <div className="flex flex-wrap gap-2">
            {MAIL_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => field.handleChange(preset.id)}
                className={cn([
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  field.state.value === preset.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                ])}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.preset}>
        {(presetId) => {
          const preset = getPreset(presetId);
          return (
            <div className="flex flex-col gap-3">
              {preset.id === "custom" && (
                <form.Field name="host">
                  {(field) => (
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="imap.example.com"
                      autoComplete="off"
                    />
                  )}
                </form.Field>
              )}
              <form.Field name="username">
                {(field) => (
                  <Input
                    type="email"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="off"
                  />
                )}
              </form.Field>
              <form.Field name="password">
                {(field) => (
                  <Input
                    type="password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="App password"
                    autoComplete="off"
                  />
                )}
              </form.Field>
              {preset.helpText && (
                <p className="text-muted-foreground text-xs">
                  {preset.helpText}{" "}
                  {preset.helpUrl && (
                    <button
                      type="button"
                      onClick={async () => {
                        await openerCommands.openUrl(preset.helpUrl!, null);
                      }}
                      className="underline"
                    >
                      <Trans>Open</Trans>
                    </button>
                  )}
                </p>
              )}
            </div>
          );
        }}
      </form.Subscribe>

      {add.isError && (
        <p className="text-destructive text-sm">
          {add.error instanceof Error ? add.error.message : String(add.error)}
        </p>
      )}

      <form.Subscribe
        selector={(state) =>
          state.values.username.length > 0 && state.values.password.length > 0
        }
      >
        {(ready) => (
          <Button
            type="submit"
            disabled={!ready || add.isPending}
            className="w-fit rounded-full"
          >
            {add.isPending ? <Trans>Checking…</Trans> : <Trans>Connect</Trans>}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
