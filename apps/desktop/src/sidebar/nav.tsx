import { Trans } from "@lingui/react/macro";
import {
  CalendarDaysIcon,
  HomeIcon,
  LockIcon,
  MailIcon,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@notiz/utils";

import { useTabs } from "~/store/zustand/tabs";

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof HomeIcon;
  label: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn([
        "flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
        "transition-colors duration-150",
        active
          ? "bg-sidebar-accent text-foreground font-medium"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      ])}
    >
      <Icon size={16} className="shrink-0" />
      {label}
    </button>
  );
}

export function SidebarNav() {
  const currentType = useTabs((state) => state.currentTab?.type);
  const openCurrent = useTabs((state) => state.openCurrent);
  const openNew = useTabs((state) => state.openNew);

  return (
    <nav className="flex flex-col gap-0.5 px-2">
      <NavButton
        icon={HomeIcon}
        label={<Trans>Home</Trans>}
        active={currentType === "empty"}
        onClick={() => openCurrent({ type: "empty" })}
      />
      <NavButton
        icon={MailIcon}
        label={<Trans>Inbox</Trans>}
        active={currentType === "inbox"}
        onClick={() => openNew({ type: "inbox" })}
      />
      <NavButton
        icon={CalendarDaysIcon}
        label={<Trans>Calendar</Trans>}
        active={currentType === "calendar"}
        onClick={() => openNew({ type: "calendar" })}
      />
    </nav>
  );
}

export function SidebarFooter() {
  const currentTab = useTabs((state) => state.currentTab);
  const openNew = useTabs((state) => state.openNew);

  return (
    <div className="flex flex-col gap-1 px-2 pt-2 pb-3">
      <NavButton
        icon={SettingsIcon}
        label={<Trans>Settings</Trans>}
        active={currentTab?.type === "settings"}
        onClick={() => openNew({ type: "settings", state: { tab: "app" } })}
      />
      <div
        className="text-muted-foreground flex items-center gap-1.5 px-3 pt-1 text-xs"
        title="Everything stays on this device"
      >
        <LockIcon
          size={11}
          aria-label="Private, on this device"
          className="text-primary shrink-0"
        />
        <Trans>Stored on this device</Trans>
      </div>
    </div>
  );
}
