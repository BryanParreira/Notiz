import { cn } from "@notiz/utils";

import { CalendarNav } from "./calendar";
import { ContactsNav } from "./contacts";
import { SidebarFolders } from "./folders";
import { SidebarFooter, SidebarNav } from "./nav";
import { SettingsNav } from "./settings";
import { TemplatesNav } from "./templates";

import { useTabs } from "~/store/zustand/tabs";

export function LeftSidebar(
  _props: {
    showIgnoredTimelineEvents?: boolean;
    onShowIgnoredTimelineEventsChange?: (showIgnored: boolean) => void;
  } = {},
) {
  const currentTab = useTabs((state) => state.currentTab);

  const isSettingsMode = currentTab?.type === "settings";
  const isCalendarMode = currentTab?.type === "calendar";
  const isContactsMode = currentTab?.type === "contacts";
  const isTemplatesMode = currentTab?.type === "templates";
  const isSpecialMode =
    isSettingsMode || isCalendarMode || isContactsMode || isTemplatesMode;
  const isTimelineSidebarLayout = !isSpecialMode;

  return (
    <div
      className={cn([
        "flex h-full w-full shrink-0 flex-col gap-1 overflow-hidden",
        isTimelineSidebarLayout ? "pt-0" : "pt-11",
      ])}
    >
      {isTimelineSidebarLayout && (
        <>
          <div data-tauri-drag-region className="h-12 shrink-0" />
          <SidebarNav />
        </>
      )}
      <div className="flex flex-1 flex-col gap-1 overflow-hidden">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {isSettingsMode ? (
            <SettingsNav />
          ) : isCalendarMode ? (
            <CalendarNav />
          ) : isContactsMode ? (
            <ContactsNav />
          ) : isTemplatesMode ? (
            <TemplatesNav />
          ) : (
            <SidebarFolders />
          )}
        </div>
      </div>
      {isTimelineSidebarLayout && <SidebarFooter />}
    </div>
  );
}
