import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  createRunRecord,
  deriveRunMetrics,
  getConfigBoolean,
  getConfigNumber,
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
  logToErrorLog,
  logZeroDataWarning,
  meetsMinLength,
  upsertPendingScrapedPost,
} from "../_shared/utils.ts";

const SOURCE = "scrape-appstore";

// Apple's customer-review RSS is free and keyless; each feed serves the 50 most
// recent US-storefront reviews per page. Reviews are personal experience by
// construction and symmetric across all four tracked models (unlike forum
// sources). App IDs verified live 2026-07-10 via itunes.apple.com/lookup.
// The classifier's relevance gate handles app-UX-only reviews (login, billing,
// crashes) — those are marked irrelevant by the availability/status rule; only
// model-quality opinions reach the score.
const APP_IDS: Record<string, string> = {
  chatgpt: "6448311069",
  claude: "6473753684",
  gemini: "6477489729",
  grok: "6670324846",
};

// Per-app per-run ingest cap. ChatGPT's feed runs ~160 reviews/day — uncapped it
// would dwarf every other source for that model and inflate classification cost.
// 15/app × 3 runs/day ≈ 45/app/day ceiling keeps the source supplementary.
const DEFAULT_MAX_REVIEWS_PER_APP = 15;

// Apple's review RSS is served from inconsistent CDN caches: back-to-back
// fetches of the same feed can differ by WEEKS in their "newest" entry
// (verified live 2026-07-10: one snapshot's newest was 26h old, the next 26
// days). A 24h recency cutoff ingests zero on stale cache hits, so the window
// is 7 days and the source_url dedupe (stable per-review IDs) absorbs the
// overlap across runs. posted_at keeps the review's own timestamp, so scoring
// buckets each review into its real day regardless of when it was ingested.
const REVIEW_MAX_AGE_MS = 7 * 24 * 3600000;

interface ReviewEntry {
  id?: { label?: string };
  title?: { label?: string };
  content?: { label?: string };
  updated?: { label?: string };
  "im:rating"?: { label?: string };
}

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleScrapeAppstore(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req)
    && !isRunPipelineTriggerRequest(req)
    && !isSchedulerRequest(body, "scrape-appstore")
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
    const maxReviewsPerApp = getConfigNumber(config, "max_reviews_per_app", DEFAULT_MAX_REVIEWS_PER_APP);

    const { data: startedRun, error: runError } = await createRunRecord(supabase, {
      source: SOURCE,
      run_kind: "scraper",
      status: "running",
      parent_run_id: typeof body.parent_run_id === "string" ? body.parent_run_id : null,
      triggered_by: body.orchestrated ? "orchestrator" : "manual",
      window_label: typeof body.window_label === "string" ? body.window_label : null,
      window_local_date: typeof body.window_local_date === "string" ? body.window_local_date : null,
      timezone: typeof body.timezone === "string" ? body.timezone : null,
      started_at: new Date().toISOString(),
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

    await logToErrorLog(supabase, SOURCE, "App Store review scraper started", "health-check");

    const { data: models } = await supabase.from("models").select("id, slug, name");
    const modelMap: Record<string, string> = {};
    const modelNames: Record<string, string> = {};
    for (const m of models || []) {
      modelMap[m.slug] = m.id;
      modelNames[m.slug] = m.name || m.slug;
    }

    const { data: existing } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", "appstore")
      .limit(10000);
    const existingUrls = new Set((existing || []).map((entry: { source_url: string | null }) => entry.source_url).filter(Boolean));

    const cutoff = new Date(Date.now() - REVIEW_MAX_AGE_MS);
    const summary = {
      source: SOURCE,
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

    for (const [slug, appId] of Object.entries(APP_IDS)) {
      const modelId = modelMap[slug];
      if (!modelId) {
        summary.errors.push(`No model row for slug ${slug}`);
        continue;
      }

      let entries: ReviewEntry[] = [];
      try {
        const url = `https://itunes.apple.com/us/rss/customerreviews/id=${appId}/sortBy=mostRecent/page=1/json`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          summary.errors.push(`${slug}: HTTP ${res.status}`);
          await delay(1000);
          continue;
        }
        const data = await res.json();
        const rawEntries = data?.feed?.entry;
        entries = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : [];
      } catch (error) {
        summary.errors.push(`${slug}: ${error instanceof Error ? error.message : String(error)}`);
        await delay(1000);
        continue;
      }

      summary.posts_found += entries.length;
      let ingested = 0;

      for (const entry of entries) {
        if (ingested >= maxReviewsPerApp) break;

        const reviewId = entry.id?.label ?? "";
        const title = (entry.title?.label ?? "").trim();
        const content = (entry.content?.label ?? "").trim();
        const updated = entry.updated?.label ?? "";
        const rating = Number(entry["im:rating"]?.label);
        if (!reviewId || !content) continue;

        const postedAt = new Date(updated);
        if (Number.isNaN(postedAt.getTime()) || postedAt < cutoff) continue;

        if (!meetsMinLength(title, content)) {
          summary.contentSkipped++;
          continue;
        }

        const sourceUrl = `https://apps.apple.com/us/app/id${appId}#review-${reviewId}`;
        if (existingUrls.has(sourceUrl)) {
          summary.dedupSkipped++;
          continue;
        }

        summary.filtered_candidates++;

        // The rating + app name ride along in the content: reviews rarely name
        // the model ("it keeps making things up"), so the suffix gives the
        // classifier its implicit-target context (mirroring the "(posted in
        // r/X)" convention) and gives chatter-feed readers provenance.
        // Attribution is direct: a review of the Claude app is about Claude.
        const appLabel = `App Store review of the ${modelNames[slug]} iOS app`;
        const ratingSuffix = Number.isFinite(rating) && rating >= 1 && rating <= 5
          ? ` (${rating}/5 star ${appLabel})`
          : ` (${appLabel})`;

        const upsertResult = await upsertPendingScrapedPost(supabase, {
          model_id: modelId,
          source: "appstore",
          source_url: sourceUrl,
          title: title.slice(0, 120) || null,
          content: `${content.slice(0, 1900)}${ratingSuffix}`,
          content_type: "title_and_body",
          score: 0,
          posted_at: postedAt.toISOString(),
        });

        if (upsertResult.error) {
          summary.errors.push(`Insert: ${upsertResult.error}`);
          continue;
        }

        if (upsertResult.inserted) {
          summary.net_new_rows++;
          summary.classificationQueued++;
          existingUrls.add(sourceUrl);
          ingested++;
        } else {
          summary.duplicate_conflicts++;
        }
      }

      await delay(1000);
    }

    const derived = deriveRunMetrics(summary);
    await updateRunRecord(supabase, runRecord!.id, {
      status: derived.status,
      posts_found: derived.posts_found,
      posts_classified: derived.posts_classified,
      filtered_candidates: derived.filtered_candidates,
      net_new_rows: derived.net_new_rows,
      duplicate_conflicts: derived.duplicate_conflicts,
      errors: derived.errors,
      metadata: {
        irrelevant: summary.irrelevant,
        classifier_errors: summary.classifierErrors,
        classifier_request_errors: summary.classifierRequestErrors,
        classifier_quota_deferred: summary.classifierQuotaDeferred,
        classification_success: summary.classification_success,
        classification_queued: summary.classificationQueued,
        dedup_skipped: summary.dedupSkipped,
        content_skipped: summary.contentSkipped,
      },
      completed_at: new Date().toISOString(),
    });

    await logToErrorLog(
      supabase,
      SOURCE,
      `Completed: fetched=${summary.posts_found} filtered=${summary.filtered_candidates} inserted=${summary.net_new_rows} duplicateConflicts=${summary.duplicate_conflicts}`,
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
  Deno.serve(handleScrapeAppstore);
}
