import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
  triggerAggregateVibes,
  upsertScrapedPost,
} from "../_shared/utils.ts";

const SOURCE = "scrape-lemmy";
const INSTANCES = ["https://lemmy.world", "https://lemmy.ml"];
const SEARCH_TERMS = ["Claude", "ChatGPT", "GPT-5", "Gemini", "Grok", "LLM"];

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

    await logToErrorLog(supabase, SOURCE, "Lemmy scraper started", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", "lemmy")
      .limit(10000);
    const existingUrls = new Set((existing || []).map((entry: any) => entry.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const cutoff = new Date(Date.now() - 24 * 3600000);
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
    };

    let requestIndex = 0;
    for (const instance of INSTANCES) {
      for (const term of SEARCH_TERMS) {
        if (requestIndex > 0) await delay(2000);
        requestIndex++;

        try {
          const url = `${instance}/api/v3/search?q=${encodeURIComponent(term)}&type_=Posts&sort=New&limit=20`;
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) {
            summary.errors.push(`${instance} "${term}": HTTP ${res.status}`);
            continue;
          }

          const json = await res.json();
          const posts = json.posts || [];
          summary.posts_found += posts.length;

          const candidates: {
            fullText: string;
            matchedSlugs: string[];
            sourceUrl: string;
            title: string;
            body: string;
            score: number;
            published: string;
          }[] = [];

          for (const item of posts) {
            const post = item.post || item.post_view?.post;
            const counts = item.counts || item.post_view?.counts;
            if (!post) continue;

            const publishedAt = new Date(post.published);
            if (publishedAt < cutoff) continue;

            const title = post.name || "";
            const bodyText = post.body || "";
            const fullText = `${title} ${bodyText}`;
            if (!meetsMinLength(title, bodyText)) {
              summary.contentSkipped++;
              continue;
            }

            const matchedSlugs = matchModels(fullText, keywords);
            if (matchedSlugs.length === 0) continue;
            summary.filtered_candidates++;

            const sourceUrl = post.ap_id || "";
            if (!sourceUrl || existingUrls.has(sourceUrl)) {
              summary.dedupSkipped++;
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
              score: counts?.score || 0,
              published: post.published,
            });
          }

          const lemmyLogError = async (msg: string, ctx?: string) => {
            await logToErrorLog(supabase, SOURCE, msg, ctx || "classify");
          };
          const classifications = await classifyBatch(candidates.map((candidate) => candidate.fullText), geminiApiKey, 25, lemmyLogError);
          summary.classified += classifications.length;
          summary.irrelevant += classifications.filter((classification) => !classification.relevant).length;

          const targetedItems: { idx: number; slug: string }[] = [];
          for (let index = 0; index < candidates.length; index++) {
            if (!classifications[index].relevant) continue;
            for (const slug of candidates[index].matchedSlugs) {
              targetedItems.push({ idx: index, slug });
            }
          }
          const targetedResults = targetedItems.length > 0
            ? await classifyBatchTargeted(
              targetedItems.map((item) => ({ text: candidates[item.idx].fullText, targetModel: item.slug })),
              geminiApiKey,
              25,
              lemmyLogError,
            )
            : [];
          const targetedMap = new Map<string, typeof classifications[0]>();
          targetedItems.forEach((item, index) => targetedMap.set(`${item.idx}:${item.slug}`, targetedResults[index]));

          for (let index = 0; index < candidates.length; index++) {
            const baseClassification = classifications[index];
            if (!baseClassification.relevant) continue;
            const candidate = candidates[index];

            for (const slug of candidate.matchedSlugs) {
              const modelId = modelMap[slug];
              if (!modelId || isDuplicate(titleKeys, candidate.title, modelId)) continue;
              const classification = targetedMap.get(`${index}:${slug}`) || baseClassification;
              if (!classification.relevant) continue;

              const upsertResult = await upsertScrapedPost(supabase, {
                model_id: modelId,
                source: "lemmy",
                source_url: candidate.sourceUrl,
                title: candidate.title.slice(0, 120),
                content: (candidate.body || candidate.title).slice(0, 2000),
                sentiment: classification.sentiment,
                complaint_category: classification.complaint_category,
                praise_category: classification.praise_category,
                confidence: classification.confidence,
                content_type: candidate.body ? "title_and_body" : "title_only",
                original_language: classification.language || null,
                translated_content: classification.english_translation || null,
                score: candidate.score,
                posted_at: candidate.published,
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
        } catch (error) {
          summary.errors.push(`${instance} "${term}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const derived = deriveRunMetrics(summary);
    await updateRunRecord(supabase, runRecord.id, {
      status: derived.status,
      posts_found: derived.posts_found,
      posts_classified: derived.posts_classified,
      filtered_candidates: derived.filtered_candidates,
      net_new_rows: derived.net_new_rows,
      duplicate_conflicts: derived.duplicate_conflicts,
      errors: derived.errors,
      metadata: {
        irrelevant: summary.irrelevant,
        dedup_skipped: summary.dedupSkipped,
        content_skipped: summary.contentSkipped,
      },
      completed_at: new Date().toISOString(),
    });

    await logToErrorLog(
      supabase,
      SOURCE,
      `Completed: fetched=${summary.posts_found} filtered=${summary.filtered_candidates} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.net_new_rows} duplicateConflicts=${summary.duplicate_conflicts}`,
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
