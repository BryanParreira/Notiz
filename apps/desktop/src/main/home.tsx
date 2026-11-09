import { useState } from "react";

import { DayHub } from "~/daily/day-hub";
import { todayKey } from "~/daily/open-daily-tab";

export function Home() {
  const [date, setDate] = useState(todayKey);
  return <DayHub date={date} onNavigate={setDate} />;
}
