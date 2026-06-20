import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { abortApifyRun, apifyRunUrl, checkApifyBudget, scrubApifyRun } from "../_shared/apify-budget.ts";
import {
  createRunRecord,
  deriveRunMetrics,
  getConfigBoolean,
  getConfigNumber,
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
  loadKeywords,
  matchModels,
  meetsMinLength,
  loadRecentTitleKeys,
  isDuplicate,
  isLikelyNonExperienceShare,
  logToErrorLog,
  logZeroDataWarning,
  upsertPendingScrapedPost,
} from "../_shared/utils.ts";

const SOURCE = "scrape-reddit-apify";
const APIFY_ACTOR_TIMEOUT_SECS = 120;
const APIFY_POLL_TIMEOUT_SECS = 105;
const APIFY_POLL_INTERVAL_MS = 10_000;
const APIFY_MAX_TOTAL_CHARGE_USD = 0.35;

const DEFAULT_START_URLS = [
  "https://www.reddit.com/r/ClaudeAI/new/",
  "https://www.reddit.com/r/ClaudeCode/new/",
  "https://www.reddit.com/r/ChatGPT/new/",
  "https://www.reddit.com/r/OpenAI/new/",
  "https://www.reddit.com/r/GoogleGemini/new/",
  "https://www.reddit.com/r/GeminiAI/new/",
  "https://www.reddit.com/r/GoogleGeminiAI/new/",
  "https://www.reddit.com/r/grok/new/",
  "https://www.reddit.com/r/LocalLLaMA/new/",
  "https://www.reddit.com/r/artificial/new/",
];

const SUBREDDIT_MODEL_MAP: Record<string, string> = {
  "r/ClaudeAI": "claude",
  "r/claudeai": "claude",
  "r/ClaudeCode": "claude",
  "r/claudecode": "claude",
  "r/ChatGPT": "chatgpt",
  "r/chatgpt": "chatgpt",
  "r/OpenAI": "chatgpt",
  "r/openai": "chatgpt",
  "r/GoogleGemini": "gemini",
  "r/googlegemini": "gemini",
  "r/GeminiAI": "gemini",
  "r/geminiai": "gemini",
  "r/GoogleGeminiAI": "gemini",
  "r/googlegeminiai": "gemini",
  "r/grok": "grok",
  "r/Grok": "grok",
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleScrapeRedditApify(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req)
    && !isRunPipelineTriggerRequest(req)
    && !isSchedulerRequest(body, "scrape-reddit-apify")
  ) {
    return internalOnlyResponse(corsHeaders);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let runRecord: RunRecordRow | null = null;
  let apifyRunMetadata: Record<string, unknown> | null = null;

  try {
    const config = await loadScraperConfig(supabase, SOURCE);
    if (!getConfigBoolean(config, "enabled", true)) {
      return new Response(JSON.stringify({
        source: SOURCE,
        status: "skipped",
        skipped: true,
        reason: "disabled",
        errors: [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const startedAt = new Date().toISOString();
    const { data: startedRun, error: runError } = await createRunRecord(supabase, {
      source: SOURCE,
      run_kind: "scraper",
      status: "running",
      parent_run_id: typeof body.parent_run_id === "string" ? body.parent_run_id : null,
      triggered_by: body.orchestrated ? "orchestrator" : "manual",
      window_label: typeof body.window_label === "string" ? body.window_label : null,
      window_local_date: typeof body.window_local_date === "string" ? body.window_local_date : null,
      timezone: typeof body.timezone === "string" ? body.timezone : null,
      started_at: startedAt,
    });

    if (runError) {
      if (isUniqueViolation(runError)) {
        return new Response(JSON.stringify({
          source: SOURCE,
          status: "skipped",
          skipped: true,
          reason: "already_running",
          errors: [],
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw runError;
    }
    runRecord = startedRun;

    const apifyToken = Deno.env.get("APIFY_API_TOKEN");
    if (!apifyToken) {
      await logToErrorLog(supabase, SOURCE, "APIFY_API_TOKEN not configured", "config-error");
      throw new Error("APIFY_API_TOKEN not configured");
    }

    await logToErrorLog(supabase, SOURCE, "Reddit Apify scraper started", "health-check");
    const budget = await checkApifyBudget(apifyToken, APIFY_MAX_TOTAL_CHARGE_USD);
    if (!budget.allowed) {
      const skipped = {
        source: SOURCE,
        status: "skipped",
        skipped: true,
        reason: budget.reason,
        errors: [`Apify budget guard skipped run: ${budget.reason}`],
        apify_budget: budget.usage,
      };
      await updateRunRecord(supabase, runRecord!.id, {
        status: "skipped",
        errors: skipped.errors,
        metadata: { reason: skipped.reason, apify_budget: budget.usage },
        completed_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify(skipped), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { modelMap, keywords } = await loadKeywords(supabase);
    const startUrls = getConfigValues(config, "start_url");
    const apifyInput = {
      startUrls: (startUrls.length > 0 ? startUrls : DEFAULT_START_URLS).map((url) => ({ url })),
      skipComments: true,
      maxItems: getConfigNumber(config, "max_items", 25),
      maxPostCount: getConfigNumber(config, "max_post_count", 8),
    };
    const actorTimeoutSecs = Math.min(
      getConfigNumber(config, "actor_timeout_secs", APIFY_ACTOR_TIMEOUT_SECS),
      180,
    );
    const pollTimeoutSecs = Math.min(
      getConfigNumber(config, "poll_timeout_secs", APIFY_POLL_TIMEOUT_SECS),
      150,
    );

    const startRes = await fetch(apifyRunUrl("trudax~reddit-scraper-lite", apifyToken, apifyInput.maxItems, {
      timeoutSecs: actorTimeoutSecs,
      maxTotalChargeUsd: APIFY_MAX_TOTAL_CHARGE_USD,
    }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apifyInput),
    });

    if (!startRes.ok) {
      const errorText = await startRes.text().catch(() => "unknown");
      await logToErrorLog(supabase, SOURCE, `Apify start failed HTTP ${startRes.status}: ${errorText.slice(0, 500)}`, "apify-error");
      if (startRes.status === 402 || startRes.status === 403) {
        const skipped = {
          source: SOURCE,
          status: "skipped",
          skipped: true,
          reason: `quota_or_auth_${startRes.status}`,
          errors: [`Apify quota/auth error (HTTP ${startRes.status})`],
        };
        await updateRunRecord(supabase, runRecord!.id, {
          status: "skipped",
          errors: skipped.errors,
          metadata: { reason: skipped.reason },
          completed_at: new Date().toISOString(),
        });
        return new Response(JSON.stringify(skipped), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Apify start returned ${startRes.status}`);
    }

    const runData = await startRes.json();
    const apifyRunId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;
    apifyRunMetadata = scrubApifyRun(runData.data);
    if (!apifyRunId || !datasetId) {
      await logToErrorLog(supabase, SOURCE, "No runId/datasetId", "apify-error");
      throw new Error("Missing runId from Apify");
    }

    let runStatus = "";
    let terminalRunData: any = null;
    const pollDeadline = Date.now() + pollTimeoutSecs * 1000;
    while (Date.now() < pollDeadline) {
      await delay(Math.min(APIFY_POLL_INTERVAL_MS, Math.max(1, pollDeadline - Date.now())));
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}?token=${apifyToken}`);
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();
      runStatus = statusData.data?.status || "";
      if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(runStatus)) {
        terminalRunData = statusData.data;
        apifyRunMetadata = scrubApifyRun(terminalRunData);
        break;
      }
    }

    let apifyRunWarning: string | null = null;
    if (runStatus !== "SUCCEEDED") {
      let errorDetail = "";
      if (!runStatus) {
        const abortMetadata = await abortApifyRun(apifyToken, apifyRunId);
        apifyRunMetadata = abortMetadata ?? apifyRunMetadata;
        runStatus = "TIMED-OUT";
      }
      try {
        const detailRes = await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}?token=${apifyToken}`);
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          apifyRunMetadata = scrubApifyRun(detailData.data);
          errorDetail = detailData.data?.statusMessage || detailData.data?.exitCode || "";
        }
      } catch {}
      await logToErrorLog(supabase, SOURCE, `Apify run status: ${runStatus || "TIMEOUT"} detail: ${errorDetail}`, "apify-error");
      const message = `Apify run status: ${runStatus || "TIMEOUT"}${errorDetail ? ` (${errorDetail})` : ""}`;
      apifyRunWarning = message;
    }

    const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`);
    if (!datasetRes.ok) throw new Error("Failed to fetch dataset");

    const items = await datasetRes.json();
    if (!Array.isArray(items)) throw new Error("Invalid dataset response");

    const posts = items.filter((item: any) => item.dataType === "post");
    const { data: existingData } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", "reddit")
      .limit(10000);
    const existingUrls = new Set((existingData || []).map((entry: any) => entry.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const cutoff = new Date(Date.now() - 24 * 3600000);
    const summary = {
      source: SOURCE,
      backend: "apify",
      apify_items_fetched: items.length,
      posts_found: posts.length,
      filtered_candidates: 0,
      classified: 0,
      net_new_rows: 0,
      duplicate_conflicts: 0,
      irrelevant: 0,
      classifierErrors: 0,
      classifierRequestErrors: 0,
      classifierQuotaDeferred: 0,
      classificationQueued: 0,
      classification_success: 0,
      duplicateSkipped: 0,
      dedupSkipped: 0,
      contentSkipped: 0,
      errors: [] as string[],
      apifyUsage: scrubApifyRun(terminalRunData),
      apifyBudget: budget.usage,
    };
    if (apifyRunWarning) summary.errors.push(`${apifyRunWarning}; salvaged dataset items when available`);

    const candidates: {
      fullText: string;
      matchedSlugs: string[];
      sourceUrl: string;
      title: string;
      body: string;
      score: number;
      createdAt: string;
    }[] = [];

    for (const post of posts) {
      const createdAt = new Date(post.createdAt);
      if (Number.isNaN(createdAt.getTime()) || createdAt < cutoff) continue;

      const title = post.title || "";
      const bodyText = post.body || "";
      const fullText = `${title} ${bodyText}`;

      if (!meetsMinLength(title, bodyText)) {
        summary.contentSkipped++;
        continue;
      }
      if (isLikelyNonExperienceShare(title, bodyText)) {
        summary.contentSkipped++;
        continue;
      }

      const matchedSlugs = matchModels(fullText, keywords, SUBREDDIT_MODEL_MAP, post.communityName);
      if (matchedSlugs.length === 0) continue;
      summary.filtered_candidates++;

      const sourceUrl = post.url || "";
      if (!sourceUrl || existingUrls.has(sourceUrl)) {
        summary.duplicateSkipped++;
        continue;
      }

      let allDuped = true;
      for (const slug of matchedSlugs) {
        const modelId = modelMap[slug];
        if (modelId && !isDuplicate(titleKeys, title, modelId)) {
          allDuped = false;
          break;
        }
      }
      if (allDuped) {
        summary.dedupSkipped++;
        continue;
      }

      candidates.push({
        fullText,
        matchedSlugs,
        sourceUrl,
        title,
        body: bodyText,
        score: post.upVotes || 0,
        createdAt: post.createdAt,
      });
    }

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      for (const slug of candidate.matchedSlugs) {
        const modelId = modelMap[slug];
        if (!modelId || isDuplicate(titleKeys, candidate.title, modelId)) continue;

        const upsertResult = await upsertPendingScrapedPost(supabase, {
          model_id: modelId,
          source: "reddit",
          source_url: candidate.sourceUrl,
          title: candidate.title.slice(0, 120),
          content: (candidate.body || candidate.title).slice(0, 2000),
          content_type: candidate.body ? "title_and_body" : "title_only",
          score: candidate.score,
          posted_at: candidate.createdAt,
        });

        if (upsertResult.error) {
          summary.errors.push(`Insert: ${upsertResult.error}`);
          continue;
        }

        if (upsertResult.inserted) {
          summary.net_new_rows++;
          summary.classificationQueued++;
          existingUrls.add(candidate.sourceUrl);
          titleKeys.add(`${modelId}:${candidate.title.slice(0, 80).toLowerCase()}`);
        } else {
          summary.duplicate_conflicts++;
        }
      }
    }

    // A run that crawled nothing usable must not resolve as "success". When
    // Reddit 403-blocked the old actor (May 29-31), the actor still returned a
    // clean SUCCEEDED status with 0 posts, so deriveRunMetrics (which only
    // downgrades on a non-empty errors[]) kept marking the run "success" and a
    // 3-day ingest outage stayed invisible. Surface the zero-yield case as an
    // error so the run is downgraded to failed and the watchdog's stale-scraper
    // check can fire. Also catches a future actor output-schema change (items
    // returned but none parse as posts) without us having to predict it.
    if (summary.apify_items_fetched === 0) {
      summary.errors.push("Apify returned 0 items - actor crawl produced no data (possible block/outage)");
    } else if (summary.posts_found === 0) {
      summary.errors.push(`Apify returned ${summary.apify_items_fetched} items but 0 parsed as posts - possible actor output schema change`);
    }

    const derived = deriveRunMetrics(summary);
    const completedAt = new Date().toISOString();
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
        backend: "apify",
        duplicate_skipped: summary.duplicateSkipped,
        dedup_skipped: summary.dedupSkipped,
        content_skipped: summary.contentSkipped,
        irrelevant: summary.irrelevant,
        classifier_errors: summary.classifierErrors,
        classifier_request_errors: summary.classifierRequestErrors,
        classifier_quota_deferred: summary.classifierQuotaDeferred,
        classification_success: summary.classification_success,
        classification_queued: summary.classificationQueued,
        apify_usage: summary.apifyUsage,
        apify_budget: summary.apifyBudget,
      },
      completed_at: completedAt,
    });

    await logToErrorLog(
      supabase,
      SOURCE,
      `Completed: posts=${summary.posts_found} filtered=${summary.filtered_candidates} classified=${summary.classified} inserted=${summary.net_new_rows} duplicateConflicts=${summary.duplicate_conflicts}`,
      "summary",
    );
    await logZeroDataWarning(supabase, SOURCE, summary.posts_found);

    const responseBody = {
      ...summary,
      classification_queued: summary.classificationQueued,
      status: derived.status,
      posts_classified: derived.posts_classified,
    };

    return new Response(JSON.stringify(responseBody, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown";
    await logToErrorLog(supabase, SOURCE, message, "top-level error");
    if (runRecord) {
      await updateRunRecord(supabase, runRecord!.id, {
        status: "failed",
        errors: [message],
        metadata: { error: message, apify_usage: apifyRunMetadata },
        completed_at: new Date().toISOString(),
      });
    }
    return new Response(JSON.stringify({ source: SOURCE, status: "failed", error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

if (import.meta.main) {
  Deno.serve(handleScrapeRedditApify);
}
