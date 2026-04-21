import { normalizeComplaintCategory } from "./taxonomy.ts";

export interface ScoreInputPost {
  sentiment: string | null;
  complaint_category: string | null;
  confidence: number | null;
  score: number | null;
  content_type: string | null;
  source?: string | null;
}

export interface ScoreResult {
  score: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  total_posts: number;
  eligible_posts: number;
  top_complaint: string | null;
}

export interface DailyScoreSeedRow {
  period_start: string;
  score: number;
}

export interface TimeZoneDayWindow {
  periodStart: string;
  rangeStart: string;
  rangeEnd: string;
  label: string;
  timeZone: string;
}

export const DEFAULT_MIN_POSTS = 5;
export const PACIFIC_TIMEZONE = "America/Los_Angeles";

const PARTS_CACHE = new Map<string, Intl.DateTimeFormat>();

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cacheKey = `${timeZone}:parts`;
  const cached = PARTS_CACHE.get(cacheKey);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  PARTS_CACHE.set(cacheKey, formatter);
  return formatter;
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const parts = getPartsFormatter(timeZone).formatToParts(date);

  const lookup = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((entry) => entry.type === type)?.value;
    if (!part) throw new Error(`Missing ${type} for timezone ${timeZone}`);
    return Number(part);
  };

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: lookup("hour"),
    minute: lookup("minute"),
    second: lookup("second"),
  };
}

export function getLocalDateLabel(date: Date, timeZone: string): string {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function addDaysToDateLabel(label: string, days: number): string {
  const [year, month, day] = label.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

export function getUtcInstantForLocalTime(
  label: string,
  time: string,
  timeZone: string,
): Date {
  const [year, month, day] = label.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcBase = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let guess = utcBase;
  for (let i = 0; i < 4; i++) {
    const offsetMs = getTimeZoneOffsetMs(new Date(guess), timeZone);
    const nextGuess = utcBase - offsetMs;
    if (nextGuess === guess) break;
    guess = nextGuess;
  }

  return new Date(guess);
}

export function getTimeZoneDayWindow(date: Date, timeZone: string): TimeZoneDayWindow {
  const label = getLocalDateLabel(date, timeZone);
  const nextLabel = addDaysToDateLabel(label, 1);
  const rangeStart = getUtcInstantForLocalTime(label, "00:00", timeZone);
  const rangeEnd = getUtcInstantForLocalTime(nextLabel, "00:00", timeZone);

  return {
    periodStart: rangeStart.toISOString(),
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    label,
    timeZone,
  };
}

export function getUtcDayWindow(date: Date): TimeZoneDayWindow {
  return getTimeZoneDayWindow(date, "UTC");
}

export function getPacificDayWindow(date: Date): TimeZoneDayWindow {
  return getTimeZoneDayWindow(date, PACIFIC_TIMEZONE);
}

export interface CoordinatedWindow {
  label: string;
  time: string;
}

export interface MatchingWindow extends CoordinatedWindow {
  localDate: string;
  localTime: string;
  timeZone: string;
}

export function normalizeWindowTimes(windowTimes: string[]): CoordinatedWindow[] {
  const uniqueTimes = Array.from(new Set(windowTimes))
    .filter((value) => /^\d{2}:\d{2}$/.test(value))
    .sort();

  const fallbackLabels = ["morning", "afternoon", "evening"];
  return uniqueTimes.map((time, index) => ({
    time,
    label: fallbackLabels[index] ?? `window_${index + 1}`,
  }));
}

export function getMatchingWindow(
  date: Date,
  timeZone: string,
  windowTimes: string[],
): MatchingWindow | null {
  const parts = getTimeZoneParts(date, timeZone);
  const localTime = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  const windows = normalizeWindowTimes(windowTimes);
  const matched = windows.find((window) => window.time === localTime);

  if (!matched) return null;

  return {
    ...matched,
    localDate: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`,
    localTime,
    timeZone,
  };
}

export function getPreviousDailyScore(
  rows: DailyScoreSeedRow[],
  currentPeriodStart: string,
): number | null {
  const currentStartMs = new Date(currentPeriodStart).getTime();

  for (const row of rows) {
    if (new Date(row.period_start).getTime() < currentStartMs) {
      return row.score;
    }
  }

  return null;
}

export function applyScoreSmoothing(
  score: number,
  previousScore: number | null,
  postCount: number,
  minPosts = DEFAULT_MIN_POSTS,
): number {
  if (previousScore === null) {
    return score;
  }

  let currentWeight = 0.7;
  if (postCount <= 1) {
    currentWeight = 0.2;
  } else if (postCount <= 3) {
    currentWeight = 0.3;
  } else if (postCount < minPosts) {
    currentWeight = 0.4;
  }
  const previousWeight = 1 - currentWeight;

  return Math.round((currentWeight * score) + (previousWeight * previousScore));
}

export function computeScore(posts: ScoreInputPost[]): ScoreResult {
  const MIN_CONFIDENCE = 0.65;
  const MAX_SOURCE_SHARE = 0.5;

  const sourceRawWeights: Record<string, number> = {};
  const eligible: {
    w: number;
    sentiment: string | null;
    complaint_category: string | null;
    source: string;
  }[] = [];

  for (const post of posts) {
    const rawConfidence = post.confidence ?? 0.5;
    if (rawConfidence < MIN_CONFIDENCE) continue;

    const contentMult = post.content_type === "title_only" ? 0.6 : 1.0;
    const confidence = Math.max(0, Math.min(1, rawConfidence)) * contentMult;
    const engagement = (post.score && post.score > 0) ? Math.log(post.score + 1) : 1.0;
    const weight = confidence * engagement;
    const source = post.source || "unknown";

    sourceRawWeights[source] = (sourceRawWeights[source] || 0) + weight;
    eligible.push({
      w: weight,
      sentiment: post.sentiment,
      complaint_category: post.complaint_category,
      source,
    });
  }

  const totalRaw = Object.values(sourceRawWeights).reduce((sum, weight) => sum + weight, 0);
  const sourceScale: Record<string, number> = {};
  if (totalRaw > 0) {
    const maxAllowed = totalRaw * MAX_SOURCE_SHARE;
    for (const [source, sourceWeight] of Object.entries(sourceRawWeights)) {
      sourceScale[source] = sourceWeight > maxAllowed ? maxAllowed / sourceWeight : 1.0;
    }
  }

  let positiveWeight = 0;
  let negativeWeight = 0;
  let neutralWeight = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  const complaints: Record<string, number> = {};

  for (const eligiblePost of eligible) {
    const weight = eligiblePost.w * (sourceScale[eligiblePost.source] ?? 1.0);

    if (eligiblePost.sentiment === "positive") {
      positiveWeight += weight;
      positiveCount++;
      continue;
    }

    if (eligiblePost.sentiment === "negative") {
      negativeWeight += weight;
      negativeCount++;

      const complaintCategory = normalizeComplaintCategory(eligiblePost.complaint_category);
      if (complaintCategory) {
        complaints[complaintCategory] = (complaints[complaintCategory] || 0) + weight;
      }
      continue;
    }

    neutralWeight += weight;
    neutralCount++;
  }

  const totalWeight = positiveWeight + negativeWeight + neutralWeight;
  const effectivePositive = positiveWeight + (neutralWeight * 0.3);
  const score = totalWeight > 0 ? Math.round((effectivePositive / totalWeight) * 100) : 50;

  let topComplaint: string | null = null;
  let maxComplaintWeight = 0;
  for (const [category, weight] of Object.entries(complaints)) {
    if (weight > maxComplaintWeight) {
      maxComplaintWeight = weight;
      topComplaint = category;
    }
  }

  return {
    score,
    positive_count: positiveCount,
    negative_count: negativeCount,
    neutral_count: neutralCount,
    total_posts: posts.length,
    eligible_posts: eligible.length,
    top_complaint: topComplaint,
  };
}
