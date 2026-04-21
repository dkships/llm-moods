import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import {
  createRunRecord,
  deriveRunMetrics,
  getConfigBoolean,
  getConfigNumber,
  getConfigValues,
  internalOnlyResponse,
  isInternalServiceRequest,
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
  logToErrorLog,
  triggerAggregateVibes,
  upsertScrapedPost,
} from "../_shared/utils.ts";

const SOURCE = "scrape-reddit-apify";

const DEFAULT_START_URLS = [
  "https://www.reddit.com/r/ClaudeAI/new/",
  "https://www.reddit.com/r/ChatGPT/new/",
  "https://www.reddit.com/r/LocalLLaMA/new/",
  "https://www.reddit.com/r/GoogleGemini/new/",
  "https://www.reddit.com/r/artificial/new/",
];

const SUBREDDIT_MODEL_MAP: Record<string, string> = {
  "r/ClaudeAI": "claude",
  "r/claudeai": "claude",
  "r/ChatGPT": "chatgpt",
  "r/chatgpt": "chatgpt",
  "r/GoogleGemini": "gemini",
  "r/googlegemini": "gemini",
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isInternalServiceRequest(req)) return internalOnlyResponse(corsHeaders);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await readJsonBody(req);
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
    if (!apifyToken) {
      await logToErrorLog(supabase, SOURCE, "APIFY_API_TOKEN not configured", "config-error");
      throw new Error("APIFY_API_TOKEN not configured");
    }

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      await logToErrorLog(supabase, SOURCE, "GEMINI_API_KEY not configured", "config-error");
      throw new Error("GEMINI_API_KEY not configured");
    }

    await logToErrorLog(supabase, SOURCE, "Reddit Apify scraper started", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const startUrls = getConfigValues(config, "start_url");
    const apifyInput = {
      startUrls: (startUrls.length > 0 ? startUrls : DEFAULT_START_URLS).map((url) => ({ url })),
      skipComments: true,
      maxItems: getConfigNumber(config, "max_items", 40),
      maxPostCount: getConfigNumber(config, "max_post_count", 8),
    };

    const startRes = await fetch(`https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/runs?token=${apifyToken}`, {
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
        await updateRunRecord(supabase, runRecord.id, {
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
    if (!apifyRunId || !datasetId) {
      await logToErrorLog(supabase, SOURCE, "No runId/datasetId", "apify-error");
      throw new Error("Missing runId from Apify");
    }

    let runStatus = "";
    for (let i = 0; i < 24; i++) {
      await delay(10000);
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}?token=${apifyToken}`);
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();
      runStatus = statusData.data?.status || "";
      if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(runStatus)) break;
    }

    if (runStatus !== "SUCCEEDED") {
      let errorDetail = "";
      try {
        const detailRes = await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}?token=${apifyToken}`);
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          errorDetail = detailData.data?.statusMessage || detailData.data?.exitCode || "";
        }
      } catch {}
      await logToErrorLog(supabase, SOURCE, `Apify run status: ${runStatus || "TIMEOUT"} detail: ${errorDetail}`, "apify-error");
      throw new Error(`Apify run status: ${runStatus || "TIMEOUT"}${errorDetail ? ` (${errorDetail})` : ""}`);
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
      duplicateSkipped: 0,
      dedupSkipped: 0,
      contentSkipped: 0,
      errors: [] as string[],
    };

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
      if (createdAt < cutoff) continue;

      const title = post.title || "";
      const bodyText = post.body || "";
      const fullText = `${title} ${bodyText}`;

      if (!meetsMinLength(title, bodyText)) {
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

    const redditLogError = async (msg: string, ctx?: string) => {
      await logToErrorLog(supabase, SOURCE, msg, ctx || "classify");
    };
    const classifications = await classifyBatch(candidates.map((candidate) => candidate.fullText), geminiApiKey, 25, redditLogError);
    summary.classified = classifications.length;
    summary.irrelevant = classifications.filter((classification) => !classification.relevant).length;

    const targetedItems: { idx: number; slug: string }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (!classifications[i].relevant) continue;
      for (const slug of candidates[i].matchedSlugs) {
        targetedItems.push({ idx: i, slug });
      }
    }
    const targetedResults = targetedItems.length > 0
      ? await classifyBatchTargeted(
        targetedItems.map((item) => ({ text: candidates[item.idx].fullText, targetModel: item.slug })),
        geminiApiKey,
        25,
        redditLogError,
      )
      : [];
    const targetedMap = new Map<string, typeof classifications[0]>();
    targetedItems.forEach((item, index) => targetedMap.set(`${item.idx}:${item.slug}`, targetedResults[index]));

    for (let i = 0; i < candidates.length; i++) {
      const baseClassification = classifications[i];
      if (!baseClassification.relevant) continue;
      const candidate = candidates[i];

      for (const slug of candidate.matchedSlugs) {
        const classification = targetedMap.get(`${i}:${slug}`) || baseClassification;
        if (!classification.relevant) continue;
        const modelId = modelMap[slug];
        if (!modelId || isDuplicate(titleKeys, candidate.title, modelId)) continue;

        const upsertResult = await upsertScrapedPost(supabase, {
          model_id: modelId,
          source: "reddit",
          source_url: candidate.sourceUrl,
          title: candidate.title.slice(0, 120),
          content: (candidate.body || candidate.title).slice(0, 2000),
          sentiment: classification.sentiment,
          complaint_category: classification.complaint_category,
          praise_category: classification.praise_category,
          confidence: classification.confidence,
          content_type: candidate.body ? "title_and_body" : "title_only",
          score: candidate.score,
          posted_at: candidate.createdAt,
          original_language: classification.language || null,
          translated_content: classification.english_translation || null,
        });

        if (upsertResult.error) {
          summary.errors.push(`Insert: ${upsertResult.error}`);
          continue;
        }

        if (upsertResult.inserted) {
          summary.net_new_rows++;
          existingUrls.add(candidate.sourceUrl);
          titleKeys.add(`${modelId}:${candidate.title.slice(0, 80).toLowerCase()}`);
        } else {
          summary.duplicate_conflicts++;
        }
      }
    }

    const derived = deriveRunMetrics(summary);
    const completedAt = new Date().toISOString();
    await updateRunRecord(supabase, runRecord.id, {
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
      },
      completed_at: completedAt,
    });

    await logToErrorLog(
      supabase,
      SOURCE,
      `Completed: posts=${summary.posts_found} filtered=${summary.filtered_candidates} classified=${summary.classified} inserted=${summary.net_new_rows} duplicateConflicts=${summary.duplicate_conflicts}`,
      "summary",
    );

    const responseBody = {
      ...summary,
      status: derived.status,
      posts_classified: derived.posts_classified,
    };

    if (!body.orchestrated) {
      await triggerAggregateVibes(supabase, SOURCE, { reason: "standalone_run" });
    }

    return new Response(JSON.stringify(responseBody, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown";
    await logToErrorLog(supabase, SOURCE, message, "top-level error");
    if (runRecord) {
      await updateRunRecord(supabase, runRecord.id, {
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
});
