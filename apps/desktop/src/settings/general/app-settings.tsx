import { Trans } from "@lingui/react/macro";
import { type ReactNode, useId } from "react";

import { Switch } from "@notiz/ui/components/ui/switch";

import { QuickCaptureSetting } from "~/capture/hotkey-setting";

interface SettingItem {
  value: boolean;
  onChange: (value: boolean) => void;
}

interface AppSettingsViewProps {
  autostart: SettingItem;
  autoStartScheduledMeetings: SettingItem;
  autoStopMeetings: SettingItem;
  floatingBar: SettingItem;
  liveCaption: SettingItem;
  showAppInDock: SettingItem;
  showTrayIcon: SettingItem;
}

export function AppSettingsView({
  autostart,
  showAppInDock,
  showTrayIcon,
}: AppSettingsViewProps) {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="flex flex-col gap-4">
          <SettingRow
            title="Start Notiz at login"
            description="Always ready without manually launching."
            checked={autostart.value}
            onChange={autostart.onChange}
          />
          <SettingRow
            title="Show app in Dock"
            description="Show Notiz in the Dock and app switcher."
            checked={showAppInDock.value}
            onChange={showAppInDock.onChange}
          />
          <SettingRow
            title="Show tray icon"
            description="Keep Notiz available from the menu bar."
            checked={showTrayIcon.value}
            onChange={showTrayIcon.onChange}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-sans text-lg font-semibold">
          <Trans>Quick capture</Trans>
        </h2>
        <QuickCaptureSetting />
      </section>
    </div>
  );
}

export function SettingRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: ReactNode;
  description: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <h3 id={titleId} className="mb-1 text-sm font-medium">
          {title}
        </h3>
        <p id={descriptionId} className="text-muted-foreground text-xs">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      />
    </div>
  );
}
