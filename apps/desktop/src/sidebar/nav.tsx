import { Trans } from "@lingui/react/macro";
import {
  CalendarDaysIcon,
  FileStackIcon,
  HomeIcon,
  LockIcon,
  MailIcon,
  MessageCircleIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@notiz/utils";

import { useShell } from "~/contexts/shell";
import { type Tab, useTabs } from "~/store/zustand/tabs";

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
  const { chat } = useShell();

  return (
    <nav className="flex flex-col gap-0.5 px-2">
      <NavButton
        icon={HomeIcon}
        label={<Trans>Home</Trans>}
        active={currentType === "empty"}
        onClick={() => openCurrent({ type: "empty" })}
      />
      <NavButton
        icon={MessageCircleIcon}
        label={<Trans>Chat</Trans>}
        active={currentType === "chat"}
        onClick={() => {
          chat.sendEvent({ type: "CLOSE" });
          openNew({ type: "chat" });
        }}
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

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn([
        "rounded-lg p-2 transition-colors",
        active
          ? "bg-sidebar-accent text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      ])}
    >
      {children}
    </button>
  );
}

export function SidebarFooter() {
  const currentTab = useTabs((state) => state.currentTab);
  const openNew = useTabs((state) => state.openNew);

  const isType = (type: Tab["type"]) => currentTab?.type === type;

  return (
    <div className="flex flex-col gap-3 px-3 pt-2 pb-3">
      <div className="flex items-center gap-1">
        <IconButton
          label="Templates"
          active={isType("templates")}
          onClick={() => openNew({ type: "templates", state: null })}
        >
          <FileStackIcon size={16} />
        </IconButton>
        <IconButton
          label="People"
          active={isType("contacts")}
          onClick={() => openNew({ type: "contacts", state: null })}
        >
          <UsersIcon size={16} />
        </IconButton>
      </div>

      <div
        className={cn([
          "border-border flex items-center justify-between gap-2 rounded-full border p-1 pl-3",
        ])}
        title="Everything stays on this device"
      >
        <span
          aria-label="Private, on this device"
          className="text-muted-foreground flex shrink-0 items-center pl-0.5"
        >
          <LockIcon size={14} className="text-live" />
        </span>
        <button
          type="button"
          onClick={() => openNew({ type: "settings", state: { tab: "app" } })}
          className="bg-foreground text-background flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
        >
          <SettingsIcon size={13} />
          <Trans>Settings</Trans>
        </button>
      </div>
    </div>
  );
}
