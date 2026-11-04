import { format } from "date-fns";

import { id } from "~/shared/utils";
import { type Tab, useTabs } from "~/store/zustand/tabs";

export const DAILY_DATE_FORMAT = "yyyy-MM-dd";

export function todayKey() {
  return format(new Date(), DAILY_DATE_FORMAT);
}

function dailyTab(date: string, slotId = id()): Tab {
  return {
    type: "daily_summary",
    id: date,
    state: { activeTab: null },
    active: true,
    slotId,
    pinned: false,
  };
}

export function openDailyTab(date: string = todayKey()) {
  const { tabs, select } = useTabs.getState();
  const existing = tabs.find(
    (tab) => tab.type === "daily_summary" && tab.id === date,
  );
  if (existing) {
    select(existing);
    return;
  }

  const next = dailyTab(date);
  useTabs.setState({
    tabs: [...tabs.map((tab) => ({ ...tab, active: false })), next],
    currentTab: next,
  });
}

// Stepping through days replaces the current tab instead of piling up tabs.
export function showDailyDate(current: Tab, date: string) {
  const { tabs } = useTabs.getState();
  const existing = tabs.find(
    (tab) => tab.type === "daily_summary" && tab.id === date,
  );
  if (existing) {
    useTabs.getState().select(existing);
    return;
  }

  const next = dailyTab(date, current.slotId);
  useTabs.setState({
    tabs: tabs.map((tab) => (tab.slotId === current.slotId ? next : tab)),
    currentTab: next,
  });
}
