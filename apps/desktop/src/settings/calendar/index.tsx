import { Trans } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDaysIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";

import { commands as calendarCommands } from "@notiz/plugin-calendar";
import { commands as openerCommands } from "@notiz/plugin-opener2";
import { Button } from "@notiz/ui/components/ui/button";
import { Input } from "@notiz/ui/components/ui/input";
import { cn } from "@notiz/utils";

import { CALENDAR_LINK_PRESETS, getCalendarPreset } from "./presets";

import { CONNECTIONS_QUERY_KEY } from "~/auth/useConnections";
import { SettingsPageTitle } from "~/settings/page-title";
import { useTabs } from "~/store/zustand/tabs";

const ACCOUNTS_KEY = ["calendar-accounts"] as const;

function useCalendarAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: async () => {
      const result = await calendarCommands.listAccounts();
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
  });
}

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google (signed in)",
  outlook: "Outlook (signed in)",
  ics: "Calendar link",
};

export function SettingsCalendar() {
  const { data: accounts = [] } = useCalendarAccounts();
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY }),
    ]);

  const remove = useMutation({
    mutationFn: async (account: {
      provider: Parameters<typeof calendarCommands.disconnectAccount>[0];
      connection_id: string;
    }) => {
      const result = await calendarCommands.disconnectAccount(
        account.provider,
        account.connection_id,
      );
      if (result.status === "error") throw new Error(result.error);
    },
    onSuccess: refresh,
  });

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <SettingsPageTitle title={<Trans>Calendars</Trans>} />
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            <Trans>
              Add a calendar with its private link. Notiz fetches it directly
              from your calendar provider on this device and keeps the link in
              your Keychain. It is read-only, with no sign-in and no Notiz
              server. Apple Calendar on this Mac works without any link.
            </Trans>
          </span>
        </p>
      </div>

      {accounts.length > 0 && (
        <ul className="border-border divide-border divide-y rounded-2xl border">
          {accounts.map((account) => (
            <li
              key={account.connection_id}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              <CalendarDaysIcon className="text-muted-foreground size-4 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{account.label}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {PROVIDER_LABELS[account.provider] ?? account.provider}
                </span>
              </div>
              <button
                type="button"
                aria-label="Remove calendar"
                disabled={remove.isPending}
                onClick={() => remove.mutate(account)}
                className="text-muted-foreground hover:text-destructive rounded-full p-2 transition-colors"
              >
                <Trash2Icon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddCalendarLinkForm onAdded={refresh} />
    </div>
  );
}

export function AddCalendarLinkForm({
  onAdded,
  compact = false,
}: {
  onAdded?: () => void | Promise<unknown>;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const openNew = useTabs((state) => state.openNew);

  const add = useMutation({
    mutationFn: async (value: { url: string; label: string }) => {
      const result = await calendarCommands.addIcsAccount(
        value.url,
        value.label.trim() || null,
      );
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      await queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      await onAdded?.();
    },
  });

  const form = useForm({
    defaultValues: { preset: "google", url: "", label: "" },
    onSubmit: async ({ value, formApi }) => {
      await add.mutateAsync({ url: value.url, label: value.label });
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
        <Trans>Add a calendar</Trans>
      </h3>

      <form.Field name="preset">
        {(field) => (
          <div className="flex flex-wrap gap-2">
            {CALENDAR_LINK_PRESETS.map((preset) => (
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
          const preset = getCalendarPreset(presetId);
          return (
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-xs">
                {preset.steps}{" "}
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
              <form.Field name="url">
                {(field) => (
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={preset.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </form.Field>
              <form.Field name="label">
                {(field) => (
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Name (optional)"
                    autoComplete="off"
                  />
                )}
              </form.Field>
            </div>
          );
        }}
      </form.Subscribe>

      {add.isError && (
        <p className="text-destructive text-sm">
          {add.error instanceof Error ? add.error.message : String(add.error)}
        </p>
      )}
      {add.isSuccess && !add.isPending && (
        <p className="text-muted-foreground flex items-center gap-3 text-sm">
          <Trans>Calendar added.</Trans>
          {!compact && (
            <button
              type="button"
              onClick={() => openNew({ type: "calendar" })}
              className="text-primary underline"
            >
              <Trans>Open calendar</Trans>
            </button>
          )}
        </p>
      )}

      <form.Subscribe selector={(state) => state.values.url.trim().length > 0}>
        {(ready) => (
          <Button
            type="submit"
            disabled={!ready || add.isPending}
            className="w-fit rounded-full"
          >
            {add.isPending ? (
              <Trans>Checking…</Trans>
            ) : (
              <Trans>Add calendar</Trans>
            )}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
