import { cn } from "@notiz/utils";

import { SettingsCalendar } from "./calendar";
import { SettingsEmail } from "./email";
import {
  SettingsApp,
  SettingsData,
  SettingsNotifications,
  SettingsPermissions,
} from "./general";
import { SettingsTodo } from "./todo";

import { StandardTabWrapper } from "~/shared/main";
import { type Tab } from "~/store/zustand/tabs";

export function TabContentSettings({
  tab,
}: {
  tab: Extract<Tab, { type: "settings" }>;
}) {
  return (
    <StandardTabWrapper>
      <SettingsView tab={tab} />
    </StandardTabWrapper>
  );
}

function SettingsView({ tab }: { tab: Extract<Tab, { type: "settings" }> }) {
  const activeTab = tab.state.tab ?? "app";

  const renderContent = () => {
    switch (activeTab) {
      case "app":
        return <SettingsApp />;
      case "data":
        return <SettingsData />;
      case "notifications":
        return <SettingsNotifications />;
      case "permissions":
        return <SettingsPermissions />;
      case "email":
        return <SettingsEmail />;
      case "calendar":
        return <SettingsCalendar />;
      case "todo":
        return <SettingsTodo />;
    }
  };

  return (
    <div
      data-settings-content
      className="bg-card dark:bg-accent flex w-full flex-1 flex-col overflow-hidden"
    >
      <div className="relative w-full flex-1 overflow-hidden">
        <div
          className={cn([
            "scroll-fade-y scrollbar-hide h-full w-full flex-1 overflow-y-auto p-6",
          ])}
        >
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
