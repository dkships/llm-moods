export interface RumorEtaInput {
  eta_text?: string | null;
  eta_date?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
}

const MONTHS = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may", "may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
] as const;

const MONTH_LOOKUP = new Map<string, number>(
  MONTHS.flatMap(([long, short], index) => [
    [long, index],
    [short, index],
  ]),
);

const MONTH_PATTERN = MONTHS.map(([long, short]) => `${long}|${short}`).join("|");

function cleanEtaText(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 12));
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function startOfWeek(date: Date): Date {
  const out = utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMonday = (out.getUTCDay() + 6) % 7;
  out.setUTCDate(out.getUTCDate() - daysSinceMonday);
  return out;
}

function addMonths(date: Date, months: number): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(date);
}

function titleRaw(raw: string): string {
  const cleaned = raw
    .replace(/^~+/, "")
    .replace(/^(?:new\s+)?target(?:\s+is)?\s+/i, "")
    .replace(/^expected\s+/i, "")
    .trim();
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : raw;
}

function monthIndex(rawMonth: string): number | null {
  const lower = rawMonth.toLowerCase();
  return MONTH_LOOKUP.get(lower.slice(0, 3)) ?? MONTH_LOOKUP.get(lower) ?? null;
}

function yearForMonth(reference: Date, month: number, explicitYear?: string): number {
  if (explicitYear) return Number(explicitYear);
  const refYear = reference.getUTCFullYear();
  return month < reference.getUTCMonth() ? refYear + 1 : refYear;
}

function monthDateFromText(lower: string, reference: Date): Date | null {
  const match = lower.match(
    new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`, "i"),
  );
  if (!match) return null;
  const month = monthIndex(match[1]);
  const day = Number(match[2]);
  if (month === null || !Number.isInteger(day) || day < 1 || day > 31) return null;
  return utcDate(yearForMonth(reference, month, match[3]), month, day);
}

function monthWindowFromText(lower: string, reference: Date): string | null {
  const match = lower.match(new RegExp(`\\b(early|mid|late)[-\\s]+(${MONTH_PATTERN})\\b`, "i"));
  if (!match) return null;
  const month = monthIndex(match[2]);
  if (month === null) return null;
  const year = yearForMonth(reference, month);
  const label = match[1] === "mid" ? "Mid" : match[1][0].toUpperCase() + match[1].slice(1);
  return `${label}-${formatMonthYear(utcDate(year, month, 1))}`;
}

function monthOnlyFromText(lower: string, reference: Date): string | null {
  const match = lower.match(new RegExp(`\\b(?:in|into|during|through)\\s+(${MONTH_PATTERN})\\b`, "i"));
  if (!match) return null;
  const month = monthIndex(match[1]);
  if (month === null) return null;
  return formatMonthYear(utcDate(yearForMonth(reference, month), month, 1));
}

function quarterFromText(lower: string, reference: Date): string | null {
  const match = lower.match(/\bq([1-4])(?:\s*(\d{4}))?\b/i);
  if (!match) return null;
  return `Q${match[1]} ${match[2] ?? reference.getUTCFullYear()}`;
}

export function formatRumorEta(eta: RumorEtaInput): string | null {
  const raw = cleanEtaText(eta.eta_text);
  const etaDate = parseDate(eta.eta_date);
  const reference = parseDate(eta.last_seen_at) ?? parseDate(eta.first_seen_at) ?? etaDate;
  if (!raw) return etaDate ? formatDate(etaDate) : null;
  if (!reference) return titleRaw(raw);

  const lower = raw.toLowerCase();
  const explicitDate = monthDateFromText(lower, reference) ?? etaDate;

  if (lower.includes("week of") && explicitDate) {
    return `Week of ${formatDate(explicitDate)}`;
  }
  if (/\bby\b/.test(lower) && explicitDate) {
    return `By ${formatDate(explicitDate)}`;
  }

  const monthWindow = monthWindowFromText(lower, reference);
  if (monthWindow) return monthWindow;

  const monthOnly = monthOnlyFromText(lower, reference);
  if (monthOnly) return monthOnly;

  const quarter = quarterFromText(lower, reference);
  if (quarter) return quarter;

  if (lower.includes("next week")) {
    const week = formatDate(startOfWeek(addDays(reference, 7)));
    return lower.includes("as early as") ? `As early as the week of ${week}` : `Week of ${week}`;
  }

  if (lower.includes("this week")) {
    return `Week of ${formatDate(startOfWeek(reference))}`;
  }

  if (lower.includes("next month")) {
    return formatMonthYear(addMonths(reference, 1));
  }

  if (lower.includes("this month")) {
    return formatMonthYear(reference);
  }

  if (explicitDate) return formatDate(explicitDate);
  return titleRaw(raw);
}
