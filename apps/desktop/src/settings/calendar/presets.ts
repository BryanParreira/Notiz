export type CalendarLinkPreset = {
  id: string;
  label: string;
  steps: string;
  helpUrl?: string;
  placeholder: string;
};

export const CALENDAR_LINK_PRESETS: CalendarLinkPreset[] = [
  {
    id: "google",
    label: "Google Calendar",
    steps:
      "In Google Calendar open Settings, pick your calendar, then Integrate calendar and copy the Secret address in iCal format.",
    helpUrl: "https://calendar.google.com/calendar/u/0/r/settings",
    placeholder: "https://calendar.google.com/calendar/ical/.../basic.ics",
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    steps:
      "In Outlook on the web open Settings, Calendar, Shared calendars. Under Publish a calendar choose your calendar, set Can view all details, publish, and copy the ICS link.",
    helpUrl:
      "https://outlook.live.com/calendar/0/options/calendar/SharedCalendars",
    placeholder: "https://outlook.office365.com/owa/calendar/.../calendar.ics",
  },
  {
    id: "icloud",
    label: "iCloud Calendar",
    steps:
      "In the Calendar app click the share icon next to a calendar, turn on Public Calendar, and copy the link.",
    placeholder: "webcal://p01-caldav.icloud.com/published/2/...",
  },
  {
    id: "other",
    label: "Other (.ics link)",
    steps:
      "Paste any private calendar link that ends in .ics or starts with webcal://.",
    placeholder: "https://example.com/calendar.ics",
  },
];

export function getCalendarPreset(id: string): CalendarLinkPreset {
  return (
    CALENDAR_LINK_PRESETS.find((preset) => preset.id === id) ??
    CALENDAR_LINK_PRESETS[0]
  );
}
