import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import {
  createRunRecord,
  deriveRunMetrics,
  isUniqueViolation,
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
  logZeroDataWarning,
  triggerAggregateVibes,
  upsertScrapedPost,
} from "../_shared/utils.ts";

const SOURCE = "scrape-hackernews";
const ALGOLIA_BASE = "https://hn.algolia.com/api/v1/search_by_date";
// HN Algolia does no sentiment-aware ranking, so equal-weight model terms
// over-index neutral news (launches, benchmarks). Adding a few negative-leaning
// queries roughly doubles complaint discoverability for the lowest-volume
// models — pre-fix live data showed 0 Grok / 1 Gemini posts in 30d.
const STORY_SEARCH_TERMS = [
  "Claude",
  "ChatGPT",
  "Gemini",
  "Grok",
  "OpenAI",
  "Claude hallucinates",
  "ChatGPT dumber",
  "Gemini fails",
];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await readJsonBody(req);
  let runRecord: RunRecordRow | null = null;

  try {
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY not configured");

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

    await logToErrorLog(supabase, SOURCE, "HN scraper started", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", "hackernews")
      .limit(10000);
    const existingUrls = new Set((existing || []).map((entry: any) => entry.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const oneDayAgo = Math.floor((Date.now() - 24 * 3600000) / 1000);
    const summary = {
      source: SOURCE,
      posts_found: 0,
      filtered_candidates: 0,
      classified: 0,
      net_new_rows: 0,
      duplicate_conflicts: 0,
      irrelevant: 0,
      dedupSkipped: 0,
      contentSkipped: 0,
      errors: [] as string[],
      stories: 0,
    };

    for (const term of STORY_SEARCH_TERMS) {
      try {
        const url = `${ALGOLIA_BASE}?query=${encodeURIComponent(term)}&tags=story&numericFilters=created_at_i>${oneDayAgo}&hitsPerPage=50`;
        const res = await fetch(url);
        if (!res.ok) {
          summary.errors.push(`Story ${term}: ${res.status}`);
          await delay(1000);
          continue;
        }

        const data = await res.json();
        const hits = data.hits || [];
        summary.stories += hits.length;
        summary.posts_found += hits.length;

        const storyCandidates: {
          text: string;
          matchedSlugs: string[];
          sourceUrl: string;
          title: string;
          score: number;
          postedAt: string;
        }[] = [];

        for (const hit of hits) {
          if (!hit.title) continue;
          if (!meetsMinLength(hit.title, "")) {
            summary.contentSkipped++;
            continue;
          }

          const sourceUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
          if (existingUrls.has(sourceUrl)) {
            summary.dedupSkipped++;
            continue;
          }

          const matchedSlugs = matchModels(`${hit.title} ${hit.url || ""}`, keywords);
          if (matchedSlugs.length === 0) continue;
          summary.filtered_candidates++;

          let allDuped = true;
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (modelId && !isDuplicate(titleKeys, hit.title, modelId)) {
              allDuped = false;
              break;
            }
          }
          if (allDuped) {
            summary.dedupSkipped++;
            continue;
          }

          storyCandidates.push({
            text: hit.title,
            matchedSlugs,
            sourceUrl,
            title: hit.title,
            score: hit.points || 0,
            postedAt: hit.created_at || new Date().toISOString(),
          });
        }

        const hnLogError = async (msg: string, ctx?: string) => {
          await logToErrorLog(supabase, SOURCE, msg, ctx || "classify");
        };
        const storyClassifications = await classifyBatch(storyCandidates.map((candidate) => candidate.text), geminiApiKey, 25, hnLogError);
        summary.classified += storyClassifications.length;
        summary.irrelevant += storyClassifications.filter((classification) => !classification.relevant).length;

        // Phase 12 G-prime: only run targeted classifier on multi-model posts.
        // Single-model posts use baseClassification via the existing fallback at
        // the per-slug upsert site below.
        const targetedItems: { idx: number; slug: string }[] = [];
        for (let i = 0; i < storyCandidates.length; i++) {
          if (!storyClassifications[i].relevant) continue;
          if (storyCandidates[i].matchedSlugs.length < 2) continue;
          for (const slug of storyCandidates[i].matchedSlugs) {
            targetedItems.push({ idx: i, slug });
          }
        }
        const targetedResults = targetedItems.length > 0
          ? await classifyBatchTargeted(
            targetedItems.map((item) => ({ text: storyCandidates[item.idx].text, targetModel: item.slug })),
            geminiApiKey,
            25,
            hnLogError,
          )
          : [];
        const targetedMap = new Map<string, typeof storyClassifications[0]>();
        targetedItems.forEach((item, index) => targetedMap.set(`${item.idx}:${item.slug}`, targetedResults[index]));

        for (let i = 0; i < storyCandidates.length; i++) {
          const baseClassification = storyClassifications[i];
          if (!baseClassification.relevant) continue;
          const candidate = storyCandidates[i];

          for (const slug of candidate.matchedSlugs) {
            const classification = targetedMap.get(`${i}:${slug}`) || baseClassification;
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, candidate.title, modelId)) continue;

            const upsertResult = await upsertScrapedPost(supabase, {
              model_id: modelId,
              source: "hackernews",
              source_url: candidate.sourceUrl,
              title: candidate.title.slice(0, 500),
              content: candidate.title.slice(0, 2000),
              sentiment: classification.sentiment,
              complaint_category: classification.complaint_category,
              praise_category: classification.praise_category,
              confidence: classification.confidence,
              content_type: "title_only",
              original_language: classification.language || null,
              translated_content: classification.english_translation || null,
              score: candidate.score,
              posted_at: candidate.postedAt,
            });

            if (upsertResult.error) {
              summary.errors.push(upsertResult.error);
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
      } catch (error) {
        summary.errors.push(`Story ${term}: ${error instanceof Error ? error.message : "unknown"}`);
      }

      await delay(500);
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
        stories: summary.stories,
        irrelevant: summary.irrelevant,
        dedup_skipped: summary.dedupSkipped,
        content_skipped: summary.contentSkipped,
      },
      completed_at: new Date().toISOString(),
    });

    await logToErrorLog(
      supabase,
      SOURCE,
      `Completed: fetched=${summary.posts_found} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.net_new_rows} duplicateConflicts=${summary.duplicate_conflicts}`,
      "summary",
    );
    await logZeroDataWarning(supabase, SOURCE, summary.posts_found);

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
});
