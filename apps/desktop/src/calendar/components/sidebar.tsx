import { Trans, useLingui } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";
import { useMemo } from "react";

import { Button } from "@notiz/ui/components/ui/button";

import { AppleCalendarSelection } from "./apple/calendar-selection";
import { TroubleShootingLink } from "./apple/permission";
import { OAuthProviderContent } from "./oauth/provider-content";
import { PROVIDERS, type CalendarProvider } from "./shared";

import { useBillingAccess } from "~/auth/billing";
import { useConnections } from "~/auth/useConnections";
import { AddCalendarLinkForm } from "~/settings/calendar";
import { usePermission } from "~/shared/hooks/usePermissions";

function ProviderIcon({ provider }: { provider: CalendarProvider }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      {provider.icon}
    </span>
  );
}

export function CalendarSidebarContent({
  returnTo = "calendar",
}: {
  returnTo?: string;
}) {
  const isMacos = platform() === "macos";
  const { isPaid } = useBillingAccess();
  const { data: connections } = useConnections(isPaid);

  // Calendars connected through a link (or an earlier sign-in) are listed here.
  // Nothing is offered for sign-in providers that have no connection yet; new
  // calendars are added with a link below.
  const connected = useMemo(
    () =>
      PROVIDERS.filter(
        (provider) =>
          provider.nangoIntegrationId &&
          connections?.some(
            (connection) =>
              connection.integration_id === provider.nangoIntegrationId,
          ),
      ),
    [connections],
  );

  return (
    <div className="flex flex-col gap-6 pt-1 pb-6">
      {isMacos && <AppleCalendarSection />}

      {connected.map((provider) => (
        <section key={provider.id} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ProviderIcon provider={provider} />
            <h3 className="text-sm font-medium">
              {provider.id === "ics" ? (
                <Trans>Calendar links</Trans>
              ) : (
                provider.displayName
              )}
            </h3>
          </div>
          <OAuthProviderContent config={provider} returnTo={returnTo} />
        </section>
      ))}

      <section className="border-border border-t pt-5">
        <AddCalendarLinkForm compact />
      </section>
    </div>
  );
}

function AppleCalendarSection() {
  const { t } = useLingui();
  const calendar = usePermission("calendar");
  const apple = PROVIDERS.find((provider) => provider.id === "apple");
  const isAuthorized = calendar.status === "authorized";
  const isDenied = calendar.status === "denied";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {apple && <ProviderIcon provider={apple} />}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          {t`Apple Calendar`}
        </h3>
        {isAuthorized && (
          <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
            <span className="bg-live size-1.5 rounded-full" />
            <Trans>Connected</Trans>
          </span>
        )}
      </div>

      {isAuthorized ? (
        <AppleCalendarSelection
          leftAction={
            <TroubleShootingLink
              isPending={calendar.isPending}
              onOpen={calendar.open}
              onRequest={calendar.request}
              onReset={calendar.reset}
            />
          }
        />
      ) : (
        <div className="bg-muted/50 flex flex-col items-start gap-3 rounded-xl p-3">
          <p className="text-muted-foreground text-xs leading-relaxed">
            {isDenied ? (
              <Trans>
                Calendar access is turned off. Turn it on in System Settings to
                see your events here.
              </Trans>
            ) : (
              <Trans>
                Allow access to show the calendars on this Mac next to your
                notes. Nothing leaves this device.
              </Trans>
            )}
          </p>
          <Button
            size="sm"
            className="rounded-full"
            disabled={calendar.isPending}
            onClick={isDenied ? calendar.open : calendar.request}
          >
            {isDenied ? (
              <Trans>Open System Settings</Trans>
            ) : (
              <Trans>Allow access</Trans>
            )}
          </Button>
          <TroubleShootingLink
            isPending={calendar.isPending}
            onOpen={calendar.open}
            onRequest={calendar.request}
            onReset={calendar.reset}
          />
        </div>
      )}
    </section>
  );
}
