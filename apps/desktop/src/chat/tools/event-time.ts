// Turns the words a person says ("tomorrow", "next friday", "oct 28", "3pm")
// into real dates. A small model cannot do this arithmetic reliably, so it only
// copies the user's words and this does the work.

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole weekday words only, so "month" is not read as "Mon".
const WEEKDAY =
  /\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/;
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Weeks run Monday to Sunday. "Friday" is the next Friday from today (today
// counts); "next Friday" is the Friday of the week after this one.
export function resolveDay(text: string, now = new Date()): Date | null {
  const t = text
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  const today = startOfDay(now);

  if (/\bday after tomorrow\b/.test(t)) return addDays(today, 2);
  if (/\b(tomorrow|tmrw|tmr)\b/.test(t)) return addDays(today, 1);
  if (/\b(today|tonight)\b/.test(t)) return today;

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const weekday = WEEKDAY.exec(t);
  if (weekday) {
    const index = WEEKDAY_INDEX[weekday[1].slice(0, 3)];

    if (/\bnext\b/.test(t)) {
      const daysToNextMonday = (8 - today.getDay()) % 7 || 7;
      const nextMonday = addDays(today, daysToNextMonday);
      return addDays(nextMonday, (index + 6) % 7);
    }

    return addDays(today, (index - today.getDay() + 7) % 7);
  }

  const monthDay =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/.exec(
      t,
    ) ??
    /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(
      t,
    );
  if (monthDay) {
    const monthText = MONTHS.includes(monthDay[1]) ? monthDay[1] : monthDay[2];
    const dayText = MONTHS.includes(monthDay[1]) ? monthDay[2] : monthDay[1];
    const date = new Date(
      today.getFullYear(),
      MONTHS.indexOf(monthText),
      Number(dayText),
    );
    // A date that has already passed this year means next year.
    return date.getTime() < today.getTime() - DAY_MS
      ? new Date(today.getFullYear() + 1, date.getMonth(), date.getDate())
      : date;
  }

  return null;
}

export function resolveTimeOfDay(
  text: string,
): { hours: number; minutes: number } | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;

  if (/\bnoon\b/.test(t)) return { hours: 12, minutes: 0 };
  if (/\bmidnight\b/.test(t)) return { hours: 0, minutes: 0 };

  const match = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?!\d)/.exec(t);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.[0];
  if (hours > 24 || minutes > 59) return null;

  if (meridiem === "p" && hours < 12) hours += 12;
  else if (meridiem === "a" && hours === 12) hours = 0;
  else if (!meridiem && !match[2] && hours >= 1 && hours <= 7) {
    // "at 3" in a diary almost always means the afternoon.
    hours += 12;
  }

  return hours === 24 ? { hours: 0, minutes } : { hours, minutes };
}
