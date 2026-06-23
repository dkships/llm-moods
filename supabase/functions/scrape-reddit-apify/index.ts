import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { abortApifyRun, apifyRunUrl, checkApifyBudget } from "../_shared/apify-budget.ts";
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
import { isLikelyRumorCandidate } from "../_shared/rumor-detect.ts";

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
  "https://www.reddit.com/r/ChatGPTPro/new/",
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

// Extract the bare subreddit name from a configured start_url
// ("https://www.reddit.com/r/grok/new/" -> "grok").
function subredditFromUrl(u: string): string | null {
  const m = u.match(/reddit\.com\/r\/([^/?#]+)/i);
  return m ? m[1] : null;
}

// Bounded-concurrency map: runs `fn` over `items` with at most `limit` in flight.
// Used to fan out one Apify run per subreddit (harshmaur exhausts a single run on
// the first subreddit when comments are on, so one run per subreddit is required
// for even coverage) without serializing the whole window.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
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
    // Subreddits to scrape: bare names parsed from the configured start_urls
    // (fallback to defaults). Reddit killed its public .json API (403 since
    // May 2026), so the old trudax-lite actor returns almost nothing; the
    // configurable HTML-parsing actor below (harshmaur by default, residential
    // proxy) is the bake-off winner. One run PER subreddit — harshmaur exhausts
    // a single run on the first subreddit when comments are on — fanned out with
    // bounded concurrency so the whole window still fits the function budget.
    const startUrls = getConfigValues(config, "start_url");
    const subreddits = Array.from(new Set(
      (startUrls.length > 0 ? startUrls : DEFAULT_START_URLS)
        .map(subredditFromUrl)
        .filter((s): s is string => Boolean(s)),
    ));

    const actorId = getConfigValue(config, "actor_id", "harshmaur/reddit-scraper").replace("/", "~");
    const includeComments = getConfigBoolean(config, "include_comments", true);
    const maxPostsPerSub = getConfigNumber(config, "max_posts_per_sub", 10);
    const maxCommentsPerPost = getConfigNumber(config, "max_comments_per_post", 4);
    const perRunMaxItems = getConfigNumber(config, "per_run_max_items", 90);
    const perRunChargeUsd = getConfigNumber(config, "per_run_charge_usd", 0.25);
    const actorTimeoutSecs = Math.min(getConfigNumber(config, "actor_timeout_secs", APIFY_ACTOR_TIMEOUT_SECS), 180);
    const pollTimeoutSecs = Math.min(getConfigNumber(config, "poll_timeout_secs", APIFY_POLL_TIMEOUT_SECS), 170);
    const concurrency = Math.min(getConfigNumber(config, "actor_concurrency", 4), 8);

    const runForSubreddit = async (sub: string): Promise<{ items: any[]; status: string; usageUsd: number; error?: string }> => {
      try {
        const input = {
          subredditUrls: [`r/${sub}`],
          searchSort: "new",
          maxPostsCount: maxPostsPerSub,
          crawlCommentsPerPost: includeComments,
          maxCommentsPerPost,
          fastMode: true,
          proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
        };
        const startRes = await fetch(apifyRunUrl(actorId, apifyToken, perRunMaxItems, {
          timeoutSecs: actorTimeoutSecs,
          maxTotalChargeUsd: perRunChargeUsd,
        }), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!startRes.ok) {
          const t = await startRes.text().catch(() => "");
          return { items: [], status: `start_${startRes.status}`, usageUsd: 0, error: `r/${sub} start HTTP ${startRes.status}: ${t.slice(0, 160)}` };
        }
        const runData = await startRes.json();
        const runId = runData?.data?.id;
        const datasetId = runData?.data?.defaultDatasetId;
        if (!runId || !datasetId) return { items: [], status: "no_run", usageUsd: 0, error: `r/${sub} missing runId` };

        let status = "";
        let usageUsd = 0;
        const deadline = Date.now() + pollTimeoutSecs * 1000;
        while (Date.now() < deadline) {
          await delay(Math.min(APIFY_POLL_INTERVAL_MS, Math.max(1000, deadline - Date.now())));
          const sRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`);
          if (!sRes.ok) continue;
          const sData = await sRes.json();
          status = sData?.data?.status ?? "";
          usageUsd = sData?.data?.usageTotalUsd ?? usageUsd;
          if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) break;
        }
        if (status && !["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
          await abortApifyRun(apifyToken, runId);
          status = "TIMED-OUT";
        }
        const dRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`);
        const data = dRes.ok ? await dRes.json().catch(() => []) : [];
        const runItems = Array.isArray(data) ? data : [];
        const error = (status !== "SUCCEEDED" && runItems.length === 0) ? `r/${sub}: ${status || "no-status"}, 0 items` : undefined;
        return { items: runItems, status, usageUsd, error };
      } catch (e) {
        return { items: [], status: "error", usageUsd: 0, error: `r/${sub}: ${e instanceof Error ? e.message : String(e)}` };
      }
    };

    const runResults = await mapWithConcurrency(subreddits, concurrency, runForSubreddit);
    const items: any[] = [];
    const runErrors: string[] = [];
    const perSubStatus: Record<string, string> = {};
    let totalUsageUsd = 0;
    for (let i = 0; i < subreddits.length; i++) {
      const r = runResults[i];
      if (r.items.length) items.push(...r.items);
      totalUsageUsd += r.usageUsd || 0;
      perSubStatus[subreddits[i]] = r.status;
      if (r.error) runErrors.push(r.error);
    }
    const apifyUsageSummary = { actor: actorId, subreddits: subreddits.length, per_subreddit_status: perSubStatus, total_usage_usd: Number(totalUsageUsd.toFixed(4)) };
    apifyRunMetadata = apifyUsageSummary;

    const posts = items.filter((item: any) => item.dataType === "post");
    const comments = items.filter((item: any) => item.dataType === "comment");
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
      comments_found: comments.length,
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
      apifyUsage: apifyUsageSummary,
      apifyBudget: budget.usage,
    };
    for (const e of runErrors) summary.errors.push(e);

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
      // Keep rumor candidates (leak/stage/timing chatter) that would otherwise be
      // dropped as announcement-shaped — the rumor radar reads them; the classifier
      // still marks pure announcements `irrelevant`, so vibes scores are unaffected.
      if (isLikelyNonExperienceShare(title, bodyText) && !isLikelyRumorCandidate(title, bodyText)) {
        summary.contentSkipped++;
        continue;
      }

      const matchedSlugs = matchModels(fullText, keywords, SUBREDDIT_MODEL_MAP, post.communityName);
      if (matchedSlugs.length === 0) continue;
      summary.filtered_candidates++;

      const sourceUrl = post.postUrl || post.url || "";
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

    // Comment ingestion: each scraped comment becomes its own scraped_posts row.
    // Comments carry the bulk of the quality-sentiment signal ("anyone else seeing
    // Claude get worse?" pile-ons), capped per post upstream (maxCommentsPerPost).
    // Comments rarely name the model, so attribution leans on the subreddit via
    // SUBREDDIT_MODEL_MAP with keyword fallback. Dedup is by a unique per-comment
    // URL so many comments on one post don't collide. content_type "comment" gets
    // full scoring weight (only "title_only" is down-weighted).
    for (const c of comments) {
      const createdAt = new Date(c.createdAt);
      if (Number.isNaN(createdAt.getTime()) || createdAt < cutoff) continue;

      const bodyText = (c.body || "").trim();
      if (bodyText.length < 20) { summary.contentSkipped++; continue; }
      if (isLikelyNonExperienceShare("", bodyText) && !isLikelyRumorCandidate("", bodyText)) { summary.contentSkipped++; continue; }

      const community = c.communityName || c.parsedCommunityName || "";
      const matchedSlugs = matchModels(bodyText, keywords, SUBREDDIT_MODEL_MAP, community);
      if (matchedSlugs.length === 0) continue;
      summary.filtered_candidates++;

      // Unique per-comment URL so multiple comments on the same post don't dedup-collide.
      const baseUrl = c.commentUrl || c.permalink || c.url || c.postUrl || "";
      const commentId = c.id != null ? String(c.id) : "";
      const commentUrl = baseUrl
        ? (commentId && !baseUrl.includes(commentId) ? `${baseUrl}#${commentId}` : baseUrl)
        : "";
      if (!commentUrl || existingUrls.has(commentUrl)) { summary.duplicateSkipped++; continue; }

      for (const slug of matchedSlugs) {
        const modelId = modelMap[slug];
        if (!modelId) continue;
        const upsertResult = await upsertPendingScrapedPost(supabase, {
          model_id: modelId,
          source: "reddit",
          source_url: commentUrl,
          title: null,
          content: bodyText.slice(0, 2000),
          content_type: "comment",
          score: c.upVotes || c.score || 0,
          posted_at: c.createdAt,
        });
        if (upsertResult.error) { summary.errors.push(`Comment insert: ${upsertResult.error}`); continue; }
        if (upsertResult.inserted) {
          summary.net_new_rows++;
          summary.classificationQueued++;
          existingUrls.add(commentUrl);
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
    // returned but none parse as a post or comment) without us having to predict it.
    if (summary.apify_items_fetched === 0) {
      summary.errors.push("Apify returned 0 items - actor crawl produced no data (possible block/outage)");
    } else if (summary.posts_found === 0 && summary.comments_found === 0) {
      summary.errors.push(`Apify returned ${summary.apify_items_fetched} items but 0 parsed as posts/comments - possible actor output schema change`);
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
        comments_found: summary.comments_found,
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
      `Completed: posts=${summary.posts_found} comments=${summary.comments_found} filtered=${summary.filtered_candidates} inserted=${summary.net_new_rows} duplicateConflicts=${summary.duplicate_conflicts}`,
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
