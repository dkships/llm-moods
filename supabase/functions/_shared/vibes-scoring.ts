import { normalizeComplaintCategory, normalizeSentiment } from "./taxonomy.ts";

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
  graceMinutes = 0,
): MatchingWindow | null {
  const parts = getTimeZoneParts(date, timeZone);
  const localTime = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  const windows = normalizeWindowTimes(windowTimes);
  const currentMinutes = parts.hour * 60 + parts.minute;
  const matched = windows.find((window) => {
    const [hour, minute] = window.time.split(":").map(Number);
    const windowMinutes = hour * 60 + minute;
    return currentMinutes >= windowMinutes && currentMinutes <= windowMinutes + graceMinutes;
  });

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
  } else {
    const fullWeightPosts = minPosts + 5;
    if (postCount < fullWeightPosts) {
      const rampSteps = (fullWeightPosts - minPosts) + 1;
      const rampPosition = (postCount - minPosts) + 1;
      currentWeight = 0.4 + ((rampPosition / rampSteps) * 0.3);
    }
  }
  const previousWeight = 1 - currentWeight;

  return Math.round((currentWeight * score) + (previousWeight * previousScore));
}

function getEffectiveSourceShareCap(
  sourceRawWeights: Record<string, number>,
  hardMaxShare: number,
  alternateWeightForHardCap: number,
): number {
  const weights = Object.values(sourceRawWeights).filter((weight) => weight > 0);
  if (weights.length <= 1 || alternateWeightForHardCap <= 0) {
    return hardMaxShare;
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const dominantWeight = Math.max(...weights);
  const alternateWeight = totalWeight - dominantWeight;
  if (alternateWeight >= alternateWeightForHardCap) {
    return hardMaxShare;
  }

  const alternateProgress = Math.max(0, alternateWeight) / alternateWeightForHardCap;
  return hardMaxShare + ((1 - hardMaxShare) * (1 - alternateProgress));
}

function computeSourceScale(
  sourceRawWeights: Record<string, number>,
  maxShare: number,
  alternateWeightForHardCap: number,
): Record<string, number> {
  const entries = Object.entries(sourceRawWeights).filter(([, weight]) => weight > 0);
  const scales: Record<string, number> = {};
  for (const [source] of entries) scales[source] = 1.0;

  const effectiveMaxShare = getEffectiveSourceShareCap(
    sourceRawWeights,
    maxShare,
    alternateWeightForHardCap,
  );

  if (entries.length <= 1 || effectiveMaxShare <= 0 || effectiveMaxShare >= 1) {
    return scales;
  }

  const cappedSources = new Set<string>();
  let remainingWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);

  // Water-fill dominant sources so the cap applies to final scaled weight,
  // not just to each source's share of the pre-scaled raw total.
  while (remainingWeight > 0) {
    const denominator = 1 - (cappedSources.size * effectiveMaxShare);
    if (denominator <= 0) break;

    const finalTotal = remainingWeight / denominator;
    const maxAllowed = finalTotal * effectiveMaxShare;
    const nextCapped = entries
      .filter(([source]) => !cappedSources.has(source))
      .filter(([, weight]) => weight > maxAllowed);

    if (nextCapped.length === 0) {
      for (const [source, weight] of entries) {
        if (cappedSources.has(source)) {
          scales[source] = Math.min(1, maxAllowed / weight);
        }
      }
      return scales;
    }

    for (const [source, weight] of nextCapped) {
      cappedSources.add(source);
      remainingWeight -= weight;
    }
  }

  if (cappedSources.size === 0) {
    return scales;
  }

  const denominator = 1 - (cappedSources.size * effectiveMaxShare);
  if (denominator <= 0) {
    return scales;
  }

  const maxAllowed = (remainingWeight / denominator) * effectiveMaxShare;
  for (const [source, weight] of entries) {
    if (cappedSources.has(source)) {
      scales[source] = Math.min(1, maxAllowed / weight);
    }
  }

  return scales;
}

export function computeScore(posts: ScoreInputPost[]): ScoreResult {
  const MIN_CONFIDENCE = 0.65;
  const MAX_SOURCE_SHARE = 0.5;
  const ALTERNATE_SOURCE_WEIGHT_FOR_HARD_CAP = 3.0;

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
    const sentiment = normalizeSentiment(post.sentiment);
    if (!sentiment) continue;

    const contentMult = post.content_type === "title_only" ? 0.6 : 1.0;
    const confidence = Math.max(0, Math.min(1, rawConfidence)) * contentMult;
    const engagement = (post.score && post.score > 0) ? Math.log(post.score + 1) : 1.0;
    const weight = confidence * engagement;
    const source = post.source || "unknown";

    sourceRawWeights[source] = (sourceRawWeights[source] || 0) + weight;
    eligible.push({
      w: weight,
      sentiment,
      complaint_category: post.complaint_category,
      source,
    });
  }

  const sourceScale = computeSourceScale(
    sourceRawWeights,
    MAX_SOURCE_SHARE,
    ALTERNATE_SOURCE_WEIGHT_FOR_HARD_CAP,
  );

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
