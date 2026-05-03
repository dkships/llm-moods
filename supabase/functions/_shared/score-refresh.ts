import {
  applyScoreSmoothing,
  computeScore,
  DEFAULT_MIN_POSTS,
  getLocalDateLabel,
  getPacificDayWindow,
  PACIFIC_TIMEZONE,
  type ScoreInputPost,
  type ScoreResult,
  type TimeZoneDayWindow,
} from "./vibes-scoring.ts";

export type ScoreBasisStatus = "measured" | "thin_sample" | "no_eligible_posts" | "carried_forward" | "partial_coverage";
export type ScoreConfidence = "high" | "medium" | "low";

export interface ModelRow {
  id: string;
  name: string;
  slug: string;
}

interface ScrapedScorePost extends ScoreInputPost {
  model_id: string;
  posted_at: string;
  created_at: string | null;
}

interface DailySeedRow {
  period_start: string;
  score: number;
  total_posts: number | null;
  eligible_posts: number | null;
  score_basis_status?: ScoreBasisStatus | null;
  measurement_period_start?: string | null;
}

interface ScoreUpsertRow {
  model_id: string;
  period: "daily" | "hourly";
  period_start: string;
  score: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  total_posts: number;
  eligible_posts: number;
  top_complaint: string | null;
  score_computed_at: string;
  score_basis_status: ScoreBasisStatus;
  measurement_period_start: string | null;
  carried_from_period_start: string | null;
  input_max_posted_at: string | null;
  input_max_created_at: string | null;
  queued_posts: number;
  unclassified_posts: number;
  classification_coverage: number;
  score_confidence: ScoreConfidence;
}

export interface RefreshSummary {
  daily_rows: number;
  hourly_rows: number;
  skipped_days: number;
  posts_scanned: number;
  models: Record<string, unknown>;
}

const PAGE_SIZE = 1000;

function maxIso(rows: { [key: string]: string | null }[], key: string): string | null {
  let maxValue: string | null = null;
  for (const row of rows) {
    const value = row[key];
    if (value && (!maxValue || new Date(value).getTime() > new Date(maxValue).getTime())) {
      maxValue = value;
    }
  }
  return maxValue;
}

function dayWindows(daysBack: number, now: Date): TimeZoneDayWindow[] {
  const todayLabel = getLocalDateLabel(now, PACIFIC_TIMEZONE);
  const [year, month, day] = todayLabel.split("-").map(Number);
  const windows: TimeZoneDayWindow[] = [];

  for (let d = daysBack; d >= 0; d--) {
    const anchor = new Date(Date.UTC(year, month - 1, day - d, 12));
    windows.push(getPacificDayWindow(anchor));
  }

  return windows;
}

function hasValidSentiment(post: ScoreInputPost): boolean {
  return post.sentiment === "positive" || post.sentiment === "negative" || post.sentiment === "neutral";
}

function basisForResult(result: ScoreResult, queuedPosts = 0, classificationCoverage = 1, minPosts = DEFAULT_MIN_POSTS): ScoreBasisStatus {
  if (result.eligible_posts === 0) return "no_eligible_posts";
  if (result.eligible_posts < minPosts) return "thin_sample";
  if (queuedPosts > 0 || classificationCoverage < 0.8) return "partial_coverage";
  return "measured";
}

function confidenceForResult(result: ScoreResult, basis: ScoreBasisStatus, classificationCoverage: number, minPosts = DEFAULT_MIN_POSTS): ScoreConfidence {
  if (basis === "carried_forward" || basis === "no_eligible_posts") return "low";
  if (result.eligible_posts >= minPosts + 5 && classificationCoverage >= 0.85 && basis === "measured") return "high";
  if (result.eligible_posts >= minPosts && classificationCoverage >= 0.65) return "medium";
  return "low";
}

function coverageFor(eligiblePosts: number, totalCollected: number): number {
  if (totalCollected <= 0) return 1;
  return Math.max(0, Math.min(1, eligiblePosts / totalCollected));
}

function asScoreInput(posts: ScrapedScorePost[]): ScoreInputPost[] {
  return posts.map((post) => ({
    sentiment: post.sentiment,
    complaint_category: post.complaint_category,
    confidence: post.confidence,
    score: post.score,
    content_type: post.content_type,
    source: post.source,
  }));
}

async function fetchPostsInRange(supabase: any, rangeStart: string, rangeEnd: string): Promise<ScrapedScorePost[]> {
  const rows: ScrapedScorePost[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("scraped_posts")
      .select("model_id, sentiment, complaint_category, confidence, score, content_type, source, posted_at, created_at")
      .gte("posted_at", rangeStart)
      .lt("posted_at", rangeEnd)
      .order("posted_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to fetch scraped posts: ${error.message}`);
    const page = (data ?? []) as ScrapedScorePost[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchQueuedCountsInRange(
  supabase: any,
  rangeStart: string,
  rangeEnd: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await supabase
    .from("classification_queue")
    .select("model_id, posted_at")
    .in("status", ["queued", "retrying", "failed"])
    .gte("posted_at", rangeStart)
    .lt("posted_at", rangeEnd)
    .limit(10000);

  if (error) {
    // Older deployments may not have the queue table yet; score refresh should
    // still work and will emit zero queued coverage until the migration lands.
    if (error.code === "42P01" || /classification_queue/i.test(error.message ?? "")) {
      return counts;
    }
    throw new Error(`Failed to fetch classification queue counts: ${error.message}`);
  }

  for (const row of data ?? []) {
    const postedAt = new Date(row.posted_at);
    if (!Number.isFinite(postedAt.getTime())) continue;
    const key = `${row.model_id}|${getPacificDayWindow(postedAt).periodStart}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

async function fetchSeedRows(supabase: any, modelId: string, beforePeriodStart: string): Promise<DailySeedRow[]> {
  const { data, error } = await supabase
    .from("vibes_scores")
    .select("period_start, score, total_posts, eligible_posts, score_basis_status, measurement_period_start")
    .eq("model_id", modelId)
    .eq("period", "daily")
    .lt("period_start", beforePeriodStart)
    .order("period_start", { ascending: false })
    .limit(4);

  if (error) throw new Error(`Failed to fetch score seed rows: ${error.message}`);
  return (data ?? []) as DailySeedRow[];
}

function leadingEmptyDays(rows: DailySeedRow[]): number {
  let count = 0;
  for (const row of rows) {
    const basis = row.score_basis_status ?? null;
    const hasUsablePosts = (row.eligible_posts ?? 0) > 0
      || (row.eligible_posts === null && (row.total_posts ?? 0) > 0 && basis !== "no_eligible_posts");
    if (hasUsablePosts && basis !== "carried_forward") break;
    count++;
  }
  return count;
}

async function deleteScoreRange(
  supabase: any,
  dailyRangeStart: string,
  dailyRangeEnd: string,
  includeHourly: boolean,
  hourlyRangeStart: string,
  hourlyRangeEnd: string,
  dryRun: boolean,
) {
  if (dryRun) return;

  const { error: dailyError } = await supabase
    .from("vibes_scores")
    .delete()
    .eq("period", "daily")
    .gte("period_start", dailyRangeStart)
    .lt("period_start", dailyRangeEnd);
  if (dailyError) throw new Error(`Failed to delete daily score range: ${dailyError.message}`);

  if (includeHourly) {
    const { error: hourlyError } = await supabase
      .from("vibes_scores")
      .delete()
      .eq("period", "hourly")
      .gte("period_start", hourlyRangeStart)
      .lt("period_start", hourlyRangeEnd);
    if (hourlyError) throw new Error(`Failed to delete hourly score range: ${hourlyError.message}`);
  }
}

async function upsertScoreRows(supabase: any, rows: ScoreUpsertRow[], dryRun: boolean) {
  if (dryRun || rows.length === 0) return;

  for (let from = 0; from < rows.length; from += PAGE_SIZE) {
    const chunk = rows.slice(from, from + PAGE_SIZE);
    const { error } = await supabase
      .from("vibes_scores")
      .upsert(chunk, { onConflict: "model_id,period,period_start" });
    if (error) throw new Error(`Failed to upsert score rows: ${error.message}`);
  }
}

export async function claimServiceLock(
  supabase: any,
  lockKey: string,
  ttlSeconds = 360,
): Promise<{ claimed: boolean; owner: string }> {
  const owner = crypto.randomUUID();
  const { data, error } = await supabase.rpc("try_claim_service_lock", {
    p_lock_key: lockKey,
    p_owner: owner,
    p_ttl_seconds: ttlSeconds,
  });

  if (error) throw new Error(`Failed to claim ${lockKey} lock: ${error.message}`);
  return { claimed: data === true, owner };
}

export async function releaseServiceLock(supabase: any, lockKey: string, owner: string): Promise<void> {
  const { error } = await supabase.rpc("release_service_lock", {
    p_lock_key: lockKey,
    p_owner: owner,
  });
  if (error) throw new Error(`Failed to release ${lockKey} lock: ${error.message}`);
}

export async function refreshScores(
  supabase: any,
  models: ModelRow[],
  options: {
    daysBack: number;
    includeHourly: boolean;
    minPosts?: number;
    dryRun?: boolean;
    replaceRange?: boolean;
    now?: Date;
  },
): Promise<RefreshSummary> {
  const now = options.now ?? new Date();
  const minPosts = options.minPosts ?? DEFAULT_MIN_POSTS;
  const dryRun = options.dryRun ?? false;
  const windows = dayWindows(options.daysBack, now);
  const dailyRangeStart = windows[0].rangeStart;
  const dailyRangeEnd = windows[windows.length - 1].rangeEnd;
  const hourlyRangeStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() - 23,
  )).toISOString();
  const rangeStart = options.includeHourly && new Date(hourlyRangeStart) < new Date(dailyRangeStart)
    ? hourlyRangeStart
    : dailyRangeStart;
  const rangeEnd = options.includeHourly
    ? new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours() + 1,
    )).toISOString()
    : dailyRangeEnd;
  const posts = await fetchPostsInRange(supabase, rangeStart, rangeEnd);
  const queuedCounts = await fetchQueuedCountsInRange(supabase, rangeStart, rangeEnd);
  const computedAt = new Date().toISOString();
  const postsByDay = new Map<string, ScrapedScorePost[]>();
  const rows: ScoreUpsertRow[] = [];
  const summary: RefreshSummary = {
    daily_rows: 0,
    hourly_rows: 0,
    skipped_days: 0,
    posts_scanned: posts.length,
    models: {},
  };

  for (const post of posts) {
    const postedMs = new Date(post.posted_at).getTime();
    if (!Number.isFinite(postedMs)) continue;
    for (const window of windows) {
      if (postedMs >= new Date(window.rangeStart).getTime() && postedMs < new Date(window.rangeEnd).getTime()) {
        const key = `${post.model_id}|${window.periodStart}`;
        const group = postsByDay.get(key) ?? [];
        group.push(post);
        postsByDay.set(key, group);
        break;
      }
    }
  }

  for (const model of models) {
    const seedRows = await fetchSeedRows(supabase, model.id, dailyRangeStart);
    let previousScore: number | null = seedRows[0]?.score ?? null;
    let previousPeriodStart: string | null = seedRows[0]?.period_start ?? null;
    let previousMeasurementPeriodStart: string | null = seedRows[0]?.measurement_period_start ?? seedRows[0]?.period_start ?? null;
    let consecutiveEmpty = leadingEmptyDays(seedRows);
    const modelSummary = {
      daily_rows: 0,
      skipped_days: 0,
      carried_forward: 0,
      thin_sample: 0,
      no_eligible_posts: 0,
    };

    for (const window of windows) {
      const dayPosts = postsByDay.get(`${model.id}|${window.periodStart}`) ?? [];
      const queuedPosts = queuedCounts.get(`${model.id}|${window.periodStart}`) ?? 0;

      if (dayPosts.length > 0 || queuedPosts > 0) {
        const result = computeScore(asScoreInput(dayPosts));
        const validClassifiedPosts = dayPosts.filter(hasValidSentiment).length;
        const unclassifiedPosts = dayPosts.length - validClassifiedPosts + queuedPosts;
        const totalCollectedPosts = result.total_posts + queuedPosts;
        const classificationCoverage = coverageFor(result.eligible_posts, totalCollectedPosts);
        const basis = basisForResult(result, queuedPosts, classificationCoverage, minPosts);
        const scoreConfidence = confidenceForResult(result, basis, classificationCoverage, minPosts);
        const measurementPeriodStart = result.eligible_posts > 0 ? window.periodStart : previousMeasurementPeriodStart;
        const score = result.eligible_posts === 0 && previousScore !== null
          ? previousScore
          : applyScoreSmoothing(result.score, previousScore, result.eligible_posts, minPosts);

        rows.push({
          model_id: model.id,
          period: "daily",
          period_start: window.periodStart,
          score,
          positive_count: result.positive_count,
          negative_count: result.negative_count,
          neutral_count: result.neutral_count,
          total_posts: totalCollectedPosts,
          eligible_posts: result.eligible_posts,
          top_complaint: result.top_complaint,
          score_computed_at: computedAt,
          score_basis_status: basis,
          measurement_period_start: measurementPeriodStart,
          carried_from_period_start: null,
          input_max_posted_at: maxIso(dayPosts, "posted_at"),
          input_max_created_at: maxIso(dayPosts, "created_at"),
          queued_posts: queuedPosts,
          unclassified_posts: unclassifiedPosts,
          classification_coverage: classificationCoverage,
          score_confidence: scoreConfidence,
        });

        if (result.eligible_posts > 0) {
          previousScore = score;
          previousPeriodStart = window.periodStart;
          previousMeasurementPeriodStart = window.periodStart;
          consecutiveEmpty = 0;
        } else {
          consecutiveEmpty++;
        }
        modelSummary.daily_rows++;
        if (basis === "thin_sample") modelSummary.thin_sample++;
        if (basis === "no_eligible_posts") modelSummary.no_eligible_posts++;
        continue;
      }

      if (previousScore !== null && consecutiveEmpty < 3) {
        const carryForward: ScoreResult = {
          score: previousScore,
          positive_count: 0,
          negative_count: 0,
          neutral_count: 0,
          total_posts: 0,
          eligible_posts: 0,
          top_complaint: null,
        };

        rows.push({
          model_id: model.id,
          period: "daily",
          period_start: window.periodStart,
          score: carryForward.score,
          positive_count: 0,
          negative_count: 0,
          neutral_count: 0,
          total_posts: 0,
          eligible_posts: 0,
          top_complaint: null,
          score_computed_at: computedAt,
          score_basis_status: "carried_forward",
          measurement_period_start: previousMeasurementPeriodStart,
          carried_from_period_start: previousMeasurementPeriodStart ?? previousPeriodStart,
          input_max_posted_at: null,
          input_max_created_at: null,
          queued_posts: 0,
          unclassified_posts: 0,
          classification_coverage: 1,
          score_confidence: "low",
        });

        previousPeriodStart = window.periodStart;
        consecutiveEmpty++;
        modelSummary.daily_rows++;
        modelSummary.carried_forward++;
      } else {
        summary.skipped_days++;
        modelSummary.skipped_days++;
      }
    }

    summary.models[model.slug] = modelSummary;
  }

  if (options.includeHourly) {
    const hourStarts: string[] = [];
    for (let h = 23; h >= 0; h--) {
      hourStarts.push(new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours() - h,
      )).toISOString());
    }

    const postsByHour = new Map<string, ScrapedScorePost[]>();
    const hourStartSet = new Set(hourStarts);
    for (const post of posts) {
      const postedAt = new Date(post.posted_at);
      if (!Number.isFinite(postedAt.getTime())) continue;
      const hourStart = new Date(Date.UTC(
        postedAt.getUTCFullYear(),
        postedAt.getUTCMonth(),
        postedAt.getUTCDate(),
        postedAt.getUTCHours(),
      )).toISOString();
      if (!hourStartSet.has(hourStart)) continue;
      const key = `${post.model_id}|${hourStart}`;
      const group = postsByHour.get(key) ?? [];
      group.push(post);
      postsByHour.set(key, group);
    }

    for (const [key, hourPosts] of postsByHour.entries()) {
      const [modelId, periodStart] = key.split("|");
      const result = computeScore(asScoreInput(hourPosts));
      const unclassifiedPosts = hourPosts.filter((post) => !hasValidSentiment(post)).length;
      const classificationCoverage = coverageFor(result.eligible_posts, result.total_posts);
      const basis = basisForResult(result, 0, classificationCoverage, minPosts);
      rows.push({
        model_id: modelId,
        period: "hourly",
        period_start: periodStart,
        score: result.score,
        positive_count: result.positive_count,
        negative_count: result.negative_count,
        neutral_count: result.neutral_count,
        total_posts: result.total_posts,
        eligible_posts: result.eligible_posts,
        top_complaint: result.top_complaint,
        score_computed_at: computedAt,
        score_basis_status: basis,
        measurement_period_start: result.eligible_posts > 0 ? periodStart : null,
        carried_from_period_start: null,
        input_max_posted_at: maxIso(hourPosts, "posted_at"),
        input_max_created_at: maxIso(hourPosts, "created_at"),
        queued_posts: 0,
        unclassified_posts: unclassifiedPosts,
        classification_coverage: classificationCoverage,
        score_confidence: confidenceForResult(result, basis, classificationCoverage, minPosts),
      });
      summary.hourly_rows++;
    }
  }

  if (options.replaceRange) {
    await deleteScoreRange(
      supabase,
      dailyRangeStart,
      dailyRangeEnd,
      options.includeHourly,
      hourlyRangeStart,
      rangeEnd,
      dryRun,
    );
  }
  await upsertScoreRows(supabase, rows, dryRun);
  summary.daily_rows = rows.filter((row) => row.period === "daily").length;

  return summary;
}
