const PALETTE = [
  "#3b82f6",
  "#e11d74",
  "#16a34a",
  "#f59e0b",
  "#8b5cf6",
  "#0ea5a4",
  "#ef4444",
  "#6366f1",
];

const PLACEHOLDER_COLORS = new Set(["", "#888", "#888888"]);

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Calendars from some providers arrive without a colour; each one still gets
// its own stable colour so events never fall back to a single shared default.
export function resolveCalendarColor(
  color: string | null | undefined,
  key: string | null | undefined,
) {
  const value = (color ?? "").trim();
  if (!PLACEHOLDER_COLORS.has(value.toLowerCase())) return value;
  return PALETTE[hash(key || "default") % PALETTE.length];
}
