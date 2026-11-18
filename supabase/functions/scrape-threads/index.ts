import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  abortApifyRun,
  apifyDatasetItemsUrl,
  apifyRunUrl,
  checkApifyBudget,
  scrubApifyRun,
  withLedgerCost,
} from "../_shared/apify-budget.ts";
import {
  createRunRecord,
  deriveRunMetrics,
  getConfigBoolean,
  getConfigNumber,
  getConfigValue,
  getConfigValues,
  internalOnlyResponse,
  isInternalServiceRequest,
  isRunPipelineTriggerRequest,
  isSchedulerRequest,
  isUniqueViolation,
  loadScraperConfig,
  readJsonBody,
  type RunRecordRow,
  updateRunRecord,
} from "../_shared/runtime.ts";
import {
  corsHeaders,
  isDuplicate,
  isLikelyNonExperienceShare,
  type KeywordEntry,
  loadKeywords,
  loadNoisyAuthors,
  loadRecentTitleKeys,
  logToErrorLog,
  logZeroDataWarning,
  matchModels,
  meetsMinLength,
  upsertPendingScrapedPost,
} from "../_shared/utils.ts";
import { isRumorOrReleaseCandidate } from "../_shared/rumor-detect.ts";

// Threads keyword search through Apify (added 2026-11-17). Meta's own keyword
// search API needs app review; this actor reads what a logged-out visitor sees:
// one page of 20-25 posts per query and result type.
const SOURCE = "scrape-threads";
const POST_SOURCE = "threads";
// Deploy-verification marker, written into scraper_runs.metadata. Bump on change.
const CODE_VERSION = "2026-11-17.1";

// lergassy/threads-scraper: $0.002/post ($0.0018 on the Starter tier), no
// start fee on normal runs, 99.8% of 18k public runs succeeded in the 30 days
// to 2026-11-17. Config-driven via scraper_config.actor_id.
const DEFAULT_ACTOR_ID = "lergassy/threads-scraper";
const APIFY_MAX_TOTAL_CHARGE_USD = 0.3;
const RUN_TIMEOUT_SECS = 240;
const POLL_INTERVAL_MS = 10000;
const MAX_POLLS = 24;
const TERMINAL_STATUSES = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];
const RECENT_HOURS = 48;
const HOUR_MS = 3600000;

// Same shape as the Bluesky terms. Single words search best on Threads;
// for a phrase the actor searches each word and keeps posts with all of them.
// Bare "Gemini" is mostly astrology there.
const DEFAULT_SEARCH_TERMS = ["ChatGPT", "Claude AI", "Claude Code", "Gemini AI", "Grok"];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Recent page only, exact wording only, and only posts that contain the
// keyword: the actor's defaults (top + recent + tags, expanded wordings) cost
// several times more posts per term.
function buildActorInput(searchTerms: string[], maxPostsPerTerm: number, monitoringStore: string) {
  return {
    mode: "search",
    keywords: searchTerms,
    searchTypes: ["recent"],
    expandQueries: false,
    strictKeywordMatch: true,
    maxPosts: maxPostsPerTerm,
    maxItems: maxPostsPerTerm * searchTerms.length,
    postedAfter: isoDay(new Date(Date.now() - RECENT_HOURS * HOUR_MS)),
    includeViews: false,
    includeRunSummary: false,
    // Named store: later runs return only posts earlier runs did not deliver,
    // so overlapping pages are not billed twice.
    ...(monitoringStore ? { monitoringStoreName: monitoringStore } : {}),
  };
}

function buildThreadsSummary() {
  return {
    source: SOURCE,
    backend: "apify",
    apify_items_fetched: 0,
    posts_found: 0,
    filtered_candidates: 0,
    classified: 0,
    classification_success: 0,
    net_new_rows: 0,
    duplicate_conflicts: 0,
    irrelevant: 0,
    classifierErrors: 0,
    classifierRequestErrors: 0,
    classifierQuotaDeferred: 0,
    classificationQueued: 0,
    dedupSkipped: 0,
    contentSkipped: 0,
    noisyAuthorSkipped: 0,
    staleSkipped: 0,
    termHits: {} as Record<string, number>,
    languages: {} as Record<string, number>,
    errors: [] as string[],
  };
}

type ThreadsSummary = ReturnType<typeof buildThreadsSummary> & {
  actorId?: string;
  apifyUsage?: unknown;
  apifyBudget?: unknown;
  reason?: string;
};

function ledgerUsage(summary: ThreadsSummary) {
  return withLedgerCost(summary.apifyUsage, summary.actorId ?? DEFAULT_ACTOR_ID, summary.apify_items_fetched, APIFY_MAX_TOTAL_CHARGE_USD);
}

function countInto(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

// Starts the run, waits for it, and returns the dataset rows, or null when
// the run did not succeed (already logged, with usage recorded for the ledger).
async function fetchActorRows(summary: ThreadsSummary, supabase: any, apifyToken: string, input: ReturnType<typeof buildActorInput>) {
  const actorId = summary.actorId ?? DEFAULT_ACTOR_ID;
  const startRes = await fetch(apifyRunUrl(actorId.replace("/", "~"), apifyToken, input.maxItems, {
    timeoutSecs: RUN_TIMEOUT_SECS,
    maxTotalChargeUsd: APIFY_MAX_TOTAL_CHARGE_USD,
  }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!startRes.ok) {
    const errorText = await startRes.text().catch(() => "unknown");
    await logToErrorLog(supabase, SOURCE, `Apify start failed HTTP ${startRes.status}: ${errorText.slice(0, 500)}`, "apify-error");
    throw new Error(`Apify start returned ${startRes.status}`);
  }

  const runData = await startRes.json();
  const runId = runData.data?.id;
  const datasetId = runData.data?.defaultDatasetId;
  summary.apifyUsage = scrubApifyRun(runData.data);
  if (!runId || !datasetId) {
    throw new Error("Missing runId from Apify");
  }

  let runStatus = "";
  let terminalRun: unknown = null;
  for (let i = 0; i < MAX_POLLS; i++) {
    await delay(POLL_INTERVAL_MS);
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`);
    if (!statusRes.ok) {
      continue;
    }
    const statusData = await statusRes.json();
    runStatus = statusData.data?.status || "";
    if (TERMINAL_STATUSES.includes(runStatus)) {
      terminalRun = statusData.data;
      summary.apifyUsage = scrubApifyRun(terminalRun);
      break;
    }
  }

  if (runStatus !== "SUCCEEDED") {
    if (!terminalRun) {
      summary.apifyUsage = await abortApifyRun(apifyToken, runId) ?? summary.apifyUsage;
      runStatus = "TIMED-OUT";
    }
    const detail = (terminalRun as { statusMessage?: string } | null)?.statusMessage ?? "";
    await logToErrorLog(supabase, SOURCE, `Apify run status: ${runStatus} detail: ${detail}`, "apify-error");
    summary.errors.push(`Apify run ${runStatus}: ${detail}`);
    return null;
  }

  const datasetRes = await fetch(apifyDatasetItemsUrl(datasetId, apifyToken, { limit: input.maxItems }));
  if (!datasetRes.ok) {
    throw new Error("Failed to fetch Apify dataset");
  }
  const rows = await datasetRes.json();
  if (!Array.isArray(rows)) {
    throw new Error("Invalid dataset response");
  }
  return rows;
}

async function runApifyPath(
  summary: ThreadsSummary,
  supabase: any,
  apifyToken: string,
  modelMap: Record<string, string>,
  keywords: KeywordEntry[],
  existingUrls: Set<string>,
  titleKeys: Set<string>,
  config: Record<string, string[]>,
): Promise<ThreadsSummary> {
  const configuredTerms = getConfigValues(config, "search_term");
  const searchTerms = configuredTerms.length > 0 ? configuredTerms : DEFAULT_SEARCH_TERMS;
  summary.actorId = getConfigValue(config, "actor_id", DEFAULT_ACTOR_ID);
  const input = buildActorInput(
    searchTerms,
    getConfigNumber(config, "max_posts_per_term", 25),
    getConfigValue(config, "monitoring_store", "llm-vibes-threads") ?? "",
  );

  const budget = await checkApifyBudget(supabase, APIFY_MAX_TOTAL_CHARGE_USD);
  summary.apifyBudget = budget.usage;
  if (!budget.allowed) {
    summary.reason = budget.reason;
    summary.errors.push(`Apify budget guard skipped run: ${budget.reason}`);
    return { ...summary, status: "skipped", skipped: true } as ThreadsSummary;
  }

  const rawRows = await fetchActorRows(summary, supabase, apifyToken, input);
  if (!rawRows) {
    return summary;
  }

  const posts = rawRows.filter((row: any) => row.type === "post" && typeof row.text === "string" && row.text);
  summary.apify_items_fetched = rawRows.length;
  summary.posts_found = posts.length;

  const noisyAuthors = await loadNoisyAuthors(supabase, POST_SOURCE);
  const cutoff = Date.now() - RECENT_HOURS * HOUR_MS;

  for (const post of posts) {
    countInto(summary.termHits, String(post.query ?? "unknown"));
    countInto(summary.languages, String(post.language ?? post.languageGuess ?? "unknown"));
    if (post.isRepost) {
      continue;
    }

    const createdMs = new Date(post.createdAt).getTime();
    if (!Number.isFinite(createdMs) || createdMs < cutoff) {
      summary.staleSkipped++;
      continue;
    }

    const text = String(post.text).slice(0, 2000);
    const rumorCandidate = isRumorOrReleaseCandidate(text, "");
    if (!meetsMinLength(text, "") || (isLikelyNonExperienceShare(text, "") && !rumorCandidate)) {
      summary.contentSkipped++;
      continue;
    }

    const authorHandle = typeof post.username === "string" ? post.username : null;
    if (authorHandle && noisyAuthors.has(authorHandle) && !rumorCandidate) {
      summary.noisyAuthorSkipped++;
      continue;
    }

    const matchedSlugs = matchModels(text, keywords);
    if (matchedSlugs.length === 0) {
      continue;
    }
    summary.filtered_candidates++;

    const sourceUrl = typeof post.url === "string" ? post.url : "";
    if (!sourceUrl || existingUrls.has(sourceUrl)) {
      summary.dedupSkipped++;
      continue;
    }

    for (const slug of matchedSlugs) {
      const modelId = modelMap[slug];
      if (!modelId || isDuplicate(titleKeys, text.slice(0, 500), modelId)) {
        continue;
      }

      const upsertResult = await upsertPendingScrapedPost(supabase, {
        model_id: modelId,
        source: POST_SOURCE,
        source_url: sourceUrl,
        title: text.slice(0, 120),
        content: text,
        content_type: "full_content",
        score: (Number(post.likeCount) || 0) + (Number(post.repostCount) || 0),
        posted_at: new Date(createdMs).toISOString(),
        author_handle: authorHandle,
        author_verified: Boolean(post.isVerified),
      });

      if (upsertResult.error) {
        summary.errors.push(`Insert: ${upsertResult.error}`);
        continue;
      }
      if (!upsertResult.inserted) {
        summary.duplicate_conflicts++;
        continue;
      }
      summary.net_new_rows++;
      summary.classificationQueued++;
      existingUrls.add(sourceUrl);
      titleKeys.add(`${modelId}:${text.slice(0, 80).toLowerCase()}`);
    }
  }

  return summary;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleScrapeThreads(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req)
    && !isRunPipelineTriggerRequest(req)
    && !await isSchedulerRequest(body, SOURCE)
  ) {
    return internalOnlyResponse(corsHeaders);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let runRecord: RunRecordRow | null = null;
  const summary: ThreadsSummary = buildThreadsSummary();

  try {
    const config = await loadScraperConfig(supabase, SOURCE);
    if (!getConfigBoolean(config, "enabled", true)) {
      return jsonResponse({ source: SOURCE, status: "skipped", skipped: true, reason: "disabled", errors: [] });
    }

    const apifyToken = Deno.env.get("APIFY_API_TOKEN");
    if (!apifyToken) {
      return jsonResponse({ source: SOURCE, status: "skipped", skipped: true, reason: "no_credentials", errors: [] });
    }

    const { data: startedRun, error: runError } = await createRunRecord(supabase, {
      source: SOURCE,
      run_kind: "scraper",
      status: "running",
      parent_run_id: null,
      triggered_by: "manual",
      window_label: null,
      window_local_date: null,
      timezone: null,
      started_at: new Date().toISOString(),
    });
    if (runError) {
      if (isUniqueViolation(runError)) {
        return jsonResponse({ source: SOURCE, status: "skipped", skipped: true, reason: "already_running", errors: [] });
      }
      throw runError;
    }
    runRecord = startedRun;

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existingData } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", POST_SOURCE)
      .limit(10000);
    const existingUrls = new Set<string>((existingData || []).map((entry: any) => String(entry.source_url ?? "")).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const result = await runApifyPath(summary, supabase, apifyToken, modelMap, keywords, existingUrls, titleKeys, config);

    const derived = deriveRunMetrics(result);
    await updateRunRecord(supabase, runRecord!.id, {
      status: derived.status,
      posts_found: derived.posts_found,
      posts_classified: derived.posts_classified,
      apify_items_fetched: derived.apify_items_fetched,
      filtered_candidates: derived.filtered_candidates,
      net_new_rows: derived.net_new_rows,
      duplicate_conflicts: derived.duplicate_conflicts,
      errors: derived.errors,
      metadata: {
        backend: result.backend,
        classification_queued: result.classificationQueued,
        apify_usage: ledgerUsage(result),
        apify_budget: result.apifyBudget ?? null,
        code_version: CODE_VERSION,
        actor_id: result.actorId ?? null,
        dedup_skipped: result.dedupSkipped,
        content_skipped: result.contentSkipped,
        noisy_author_skipped: result.noisyAuthorSkipped,
        stale_skipped: result.staleSkipped,
        term_hits: result.termHits,
        languages: result.languages,
        skipped_reason: result.reason ?? null,
      },
      completed_at: new Date().toISOString(),
    });

    await logToErrorLog(
      supabase,
      SOURCE,
      `Completed (apify): fetched=${result.posts_found} filtered=${result.filtered_candidates} inserted=${result.net_new_rows} duplicateConflicts=${result.duplicate_conflicts}`,
      "summary",
    );
    await logZeroDataWarning(supabase, SOURCE, result.posts_found);

    return jsonResponse({ ...result, code_version: CODE_VERSION, status: derived.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown";
    await logToErrorLog(supabase, SOURCE, message, "top-level error");
    if (runRecord) {
      await updateRunRecord(supabase, runRecord!.id, {
        status: "failed",
        errors: [message],
        metadata: { error: message, apify_usage: ledgerUsage(summary), code_version: CODE_VERSION },
        completed_at: new Date().toISOString(),
      });
    }
    return jsonResponse({ source: SOURCE, status: "failed", error: message }, 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleScrapeThreads);
}
