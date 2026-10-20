import { Trans } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";
import { useCallback, useMemo, useState } from "react";

import type { ConnectionItem } from "@notiz/api-client";

import { OnboardingButton } from "./shared";

import { useConnections } from "~/auth/useConnections";
import { useAppleCalendarSelection } from "~/calendar/components/apple/calendar-selection";
import { TroubleShootingLink } from "~/calendar/components/apple/permission";
import {
  type CalendarGroup,
  CalendarSelection,
} from "~/calendar/components/calendar-selection";
import { SyncProvider, useSync } from "~/calendar/components/context";
import { useOAuthCalendarSelection } from "~/calendar/components/oauth/calendar-selection";
import { ReconnectRequiredIndicator } from "~/calendar/components/oauth/status";
import { PROVIDERS } from "~/calendar/components/shared";
import { useEnabledCalendars } from "~/calendar/hooks";
import { AddCalendarLinkForm } from "~/settings/calendar";
import { useMountEffect } from "~/shared/hooks/useMountEffect";
import { usePermission } from "~/shared/hooks/usePermissions";
import { openIntegrationUrl } from "~/shared/integration";

const GOOGLE_PROVIDER = PROVIDERS.find((provider) => provider.id === "google");
const OUTLOOK_PROVIDER = PROVIDERS.find(
  (provider) => provider.id === "outlook",
);

function getCalendarSelectionKey(groups: CalendarGroup[]) {
  return groups.length === 0
    ? "empty"
    : groups
        .map((group) => `${group.sourceName}:${group.calendars.length}`)
        .join("|");
}

function AppleCalendarList() {
  const { scheduleSync } = useSync();
  const { groups, handleRefresh, handleToggle, isLoading } =
    useAppleCalendarSelection();

  useMountEffect(() => {
    scheduleSync();
  });

  return (
    <CalendarSelection
      key={getCalendarSelectionKey(groups)}
      groups={groups}
      onToggle={handleToggle}
      onRefresh={handleRefresh}
      isLoading={isLoading}
      disableHoverTone
      className="border-border/45 bg-card/28 rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_24px_-20px_rgba(87,83,78,0.35)] backdrop-blur-md backdrop-saturate-150"
    />
  );
}

function AppleCalendarProvider({
  isAuthorized,
  isPending,
  onRequest,
  onTroubleshoot,
}: {
  isAuthorized: boolean;
  isPending: boolean;
  onRequest: () => void;
  onTroubleshoot: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {isAuthorized ? (
        <AppleCalendarList />
      ) : (
        <OnboardingButton
          onClick={() => {
            onTroubleshoot();
            onRequest();
          }}
          disabled={isPending}
          className="border-border bg-card text-foreground hover:bg-accent flex h-full w-full items-center justify-center gap-3 border px-12 shadow-[0_2px_6px_rgba(87,83,78,0.08),0_10px_18px_-10px_rgba(87,83,78,0.22)] transition-all duration-150"
        >
          <img
            src="/assets/apple-calendar.png"
            alt=""
            aria-hidden="true"
            className="size-6 rounded-[4px] object-cover"
          />
          Apple
        </OnboardingButton>
      )}
    </div>
  );
}

function GoogleCalendarConnectedContent({
  providerConnections,
}: {
  providerConnections: ConnectionItem[];
}) {
  const { scheduleSync } = useSync();
  const {
    groups,
    connectionSourceMap,
    handleRefresh,
    handleToggle,
    isLoading,
  } = useOAuthCalendarSelection(GOOGLE_PROVIDER!);
  const reconnectRequiredConnections = useMemo(
    () =>
      providerConnections.filter(
        (connection) => connection.status === "reconnect_required",
      ),
    [providerConnections],
  );
  const groupsWithMenus = useMemo(
    () =>
      addIntegrationMenus({
        groups,
        connections: providerConnections,
        connectionSourceMap,
        provider: GOOGLE_PROVIDER!,
      }),
    [connectionSourceMap, groups, providerConnections],
  );

  useMountEffect(() => {
    scheduleSync();
  });

  return (
    <div className="flex flex-col gap-3">
      {reconnectRequiredConnections.length > 0 && (
        <div className="flex items-start gap-2 text-sm text-amber-700">
          <span className="pt-1">
            <ReconnectRequiredIndicator />
          </span>
          <p>
            Some Google Calendar accounts need attention. Open the account menu
            to reconnect or disconnect them.
          </p>
        </div>
      )}

      <CalendarSelection
        key={getCalendarSelectionKey(groupsWithMenus)}
        groups={groupsWithMenus}
        onToggle={handleToggle}
        onRefresh={handleRefresh}
        isLoading={isLoading}
        disableHoverTone
        className="border-border/45 bg-card/28 rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_24px_-20px_rgba(87,83,78,0.35)] backdrop-blur-md backdrop-saturate-150"
      />

      <OnboardingButton
        type="button"
        onClick={() =>
          void openIntegrationUrl(
            GOOGLE_PROVIDER?.nangoIntegrationId,
            undefined,
            "connect",
          )
        }
        className="border-border bg-card text-foreground hover:bg-accent flex items-center gap-3 border shadow-[0_2px_6px_rgba(87,83,78,0.08),0_10px_18px_-10px_rgba(87,83,78,0.22)]"
      >
        {GOOGLE_PROVIDER?.icon}
        Add another account
      </OnboardingButton>
    </div>
  );
}

function addIntegrationMenus({
  groups,
  connections,
  connectionSourceMap,
  provider,
}: {
  groups: CalendarGroup[];
  connections: ConnectionItem[];
  connectionSourceMap: Map<string, string>;
  provider: (typeof PROVIDERS)[number];
}) {
  return groups.map((group) => {
    const connection = connections.find(
      (item) =>
        item.connection_id === group.id ||
        connectionSourceMap.get(item.connection_id) === group.sourceName,
    );

    if (!connection) return group;

    return {
      ...group,
      menuItems: [
        {
          id: `reconnect-${connection.connection_id}`,
          text: "Reconnect",
          action: () =>
            void openIntegrationUrl(
              provider.nangoIntegrationId,
              connection.connection_id,
              "reconnect",
            ),
        },
        {
          id: `disconnect-${connection.connection_id}`,
          text: "Disconnect",
          action: () =>
            void openIntegrationUrl(
              provider.nangoIntegrationId,
              connection.connection_id,
              "disconnect",
            ),
        },
      ],
    };
  });
}

function OutlookCalendarConnectedContent({
  providerConnections,
}: {
  providerConnections: ConnectionItem[];
}) {
  const { scheduleSync } = useSync();
  const {
    groups,
    connectionSourceMap,
    handleRefresh,
    handleToggle,
    isLoading,
  } = useOAuthCalendarSelection(OUTLOOK_PROVIDER!);
  const reconnectRequiredConnections = useMemo(
    () =>
      providerConnections.filter(
        (connection) => connection.status === "reconnect_required",
      ),
    [providerConnections],
  );
  const groupsWithMenus = useMemo(
    () =>
      addIntegrationMenus({
        groups,
        connections: providerConnections,
        connectionSourceMap,
        provider: OUTLOOK_PROVIDER!,
      }),
    [connectionSourceMap, groups, providerConnections],
  );

  useMountEffect(() => {
    scheduleSync();
  });

  return (
    <div className="flex flex-col gap-3">
      {reconnectRequiredConnections.length > 0 && (
        <div className="flex items-start gap-2 text-sm text-amber-700">
          <span className="pt-1">
            <ReconnectRequiredIndicator />
          </span>
          <p>
            Some Outlook accounts need attention. Open the account menu to
            reconnect or disconnect them.
          </p>
        </div>
      )}

      <CalendarSelection
        key={getCalendarSelectionKey(groupsWithMenus)}
        groups={groupsWithMenus}
        onToggle={handleToggle}
        onRefresh={handleRefresh}
        isLoading={isLoading}
        disableHoverTone
        className="border-border/45 bg-card/28 rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_24px_-20px_rgba(87,83,78,0.35)] backdrop-blur-md backdrop-saturate-150"
      />

      <OnboardingButton
        type="button"
        onClick={() =>
          void openIntegrationUrl(
            OUTLOOK_PROVIDER?.nangoIntegrationId,
            undefined,
            "connect",
          )
        }
        className="border-border bg-card text-foreground hover:bg-accent flex items-center gap-3 border shadow-[0_2px_6px_rgba(87,83,78,0.08),0_10px_18px_-10px_rgba(87,83,78,0.22)]"
      >
        {OUTLOOK_PROVIDER?.icon}
        Add another account
      </OnboardingButton>
    </div>
  );
}

function OutlookCalendarProvider() {
  const { data: connections, isPending, isError } = useConnections();
  const providerConnections = useMemo(
    () =>
      connections?.filter(
        (connection) =>
          connection.integration_id === OUTLOOK_PROVIDER?.nangoIntegrationId,
      ) ?? [],
    [connections],
  );

  const handleConnect = useCallback(() => {
    void openIntegrationUrl(
      OUTLOOK_PROVIDER?.nangoIntegrationId,
      undefined,
      "connect",
    );
  }, []);

  if (!OUTLOOK_PROVIDER) {
    return null;
  }

  if (isError) {
    return (
      <p className="text-sm text-red-600">
        <Trans>Failed to load Outlook Calendar</Trans>
      </p>
    );
  }

  if (providerConnections.length > 0) {
    return (
      <OutlookCalendarConnectedContent
        providerConnections={providerConnections}
      />
    );
  }

  return (
    <OnboardingButton
      onClick={handleConnect}
      disabled={isPending}
      className="border-border bg-card text-foreground hover:bg-accent disabled:hover:bg-card flex items-center gap-3 border shadow-[0_2px_6px_rgba(87,83,78,0.08),0_10px_18px_-10px_rgba(87,83,78,0.22)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {OUTLOOK_PROVIDER.icon}
      <Trans>Connect Outlook</Trans>
    </OnboardingButton>
  );
}

function GoogleCalendarProvider() {
  const { data: connections, isPending, isError } = useConnections();
  const providerConnections = useMemo(
    () =>
      connections?.filter(
        (connection) =>
          connection.integration_id === GOOGLE_PROVIDER?.nangoIntegrationId,
      ) ?? [],
    [connections],
  );

  const handleConnect = useCallback(() => {
    void openIntegrationUrl(
      GOOGLE_PROVIDER?.nangoIntegrationId,
      undefined,
      "connect",
    );
  }, []);

  if (!GOOGLE_PROVIDER) {
    return null;
  }

  if (isError) {
    return (
      <p className="text-sm text-red-600">
        <Trans>Failed to load Google Calendar</Trans>
      </p>
    );
  }

  if (providerConnections.length > 0) {
    return (
      <GoogleCalendarConnectedContent
        providerConnections={providerConnections}
      />
    );
  }

  return (
    <div className="flex h-full items-center gap-3">
      <OnboardingButton
        onClick={handleConnect}
        disabled={isPending}
        className="border-border bg-card text-foreground hover:bg-accent disabled:hover:bg-card flex items-center gap-3 border shadow-[0_2px_6px_rgba(87,83,78,0.08),0_10px_18px_-10px_rgba(87,83,78,0.22)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {GOOGLE_PROVIDER.icon}
        <Trans>Connect Google Calendar</Trans>
      </OnboardingButton>
    </div>
  );
}

function CalendarLinkOption() {
  const { scheduleSync } = useSync();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-muted-foreground hover:text-foreground w-fit text-sm underline underline-offset-4 transition-colors"
      >
        {open ? (
          <Trans>Hide calendar link</Trans>
        ) : (
          <Trans>Add Google, Outlook or iCloud with a calendar link</Trans>
        )}
      </button>
      {open && <AddCalendarLinkForm onAdded={() => scheduleSync()} />}
    </div>
  );
}

function CalendarSectionContent({ onContinue }: { onContinue: () => void }) {
  const isMacos = platform() === "macos";
  const calendar = usePermission("calendar");
  const isAuthorized = calendar.status === "authorized";
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const enabledCalendars = useEnabledCalendars();
  const hasConnectedCalendar = enabledCalendars.length > 0;

  const hasAnyConnected = hasConnectedCalendar || isAuthorized;

  return (
    <div className="flex flex-col gap-4">
      {hasAnyConnected ? (
        <>
          {isMacos && (
            <AppleCalendarProvider
              isAuthorized={isAuthorized}
              isPending={calendar.isPending}
              onRequest={calendar.request}
              onTroubleshoot={() => setShowTroubleshooting(true)}
            />
          )}
          <div className="flex flex-wrap items-center gap-4">
            <GoogleCalendarProvider />
            <OutlookCalendarProvider />
          </div>
          <CalendarLinkOption />
          {hasConnectedCalendar && (
            <OnboardingButton onClick={onContinue}>
              <Trans>Continue</Trans>
            </OnboardingButton>
          )}
        </>
      ) : (
        // for the case when the user has no connected calendars yet we show the calendars in a row
        <div className="flex flex-wrap items-stretch gap-4">
          {isMacos && (
            <AppleCalendarProvider
              isAuthorized={isAuthorized}
              isPending={calendar.isPending}
              onRequest={calendar.request}
              onTroubleshoot={() => setShowTroubleshooting(true)}
            />
          )}

          <GoogleCalendarProvider />
          <OutlookCalendarProvider />
        </div>
      )}

      {!hasAnyConnected && <CalendarLinkOption />}

      {showTroubleshooting && !isAuthorized && (
        <TroubleShootingLink
          onRequest={calendar.request}
          onReset={calendar.reset}
          onOpen={calendar.open}
          isPending={calendar.isPending}
          className="text-muted-foreground text-sm"
        />
      )}
    </div>
  );
}

export function CalendarSection({ onContinue }: { onContinue: () => void }) {
  return (
    <SyncProvider>
      <CalendarSectionContent onContinue={onContinue} />
    </SyncProvider>
  );
}
