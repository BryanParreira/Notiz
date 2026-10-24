import { lazy, Suspense } from "react";

import { TabContentNote } from "~/session";
import { type Tab } from "~/store/zustand/tabs";

// Notes open on launch, so they load with the app. Every other screen is
// fetched the first time its tab opens, which keeps startup light.
const TabContentCalendar = lazy(() =>
  import("~/calendar").then((m) => ({ default: m.TabContentCalendar })),
);
const TabContentChangelog = lazy(() =>
  import("~/changelog").then((m) => ({ default: m.TabContentChangelog })),
);
const TabContentChat = lazy(() =>
  import("~/chat/page").then((m) => ({ default: m.TabContentChat })),
);
const TabContentContact = lazy(() =>
  import("~/contacts").then((m) => ({ default: m.TabContentContact })),
);
const TabContentHuman = lazy(() =>
  import("~/contacts/humans").then((m) => ({ default: m.TabContentHuman })),
);
const TabContentEdit = lazy(() =>
  import("~/edit").then((m) => ({ default: m.TabContentEdit })),
);
const TabContentFolders = lazy(() =>
  import("~/folders").then((m) => ({ default: m.TabContentFolders })),
);
const TabContentInbox = lazy(() =>
  import("~/inbox").then((m) => ({ default: m.TabContentInbox })),
);
const TabContentOnboarding = lazy(() =>
  import("~/onboarding").then((m) => ({ default: m.TabContentOnboarding })),
);
const TabContentSettings = lazy(() =>
  import("~/settings").then((m) => ({ default: m.TabContentSettings })),
);
const TabContentTask = lazy(() =>
  import("~/task").then((m) => ({ default: m.TabContentTask })),
);
const TabContentTemplate = lazy(() =>
  import("~/templates").then((m) => ({ default: m.TabContentTemplate })),
);

export function MainTabContent({ tab }: { tab: Tab }) {
  if (tab.type === "sessions") {
    return <TabContentNote tab={tab} />;
  }

  return <Suspense fallback={null}>{renderLazyTab(tab)}</Suspense>;
}

function renderLazyTab(tab: Tab) {
  if (tab.type === "humans") {
    return <TabContentHuman tab={tab} />;
  }
  if (tab.type === "contacts") {
    return <TabContentContact tab={tab} />;
  }
  if (tab.type === "calendar") {
    return <TabContentCalendar />;
  }
  if (tab.type === "changelog") {
    return <TabContentChangelog tab={tab} />;
  }
  if (tab.type === "settings") {
    return <TabContentSettings tab={tab} />;
  }
  if (tab.type === "templates") {
    return <TabContentTemplate tab={tab} />;
  }
  if (tab.type === "onboarding") {
    return <TabContentOnboarding tab={tab} />;
  }
  if (tab.type === "edit") {
    return <TabContentEdit tab={tab} />;
  }
  if (tab.type === "chat") {
    return <TabContentChat />;
  }
  if (tab.type === "inbox") {
    return <TabContentInbox />;
  }
  if (tab.type === "folders") {
    return <TabContentFolders tab={tab} />;
  }
  if (tab.type === "task") {
    return <TabContentTask tab={tab} />;
  }
  return null;
}
