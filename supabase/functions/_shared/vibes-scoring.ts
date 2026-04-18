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

export interface UtcDayWindow {
  periodStart: string;
  rangeStart: string;
  rangeEnd: string;
  label: string;
}

export const DEFAULT_MIN_POSTS = 5;

export function getUtcDayWindow(date: Date): UtcDayWindow {
  const dayStart = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  return {
    periodStart: dayStart.toISOString(),
    rangeStart: dayStart.toISOString(),
    rangeEnd: dayEnd.toISOString(),
    label: dayStart.toISOString().slice(0, 10),
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
