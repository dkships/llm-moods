import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  classifyBatchTargeted,
  isClassifierFailure,
  type ClassifyResult,
  type UsageSample,
} from "../_shared/classifier.ts";
import { internalOnlyResponse, isInternalServiceRequest, readJsonBody } from "../_shared/runtime.ts";

// Gemini-only classifier canary for sentiment model upgrades. It keeps
// evaluation inside the Gemini eval-quota budget, compares candidate Gemini
// models against either a senior oracle model or the existing stored labels,
// and never writes to scraped_posts or public scores.

const SOURCE = "check-gemini-self-bias";
// Single-use token for the Goldilocks smoke test (May 2026). Allows GET
// retrieval of the latest full-report from error_log without service-role
// auth. Remove this constant + the GET handler once the test wraps.
const PEEK_TOKEN = "goldilocks-2026-05-13-7f8a1e2c-9bb5-4f3a-b0e5-3a9c1d8e4f6b";
const DEFAULT_ORACLE = "gemini-2.5-pro";
const DEFAULT_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
];
const DEFAULT_SAMPLE_SIZE = 300;
const MAX_SAMPLE_SIZE = 500;
const MAX_CANDIDATES = 6;
const LOOKBACK_DAYS = 21;
const POOL_MULTIPLIER = 8;
const TRACKED_SLUGS = ["claude", "chatgpt", "gemini", "grok"] as const;
const EASY_CONFIDENCE = 0.85;
const HARD_CONFIDENCE = 0.65;
const TEXT_TRIM = 1200;
const DISAGREEMENT_LIMIT = 5;

// Per-million-token pricing (paid Tier 1, May 2026). Used for cost estimation
// only; if `usage.prompt_tokens` is absent we report cost=null instead.
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.30, output: 2.50 },
  "gemini-2.5-flash-lite": { input: 0.10, output: 0.40 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.50 },
  "gemini-3.1-flash-lite-preview": { input: 0.25, output: 1.50 },
  "gemini-3-flash-preview": { input: 0.50, output: 3.00 },
  "gemini-3.1-pro-preview": { input: 2.00, output: 12.0 },
};

const MULTI_MODEL_PATTERNS: Record<string, RegExp> = {
  claude: /\bclaude\b/i,
  chatgpt: /\b(?:chat\s?gpt|gpt-?[345o]|openai|o\d-mini)\b/i,
  gemini: /\bgemini\b/i,
  grok: /\bgrok\b/i,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface StratifyConfig {
  per_model: number;
  easy_share: number;
  non_english_min: number;
  multi_model_min: number;
}

const DEFAULT_STRATIFY: StratifyConfig = {
  per_model: 75,
  easy_share: 0.6,
  non_english_min: 30,
  multi_model_min: 40,
};

interface PoolPost {
  id: string;
  model_id: string;
  title: string | null;
  content: string | null;
  sentiment: string | null;
  complaint_category: string | null;
  praise_category: string | null;
  confidence: number | null;
  original_language: string | null;
  posted_at: string;
  models: { slug: string } | null;
}

interface SamplePost {
  id: string;
  model_slug: string;
  text: string;
  posted_at: string;
  stored_sentiment: string | null;
  stored_complaint: string | null;
  stored_praise: string | null;
  stored_confidence: number | null;
  original_language: string | null;
  is_easy: boolean;
  is_hard: boolean;
  is_non_english: boolean;
  is_multi_model: boolean;
}

interface CandidateUsageRollup {
  total_batches: number;
  total_prompt_tokens: number | null;
  total_completion_tokens: number | null;
  total_tokens: number | null;
  median_latency_ms: number | null;
  p95_latency_ms: number | null;
  cost_usd: number | null;
  cost_per_1k_posts_usd: number | null;
}

interface CandidateReport {
  role: "oracle" | "candidate" | "current";
  sample_size: number;
  parse_or_quota_failures: number;
  newly_irrelevant: number;
  reference: "oracle" | "stored" | null;
  reference_comparable: number;
  sentiment_match_rate: number | null;
  sentiment_match_by_class: Record<string, number | null>;
  complaint_match_rate: number | null;
  praise_match_rate: number | null;
  language_match_rate: number | null;
  translation_present_rate: number | null;
  usage: CandidateUsageRollup;
}

function clampSampleSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SAMPLE_SIZE;
  return Math.min(MAX_SAMPLE_SIZE, Math.max(8, Math.floor(n)));
}

function parseCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_CANDIDATES;
  const cleaned = value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .slice(0, MAX_CANDIDATES);
  const deduped = Array.from(new Set(cleaned));
  return deduped.length > 0 ? deduped : DEFAULT_CANDIDATES;
}

function mergeStratify(value: unknown): StratifyConfig {
  if (!value || typeof value !== "object") return DEFAULT_STRATIFY;
  const v = value as Record<string, unknown>;
  const num = (key: string, fallback: number): number => {
    const n = typeof v[key] === "number" ? (v[key] as number) : Number(v[key]);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    per_model: num("per_model", DEFAULT_STRATIFY.per_model),
    easy_share: Math.max(0, Math.min(1, num("easy_share", DEFAULT_STRATIFY.easy_share))),
    non_english_min: num("non_english_min", DEFAULT_STRATIFY.non_english_min),
    multi_model_min: num("multi_model_min", DEFAULT_STRATIFY.multi_model_min),
  };
}

function detectMentionedModels(text: string): string[] {
  const found: string[] = [];
  for (const [slug, pattern] of Object.entries(MULTI_MODEL_PATTERNS)) {
    if (pattern.test(text)) found.push(slug);
  }
  return found;
}

function annotatePost(post: PoolPost): SamplePost | null {
  const slug = post.models?.slug;
  if (!slug || !TRACKED_SLUGS.includes(slug as typeof TRACKED_SLUGS[number])) return null;
  const text = `${post.title || ""} ${post.content || ""}`.trim().slice(0, TEXT_TRIM);
  if (text.length < 20) return null;
  const confidence = post.confidence;
  const mentioned = detectMentionedModels(text);
  return {
    id: post.id,
    model_slug: slug,
    text,
    posted_at: post.posted_at,
    stored_sentiment: post.sentiment,
    stored_complaint: post.complaint_category,
    stored_praise: post.praise_category,
    stored_confidence: confidence,
    original_language: post.original_language,
    is_easy: typeof confidence === "number" && confidence >= EASY_CONFIDENCE,
    is_hard: typeof confidence === "number" && confidence < HARD_CONFIDENCE,
    is_non_english: post.original_language !== null && post.original_language !== "" && post.original_language !== "en",
    is_multi_model: mentioned.length >= 2,
  };
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function buildStratifiedSample(pool: PoolPost[], sampleSize: number, cfg: StratifyConfig) {
  const annotated = pool
    .map(annotatePost)
    .filter((p): p is SamplePost => p !== null);

  const perModelTarget = Math.max(1, Math.floor(sampleSize / TRACKED_SLUGS.length));
  const nonEnglishPerModel = Math.ceil(cfg.non_english_min / TRACKED_SLUGS.length);
  const multiModelPerModel = Math.ceil(cfg.multi_model_min / TRACKED_SLUGS.length);
  const easyPerModel = Math.max(0, Math.floor(perModelTarget * cfg.easy_share));
  const hardPerModel = Math.max(0, perModelTarget - easyPerModel);

  const sample: SamplePost[] = [];
  const picked = new Set<string>();
  const composition = {
    per_model: {} as Record<string, number>,
    easy: 0,
    hard: 0,
    mid_confidence: 0,
    non_english: 0,
    multi_model: 0,
    pool_size: annotated.length,
  };

  const pick = (post: SamplePost) => {
    if (picked.has(post.id)) return false;
    picked.add(post.id);
    sample.push(post);
    composition.per_model[post.model_slug] = (composition.per_model[post.model_slug] || 0) + 1;
    if (post.is_easy) composition.easy++;
    else if (post.is_hard) composition.hard++;
    else composition.mid_confidence++;
    if (post.is_non_english) composition.non_english++;
    if (post.is_multi_model) composition.multi_model++;
    return true;
  };

  const pickFrom = (candidates: SamplePost[], slug: string, quota: number) => {
    if (quota <= 0) return;
    let taken = 0;
    for (const c of candidates) {
      if (c.model_slug !== slug || picked.has(c.id)) continue;
      if (taken >= quota) break;
      if ((composition.per_model[slug] || 0) >= perModelTarget) break;
      if (pick(c)) taken++;
    }
  };

  for (const slug of TRACKED_SLUGS) {
    const forModel = sortById(annotated.filter((p) => p.model_slug === slug));
    const nonEnglish = forModel.filter((p) => p.is_non_english);
    const multiModel = forModel.filter((p) => p.is_multi_model);
    const easy = forModel.filter((p) => p.is_easy);
    const hard = forModel.filter((p) => p.is_hard);

    pickFrom(nonEnglish, slug, nonEnglishPerModel);
    pickFrom(multiModel, slug, multiModelPerModel);
    pickFrom(hard, slug, hardPerModel);
    pickFrom(easy, slug, easyPerModel);
    pickFrom(forModel, slug, perModelTarget);
  }

  if (sample.length > sampleSize) {
    sample.splice(sampleSize);
  }

  return { sample, composition };
}

async function fetchPool(
  supabase: ReturnType<typeof createClient>,
  sampleSize: number,
): Promise<PoolPost[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const poolCap = Math.min(2500, sampleSize * POOL_MULTIPLIER);
  const { data, error } = await supabase
    .from("scraped_posts")
    .select(
      "id, model_id, title, content, sentiment, complaint_category, praise_category, confidence, original_language, posted_at, models(slug)",
    )
    .eq("classification_status", "classified")
    .gte("posted_at", since)
    .order("posted_at", { ascending: false })
    .limit(poolCap);
  if (error) throw error;
  return (data ?? []) as unknown as PoolPost[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

function sumOrNull(values: (number | null)[]): number | null {
  let total = 0;
  let any = false;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function rollupUsage(model: string, samples: UsageSample[], sampleSize: number): CandidateUsageRollup {
  const prompts = samples.map((s) => s.promptTokens);
  const completions = samples.map((s) => s.completionTokens);
  const totals = samples.map((s) => s.totalTokens);
  const latencies = samples.map((s) => s.latencyMs).filter((n): n is number => Number.isFinite(n));
  const promptSum = sumOrNull(prompts);
  const completionSum = sumOrNull(completions);
  const totalSum = sumOrNull(totals);
  const pricing = PRICING[model];
  const cost = pricing && promptSum !== null && completionSum !== null
    ? Math.round(((promptSum * pricing.input + completionSum * pricing.output) / 1_000_000) * 1_000_000) / 1_000_000
    : null;
  const costPer1k = cost !== null && sampleSize > 0
    ? Math.round((cost / sampleSize) * 1000 * 1_000_000) / 1_000_000
    : null;
  return {
    total_batches: samples.length,
    total_prompt_tokens: promptSum,
    total_completion_tokens: completionSum,
    total_tokens: totalSum,
    median_latency_ms: median(latencies),
    p95_latency_ms: p95(latencies),
    cost_usd: cost,
    cost_per_1k_posts_usd: costPer1k,
  };
}

function rate(numer: number, denom: number): number | null {
  if (denom === 0) return null;
  return Math.round((numer / denom) * 1000) / 1000;
}

function scoreCandidate(
  model: string,
  sample: SamplePost[],
  results: ClassifyResult[],
  referenceResults: ClassifyResult[] | null,
  referenceFromStored: boolean,
  usageSamples: UsageSample[],
  role: CandidateReport["role"],
): CandidateReport {
  let parseOrQuotaFailures = 0;
  let newlyIrrelevant = 0;
  let comparable = 0;
  let sentimentMatches = 0;
  const byClass: Record<string, { match: number; total: number }> = {
    positive: { match: 0, total: 0 },
    negative: { match: 0, total: 0 },
    neutral: { match: 0, total: 0 },
  };
  let complaintTotal = 0;
  let complaintMatches = 0;
  let praiseTotal = 0;
  let praiseMatches = 0;
  let languageTotal = 0;
  let languageMatches = 0;
  let translationExpected = 0;
  let translationPresent = 0;

  for (let i = 0; i < sample.length; i++) {
    const post = sample[i];
    const result = results[i];
    if (!result || isClassifierFailure(result)) {
      parseOrQuotaFailures++;
      continue;
    }

    let refSentiment: string | null = null;
    let refComplaint: string | null = null;
    let refPraise: string | null = null;
    if (referenceFromStored) {
      refSentiment = post.stored_sentiment;
      refComplaint = post.stored_complaint;
      refPraise = post.stored_praise;
    } else if (referenceResults) {
      const ref = referenceResults[i];
      if (ref && !isClassifierFailure(ref) && ref.relevant) {
        refSentiment = ref.sentiment;
        refComplaint = ref.complaint_category;
        refPraise = ref.praise_category;
      }
    }

    if (!result.relevant) {
      if (refSentiment) newlyIrrelevant++;
      continue;
    }

    if (refSentiment) {
      comparable++;
      if (byClass[refSentiment]) byClass[refSentiment].total++;
      if (result.sentiment === refSentiment) {
        sentimentMatches++;
        if (byClass[refSentiment]) byClass[refSentiment].match++;
      }
    }

    if (refSentiment === "negative" && refComplaint && refComplaint !== "other") {
      complaintTotal++;
      if (result.complaint_category === refComplaint) complaintMatches++;
    }
    if (refSentiment === "positive" && refPraise) {
      praiseTotal++;
      if (result.praise_category === refPraise) praiseMatches++;
    }

    const refLanguage = referenceFromStored ? post.original_language : (referenceResults?.[i]?.language ?? null);
    if (refLanguage !== undefined) {
      languageTotal++;
      const candidateLanguage = result.language ?? null;
      const norm = (v: string | null | undefined) => (v === "" || v === "en" ? null : v ?? null);
      if (norm(refLanguage) === norm(candidateLanguage)) languageMatches++;
    }

    if (post.is_non_english) {
      translationExpected++;
      const t = result.english_translation;
      if (typeof t === "string" && t.trim().length >= 10) translationPresent++;
    }
  }

  return {
    role,
    sample_size: sample.length,
    parse_or_quota_failures: parseOrQuotaFailures,
    newly_irrelevant: newlyIrrelevant,
    reference: referenceFromStored ? "stored" : (referenceResults ? "oracle" : null),
    reference_comparable: comparable,
    sentiment_match_rate: rate(sentimentMatches, comparable),
    sentiment_match_by_class: {
      positive: rate(byClass.positive.match, byClass.positive.total),
      negative: rate(byClass.negative.match, byClass.negative.total),
      neutral: rate(byClass.neutral.match, byClass.neutral.total),
    },
    complaint_match_rate: rate(complaintMatches, complaintTotal),
    praise_match_rate: rate(praiseMatches, praiseTotal),
    language_match_rate: rate(languageMatches, languageTotal),
    translation_present_rate: rate(translationPresent, translationExpected),
    usage: rollupUsage(model, usageSamples, sample.length),
  };
}

function buildPairwiseMatrix(
  models: string[],
  resultsByModel: Record<string, ClassifyResult[]>,
): Record<string, Record<string, number | null>> {
  const matrix: Record<string, Record<string, number | null>> = {};
  for (const a of models) {
    matrix[a] = {};
    for (const b of models) {
      if (a === b) {
        matrix[a][b] = 1;
        continue;
      }
      const aRes = resultsByModel[a] || [];
      const bRes = resultsByModel[b] || [];
      let total = 0;
      let match = 0;
      const n = Math.min(aRes.length, bRes.length);
      for (let i = 0; i < n; i++) {
        const ar = aRes[i];
        const br = bRes[i];
        if (!ar || !br || isClassifierFailure(ar) || isClassifierFailure(br)) continue;
        if (!ar.relevant || !br.relevant) continue;
        total++;
        if (ar.sentiment === br.sentiment) match++;
      }
      matrix[a][b] = rate(match, total);
    }
  }
  return matrix;
}

function findDisagreements(
  sample: SamplePost[],
  oracleResults: ClassifyResult[],
  candidateResults: ClassifyResult[],
  limit: number,
) {
  const cases: Array<{
    post_id: string;
    model_slug: string;
    text: string;
    oracle_sentiment: string | null;
    candidate_sentiment: string | null;
    oracle_complaint: string | null;
    candidate_complaint: string | null;
    stored_sentiment: string | null;
  }> = [];
  for (let i = 0; i < sample.length && cases.length < limit; i++) {
    const post = sample[i];
    const oracle = oracleResults[i];
    const cand = candidateResults[i];
    if (!oracle || !cand || isClassifierFailure(oracle) || isClassifierFailure(cand)) continue;
    if (!oracle.relevant || !cand.relevant) continue;
    if (oracle.sentiment === cand.sentiment) continue;
    cases.push({
      post_id: post.id,
      model_slug: post.model_slug,
      text: post.text.slice(0, 220),
      oracle_sentiment: oracle.sentiment,
      candidate_sentiment: cand.sentiment,
      oracle_complaint: oracle.complaint_category,
      candidate_complaint: cand.complaint_category,
      stored_sentiment: post.stored_sentiment,
    });
  }
  return cases;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function persistReport(
  supabase: ReturnType<typeof createClient>,
  report: Record<string, unknown>,
): Promise<void> {
  const payload = JSON.stringify(report);
  const chunked = payload.length > 90_000 ? payload.slice(0, 90_000) + "...[truncated]" : payload;
  await supabase.from("error_log").insert({
    function_name: SOURCE,
    error_message: chunked,
    context: "full-report",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("token") !== PEEK_TOKEN) {
      return internalOnlyResponse(corsHeaders);
    }
    const view = url.searchParams.get("view") || "reports";
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "1")));

    if (view === "errors") {
      const { data, error } = await supabase
        .from("error_log")
        .select("created_at, context, error_message")
        .eq("function_name", SOURCE)
        .neq("context", "full-report")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return jsonResponse({ status: "failed", error: error.message }, 500);
      return jsonResponse({ status: "success", count: (data || []).length, errors: data || [] });
    }

    const { data, error } = await supabase
      .from("error_log")
      .select("created_at, error_message")
      .eq("function_name", SOURCE)
      .eq("context", "full-report")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return jsonResponse({ status: "failed", error: error.message }, 500);
    const reports = (data || []).map((row) => {
      try {
        return { created_at: row.created_at, report: JSON.parse(row.error_message as string) };
      } catch {
        return { created_at: row.created_at, raw: row.error_message };
      }
    });
    return jsonResponse({ status: "success", count: reports.length, reports });
  }

  if (!isInternalServiceRequest(req)) return internalOnlyResponse(corsHeaders);
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "GEMINI_API_KEY not configured" }, 500);
  }

  const body = await readJsonBody(req);
  const mode: "oracle" | "agreement" = body.mode === "agreement" ? "agreement" : "oracle";
  const oracle = typeof body.oracle === "string" && body.oracle.length > 0 ? body.oracle : DEFAULT_ORACLE;
  const candidates = parseCandidates(body.candidates);
  const sampleSize = clampSampleSize(body.sample_size);
  const stratify = mergeStratify(body.stratify);
  const evalMinuteLimit = typeof body.eval_minute_limit === "number" && body.eval_minute_limit > 0
    ? Math.floor(body.eval_minute_limit)
    : undefined;
  const evalDailyLimit = typeof body.eval_daily_limit === "number" && body.eval_daily_limit > 0
    ? Math.floor(body.eval_daily_limit)
    : undefined;

  const logError = async (msg: string, ctx?: string) => {
    await supabase.from("error_log").insert({
      function_name: SOURCE,
      error_message: msg,
      context: ctx || "model-eval",
    });
  };

  try {
    const pool = await fetchPool(supabase, sampleSize);
    const { sample, composition } = buildStratifiedSample(pool, sampleSize, stratify);

    if (sample.length === 0) {
      return jsonResponse({
        status: "success",
        mode,
        sample_size: 0,
        candidates,
        oracle: mode === "oracle" ? oracle : null,
        composition,
        note: "No eligible posts in lookback window.",
      });
    }

    const targetedItems = sample.map((p) => ({ text: p.text, targetModel: p.model_slug }));

    const isThinkingOnly = (model: string) => /^gemini-(?:2\.5|3(?:\.\d+)?)-pro/.test(model);

    const runModel = async (model: string) => {
      const usage: UsageSample[] = [];
      const results = await classifyBatchTargeted(
        targetedItems,
        apiKey,
        25,
        logError,
        {
          model,
          quotaScope: "eval",
          minuteLimit: evalMinuteLimit,
          dailyLimit: evalDailyLimit,
          reasoningEffort: isThinkingOnly(model) ? "omit" : "none",
          onUsage: (s) => {
            usage.push(s);
          },
        },
      );
      return { results, usage };
    };

    const allModels = mode === "oracle"
      ? Array.from(new Set([oracle, ...candidates]))
      : candidates;

    const resultsByModel: Record<string, ClassifyResult[]> = {};
    const usageByModel: Record<string, UsageSample[]> = {};
    for (const model of allModels) {
      const { results, usage } = await runModel(model);
      resultsByModel[model] = results;
      usageByModel[model] = usage;
    }

    const reports: Record<string, CandidateReport> = {};
    const oracleResults = mode === "oracle" ? resultsByModel[oracle] : null;

    if (mode === "oracle" && oracleResults) {
      reports[oracle] = scoreCandidate(
        oracle,
        sample,
        oracleResults,
        null,
        false,
        usageByModel[oracle],
        "oracle",
      );
    }

    for (const model of candidates) {
      const referenceFromStored = mode === "agreement";
      reports[model] = scoreCandidate(
        model,
        sample,
        resultsByModel[model],
        oracleResults,
        referenceFromStored,
        usageByModel[model],
        "candidate",
      );
    }

    const pairwise = buildPairwiseMatrix(allModels, resultsByModel);

    const disagreements: Record<string, ReturnType<typeof findDisagreements>> = {};
    if (mode === "oracle" && oracleResults) {
      for (const model of candidates) {
        if (model === oracle) continue;
        disagreements[model] = findDisagreements(
          sample,
          oracleResults,
          resultsByModel[model],
          DISAGREEMENT_LIMIT,
        );
      }
    }

    const report = {
      status: "success",
      source: SOURCE,
      mode,
      oracle: mode === "oracle" ? oracle : null,
      candidates,
      lookback_days: LOOKBACK_DAYS,
      sample_size: sample.length,
      composition,
      stratify,
      eval_minute_limit: evalMinuteLimit ?? null,
      eval_daily_limit: evalDailyLimit ?? null,
      generated_at: new Date().toISOString(),
      sample_ids: sample.map((p) => p.id),
      reports,
      pairwise,
      disagreements,
      note: "Gemini-only historical canary; no public score writes.",
    };

    await persistReport(supabase, report);
    await supabase.from("error_log").insert({
      function_name: SOURCE,
      error_message: `Goldilocks run: mode=${mode}, n=${sample.length}, oracle=${mode === "oracle" ? oracle : "none"}, candidates=${candidates.join(",")}`,
      context: "summary",
    });

    return jsonResponse(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logError(message, "model_eval_error");
    return jsonResponse({ status: "failed", error: message }, 500);
  }
});
