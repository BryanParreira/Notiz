import { DayHub } from "./day-hub";
import { showDailyDate } from "./open-daily-tab";

import { type Tab } from "~/store/zustand/tabs";

export function TabContentDaily({
  tab,
}: {
  tab: Extract<Tab, { type: "daily_summary" }>;
}) {
  return (
    <DayHub date={tab.id} onNavigate={(date) => showDailyDate(tab, date)} />
  );
}
