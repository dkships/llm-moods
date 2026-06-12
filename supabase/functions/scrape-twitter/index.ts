import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { abortApifyRun, apifyRunUrl, checkApifyBudget, scrubApifyRun } from "../_shared/apify-budget.ts";
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
  type KeywordEntry,
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

const SOURCE = "scrape-twitter";
const APIFY_MAX_TOTAL_CHARGE_USD = 0.15;
const DEFAULT_SEARCH_TERMS = [
  `("claude" OR "claude ai" OR "claude code" OR anthropic OR "chatgpt" OR "chat gpt" OR "openai gpt" OR openai OR "gemini" OR "google gemini" OR "gemini ai" OR "grok" OR "grok ai" OR "xai grok") lang:en -filter:retweets`,
];

const GROK_SEARCH_PROMPT = `Search X/Twitter for recent posts (last 24 hours) about these AI models: Claude, ChatGPT, GPT-4, GPT-4o, Gemini, Grok.

Find posts where users share their direct experience with these models — complaints, praise, comparisons of output quality, etc.

For EACH relevant post found, classify it and return a JSON array. Each element:
{
  "text": "the tweet text",
  "tweet_url": "https://x.com/user/status/123",
  "model": "claude|chatgpt|gemini|grok",
  "sentiment": "positive|negative|neutral",
  "complaint_category": "lazy_responses|hallucinations|refusals|coding_quality|speed|general_drop|pricing_value|censorship|context_window|api_reliability|multimodal_quality|reasoning" or null,
  "praise_category": "output_quality|coding_quality|speed|reasoning|creativity|value|reliability|context_handling|multimodal_quality|general_improvement" or null,
  "confidence": 0.0-1.0,
  "posted_at": "ISO date string"
}

Skip posts that are just news, funding announcements, tutorials, or opinions about AI in general.
Return ONLY the JSON array, no other text.`;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTwitterSummary(backend: "apify" | "grok") {
  return {
    source: SOURCE,
    backend,
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
    errors: [] as string[],
  };
}

async function runApifyPath(
  supabase: any,
  apifyToken: string,
  modelMap: Record<string, string>,
  keywords: KeywordEntry[],
  existingUrls: Set<string>,
  titleKeys: Set<string>,
  config: Record<string, string[]>,
) {
  const summary = buildTwitterSummary("apify");
  const searchTerms = getConfigValues(config, "search_term");
  const apifyInput = {
    searchTerms: searchTerms.length > 0 ? searchTerms : DEFAULT_SEARCH_TERMS,
    sort: getConfigValue(config, "sort_mode", "Latest"),
    maxItems: getConfigNumber(config, "max_items", 50),
  };
  const budget = await checkApifyBudget(apifyToken, APIFY_MAX_TOTAL_CHARGE_USD);
  if (!budget.allowed) {
    return {
      ...summary,
      status: "skipped",
      skipped: true,
      reason: budget.reason,
      errors: [`Apify budget guard skipped run: ${budget.reason}`],
      apifyBudget: budget.usage,
    };
  }

  const startRes = await fetch(apifyRunUrl("apidojo~tweet-scraper", apifyToken, apifyInput.maxItems, {
    timeoutSecs: 180,
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
      return {
        ...summary,
        status: "skipped",
        skipped: true,
        reason: `quota_or_auth_${startRes.status}`,
        errors: [`Apify quota/auth error (HTTP ${startRes.status})`],
      };
    }
    throw new Error(`Apify start returned ${startRes.status}`);
  }

  const runData = await startRes.json();
  const apifyRunId = runData.data?.id;
  const datasetId = runData.data?.defaultDatasetId;
  (summary as any).apifyUsage = scrubApifyRun(runData.data);
  if (!apifyRunId || !datasetId) {
    await logToErrorLog(supabase, SOURCE, "No runId/datasetId from Apify", "apify-error");
    throw new Error("Missing runId from Apify");
  }

  let runStatus = "";
  let terminalRunData: any = null;
  for (let i = 0; i < 18; i++) {
    await delay(10000);
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}?token=${apifyToken}`);
    if (!statusRes.ok) continue;
    const statusData = await statusRes.json();
    runStatus = statusData.data?.status || "";
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(runStatus)) {
      terminalRunData = statusData.data;
      (summary as any).apifyUsage = scrubApifyRun(terminalRunData);
      break;
    }
  }

  if (runStatus !== "SUCCEEDED") {
    let errorDetail = "";
    if (!runStatus) {
      const abortMetadata = await abortApifyRun(apifyToken, apifyRunId);
      (summary as any).apifyUsage = abortMetadata ?? (summary as any).apifyUsage;
      runStatus = "TIMED-OUT";
    }
    try {
      const detailRes = await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}?token=${apifyToken}`);
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        (summary as any).apifyUsage = scrubApifyRun(detailData.data);
        errorDetail = detailData.data?.statusMessage || detailData.data?.exitCode || "";
      }
    } catch {}
    await logToErrorLog(supabase, SOURCE, `Apify run status: ${runStatus || "TIMEOUT"} detail: ${errorDetail}`, "apify-error");
    return {
      ...summary,
      errors: [`Apify run ${runStatus || "TIMEOUT"}: ${errorDetail}`],
    };
  }

  const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`);
  if (!datasetRes.ok) throw new Error("Failed to fetch Apify dataset");

  const rawItems = await datasetRes.json();
  if (!Array.isArray(rawItems)) throw new Error("Invalid dataset response");

  const items = rawItems.filter((item: any) => item.text || item.full_text);
  summary.apify_items_fetched = rawItems.length;
  summary.posts_found = items.length;
  (summary as any).apifyUsage = scrubApifyRun(terminalRunData);
  (summary as any).apifyBudget = budget.usage;
  await logToErrorLog(supabase, SOURCE, `Apify raw=${rawItems.length} tweets=${items.length}`, "apify-debug");

  const cutoff = new Date(Date.now() - 24 * 3600000);
  const candidates: {
    text: string;
    matchedSlugs: string[];
    sourceUrl: string;
    title: string;
    createdAt: string;
    engagementScore: number;
  }[] = [];
  const unmatchedSamples: string[] = [];

  for (const tweet of items) {
    if (tweet.isRetweet || tweet.is_retweet) continue;

    const createdAt = new Date(tweet.created_at || tweet.createdAt);
    if (Number.isNaN(createdAt.getTime()) || createdAt < cutoff) continue;

    const text = (tweet.text || tweet.full_text || "").slice(0, 2000);
    if (!text) continue;
    if (!meetsMinLength(text, "")) {
      summary.contentSkipped++;
      continue;
    }
    if (isLikelyNonExperienceShare(text, "")) {
      summary.contentSkipped++;
      continue;
    }

    const matchedSlugs = matchModels(text, keywords);
    if (matchedSlugs.length === 0) {
      if (unmatchedSamples.length < 5) unmatchedSamples.push(text.slice(0, 120));
      continue;
    }
    summary.filtered_candidates++;

    const screenName = tweet.username || tweet.user?.screen_name || tweet.screen_name || tweet.author?.userName || "";
    const sourceUrl = tweet.url || (screenName && tweet.id
      ? `https://x.com/${screenName}/status/${tweet.id}`
      : "");
    if (!sourceUrl || existingUrls.has(sourceUrl)) {
      summary.dedupSkipped++;
      continue;
    }

    const title = text.slice(0, 500);
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
      text,
      matchedSlugs,
      sourceUrl,
      title,
      createdAt: createdAt.toISOString(),
      engagementScore: (tweet.favorite_count || tweet.likeCount || 0) + (tweet.retweet_count || tweet.retweetCount || 0),
    });
  }

  if (unmatchedSamples.length > 0) {
    await logToErrorLog(supabase, SOURCE, `Unmatched tweets (${unmatchedSamples.length} samples): ${unmatchedSamples.join(" | ")}`, "match-debug");
  }

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    for (const slug of candidate.matchedSlugs) {
      const modelId = modelMap[slug];
      if (!modelId || isDuplicate(titleKeys, candidate.title, modelId)) continue;

      const upsertResult = await upsertPendingScrapedPost(supabase, {
        model_id: modelId,
        source: "twitter",
        source_url: candidate.sourceUrl,
        title: candidate.title.slice(0, 120),
        content: candidate.text.slice(0, 2000),
        content_type: "title_only",
        score: candidate.engagementScore,
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

  return summary;
}

async function runGrokPath(
  supabase: any,
  xaiApiKey: string,
  modelMap: Record<string, string>,
  keywords: KeywordEntry[],
  existingUrls: Set<string>,
  titleKeys: Set<string>,
) {
  const summary = buildTwitterSummary("grok");
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600000);

  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast",
      input: [{ role: "user", content: GROK_SEARCH_PROMPT }],
      tools: [{
        type: "x_search",
        from_date: yesterday.toISOString().split("T")[0],
        to_date: now.toISOString().split("T")[0],
      }],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown");
    await logToErrorLog(supabase, SOURCE, `Grok API HTTP ${res.status}: ${errorText.slice(0, 500)}`, "grok-error");
    throw new Error(`Grok API returned ${res.status}`);
  }

  const data = await res.json();
  let posts: any[] = [];
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type !== "output_text") continue;
      const text = content.text || "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          posts = JSON.parse(jsonMatch[0]);
        } catch {}
      }
    }
  }

  summary.posts_found = posts.length;

  for (const post of posts) {
    if (!post.text || !post.tweet_url) continue;

    const text = post.text.slice(0, 2000);
    const sourceUrl = post.tweet_url;
    if (existingUrls.has(sourceUrl)) {
      summary.dedupSkipped++;
      continue;
    }

    const matchedSlugs = matchModels(text, keywords);
    if (matchedSlugs.length === 0 && post.model) {
      const grokSlug = post.model.toLowerCase();
      if (modelMap[grokSlug]) matchedSlugs.push(grokSlug);
    }
    if (matchedSlugs.length === 0) continue;
    summary.filtered_candidates++;

    const title = text.slice(0, 500);
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

    if (!post.posted_at || Number.isNaN(new Date(post.posted_at).getTime())) {
      summary.contentSkipped++;
      continue;
    }
    const postedAt = new Date(post.posted_at).toISOString();

    for (const slug of matchedSlugs) {
      const modelId = modelMap[slug];
      if (!modelId || isDuplicate(titleKeys, title, modelId)) continue;

      const upsertResult = await upsertPendingScrapedPost(supabase, {
        model_id: modelId,
        source: "twitter",
        source_url: sourceUrl,
        title: title.slice(0, 120),
        content: text.slice(0, 2000),
        content_type: "title_only",
        score: 0,
        posted_at: postedAt,
      });

      if (upsertResult.error) {
        summary.errors.push(`Insert: ${upsertResult.error}`);
        continue;
      }

      if (upsertResult.inserted) {
        summary.net_new_rows++;
        summary.classificationQueued++;
        existingUrls.add(sourceUrl);
        titleKeys.add(`${modelId}:${title.slice(0, 80).toLowerCase()}`);
      } else {
        summary.duplicate_conflicts++;
      }
    }
  }

  return summary;
}

export async function handleScrapeTwitter(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req)
    && !isRunPipelineTriggerRequest(req)
    && !isSchedulerRequest(body, "scrape-twitter")
  ) {
    return internalOnlyResponse(corsHeaders);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let runRecord: RunRecordRow | null = null;

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
    const xaiApiKey = Deno.env.get("XAI_API_KEY");
    if (!apifyToken && !xaiApiKey) {
      await updateRunRecord(supabase, runRecord!.id, {
        status: "skipped",
        errors: ["No X credentials (set APIFY_API_TOKEN or XAI_API_KEY)"],
        metadata: { reason: "no_credentials" },
        completed_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({
        source: SOURCE,
        status: "skipped",
        skipped: true,
        reason: "no_credentials",
        errors: ["No X credentials (set APIFY_API_TOKEN or XAI_API_KEY)"],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await logToErrorLog(supabase, SOURCE, "Twitter scraper started", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const keywordCounts: Record<string, number> = {};
    for (const keyword of keywords) {
      keywordCounts[keyword.model_slug] = (keywordCounts[keyword.model_slug] || 0) + 1;
    }
    await logToErrorLog(supabase, SOURCE, `Keywords loaded: ${keywords.length} total, by model: ${JSON.stringify(keywordCounts)}`, "keyword-debug");

    const { data: existingData } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", "twitter")
      .limit(10000);
    const existingUrls = new Set((existingData || []).map((entry: any) => entry.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const summary = apifyToken
      ? await runApifyPath(supabase, apifyToken, modelMap, keywords, existingUrls, titleKeys, config)
      : await runGrokPath(supabase, xaiApiKey!, modelMap, keywords, existingUrls, titleKeys);

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
        backend: summary.backend,
        irrelevant: summary.irrelevant,
        classifier_errors: summary.classifierErrors,
        classifier_request_errors: summary.classifierRequestErrors,
        classifier_quota_deferred: summary.classifierQuotaDeferred,
        classification_success: summary.classification_success,
        classification_queued: summary.classificationQueued,
        apify_usage: (summary as any).apifyUsage ?? null,
        apify_budget: (summary as any).apifyBudget ?? null,
        dedup_skipped: summary.dedupSkipped,
        content_skipped: summary.contentSkipped,
        skipped_reason: (summary as any).reason ?? null,
      },
      completed_at: completedAt,
    });

    await logToErrorLog(
      supabase,
      SOURCE,
      `Completed (${summary.backend}): fetched=${summary.posts_found} filtered=${summary.filtered_candidates} classified=${summary.classified} inserted=${summary.net_new_rows} duplicateConflicts=${summary.duplicate_conflicts}`,
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
        metadata: { error: message },
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
  Deno.serve(handleScrapeTwitter);
}
