// Pacific-day math for the frontend. Mirrors getPacificDayWindow in
// supabase/functions/_shared/vibes-scoring.ts so chart filters anchor to the
// same Pacific calendar grid the aggregator buckets posts on. Without this,
// useVibesHistory used UTC midnight — a lucky alignment that worked only
// because period_start happens to be 07:00 UTC during PDT.

const PACIFIC_TIMEZONE = "America/Los_Angeles";

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function lookupPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((entry) => entry.type === type)?.value;
  if (!value) throw new Error(`Missing ${type} part`);
  return Number(value);
}

function getPacificDateLabel(date: Date): string {
  const parts = getPartsFormatter(PACIFIC_TIMEZONE).formatToParts(date);
  const y = lookupPart(parts, "year");
  const m = lookupPart(parts, "month");
  const d = lookupPart(parts, "day");
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDaysToDateLabel(label: string, days: number): string {
  const [y, m, d] = label.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getPartsFormatter(timeZone).formatToParts(date);
  const asUtc = Date.UTC(
    lookupPart(parts, "year"),
    lookupPart(parts, "month") - 1,
    lookupPart(parts, "day"),
    lookupPart(parts, "hour"),
    lookupPart(parts, "minute"),
    lookupPart(parts, "second"),
  );
  return asUtc - date.getTime();
}

function getUtcInstantForPacificMidnight(label: string): Date {
  const [y, m, d] = label.split("-").map(Number);
  const utcBase = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  let guess = utcBase;
  for (let i = 0; i < 4; i++) {
    const offsetMs = getTimeZoneOffsetMs(new Date(guess), PACIFIC_TIMEZONE);
    const next = utcBase - offsetMs;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** UTC ISO timestamp for the start of the Pacific day that began `daysBack`
 * calendar days before `now`. Pass 6 to fetch a 7-day window inclusive,
 * 29 for a 30-day window. */
export function getPacificDayWindowSince(daysBack: number, now: Date = new Date()): string {
  const todayLabel = getPacificDateLabel(now);
  const targetLabel = addDaysToDateLabel(todayLabel, -daysBack);
  return getUtcInstantForPacificMidnight(targetLabel).toISOString();
}
