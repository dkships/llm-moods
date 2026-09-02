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

// Sources that never enter the sentiment score. GitHub issues are bug reports:
// they can only be negative or irrelevant, so they add negative weight with no
// positive counterpart, and their volume tracks repo activity (claude-code
// files ~5x codex, ~60x gemini-cli), not user mood. 2026-08-22 → 09-01 they
// pulled Claude down ~10-13 points/day. Rows stay in scraped_posts for the
// complaints and sources panels; only scoring ignores them.
export const SCORE_EXCLUDED_SOURCES: ReadonlySet<string> = new Set(["github"]);

// Max share of a day's final scoring weight one source may hold once alternate
// evidence is sufficient (see ALTERNATE_SOURCE_WEIGHT_FOR_HARD_CAP). App Store
// reviews are consumer star ratings of the app shell ("cool app for image
// editing"), ~90% positive for Gemini/Grok, and were 55-80% of those models'
// relevant volume — a "community vibes" score shouldn't be mostly that.
export const DEFAULT_MAX_SOURCE_SHARE = 0.5;
export const SOURCE_SHARE_CAPS: Readonly<Record<string, number>> = { appstore: 0.35 };

export function sourceShareCap(source: string): number {
  return SOURCE_SHARE_CAPS[source] ?? DEFAULT_MAX_SOURCE_SHARE;
}

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

// How far the hard per-source caps are relaxed toward 1.0 when the
// non-dominant sources carry little weight: 0 = fully relaxed, 1 = hard caps.
function alternateEvidenceProgress(
  sourceRawWeights: Record<string, number>,
  alternateWeightForHardCap: number,
): number {
  const weights = Object.values(sourceRawWeights).filter((weight) => weight > 0);
  if (weights.length <= 1 || alternateWeightForHardCap <= 0) {
    return 1;
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const dominantWeight = Math.max(...weights);
  const alternateWeight = totalWeight - dominantWeight;
  return Math.min(1, Math.max(0, alternateWeight) / alternateWeightForHardCap);
}

function computeSourceScale(
  sourceRawWeights: Record<string, number>,
  alternateWeightForHardCap: number,
): Record<string, number> {
  const entries = Object.entries(sourceRawWeights).filter(([, weight]) => weight > 0);
  const scales: Record<string, number> = {};
  for (const [source] of entries) scales[source] = 1.0;

  const progress = alternateEvidenceProgress(sourceRawWeights, alternateWeightForHardCap);
  const capFor = (source: string): number => {
    const hardCap = sourceShareCap(source);
    return hardCap + ((1 - hardCap) * (1 - progress));
  };

  if (entries.length <= 1 || progress <= 0) {
    return scales;
  }

  // Water-fill dominant sources so each cap applies to final scaled weight,
  // not just to the source's share of the pre-scaled raw total. Capped sources
  // together hold Σcap of the final total, so the uncapped remainder is
  // (1 - Σcap) of it. Caps only bound sources relative to *uncapped* ones: if
  // every remaining source would exceed its cap (Σcap < 1 makes that possible
  // with asymmetric caps) they stay uncapped and absorb the remainder.
  const cappedSources = new Set<string>();
  let remainingWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cappedShare = 0;

  while (cappedShare < 1) {
    const finalTotal = remainingWeight / (1 - cappedShare);
    const uncapped = entries.filter(([source]) => !cappedSources.has(source));
    const nextCapped = uncapped.filter(([source, weight]) => weight > finalTotal * capFor(source));
    if (nextCapped.length === 0 || nextCapped.length === uncapped.length) {
      break;
    }

    for (const [source, weight] of nextCapped) {
      cappedSources.add(source);
      cappedShare += capFor(source);
      remainingWeight -= weight;
    }
  }

  if (cappedSources.size === 0 || cappedShare >= 1) {
    return scales;
  }

  const finalTotal = remainingWeight / (1 - cappedShare);
  for (const [source, weight] of entries) {
    if (cappedSources.has(source)) {
      scales[source] = Math.min(1, (finalTotal * capFor(source)) / weight);
    }
  }

  return scales;
}

export function isScoredSource(source: string | null | undefined): boolean {
  return !SCORE_EXCLUDED_SOURCES.has(source || "unknown");
}

export function computeScore(allPosts: ScoreInputPost[]): ScoreResult {
  const MIN_CONFIDENCE = 0.65;
  const ALTERNATE_SOURCE_WEIGHT_FOR_HARD_CAP = 3.0;

  const posts = allPosts.filter((post) => isScoredSource(post.source));

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
    // Engagement multiplier: floored at 1 so it is monotonic (raw ln(score+1)
    // made a 1-like post weigh LESS than a 0-like post), and capped at
    // ln(1001) ≈ 6.9 so one viral post can't supply most of a day's weight —
    // engagement scales differ wildly by platform (20k-like tweets vs 0-2-like
    // Mastodon posts) and the source-share cap only bounds whole sources.
    const engagement = Math.min(
      Math.max(1.0, Math.log((post.score && post.score > 0 ? post.score : 0) + 1)),
      Math.log(1001),
    );
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
  // Neutral counts as 0.5 positive so a neutral post is score-neutral,
  // consistent with the empty-day baseline of 50. The previous 0.3 made
  // neutral read as 70% negative: an all-neutral day scored 30, dragging
  // scores down exactly on launch/news days when factual comparison posts
  // spike — the largest structural bias the 2026-07 accuracy audit found.
  const effectivePositive = positiveWeight + (neutralWeight * 0.5);
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
