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
  isLikelyNewsShare,
  logToErrorLog,
  triggerAggregateVibes,
  upsertScrapedPost,
} from "../_shared/utils.ts";

const SOURCE = "scrape-mastodon";
const MAIN_INSTANCE = "mastodon.social";
const MAIN_HASHTAGS = ["chatgpt", "claudeai", "grok", "llm"];
const TECH_INSTANCES = ["mastodon.online", "techhub.social", "sigmoid.social", "hachyderm.io"];
const TECH_HASHTAGS = ["llm", "chatgpt"];
const SEARCH_QUERIES = ["Claude AI", "ChatGPT", "GPT dumber", "Claude worse", "Gemini bad", "AI getting worse"];
const SEARCH_INSTANCE = "mastodon.social";
const ASTROLOGY_TERMS = [
  "horoscope",
  "zodiac",
  "mercury retrograde",
  "natal chart",
  "birth chart",
  "sun sign",
  "moon sign",
  "rising sign",
  "astrology",
];

function isAstrologyPost(text: string): boolean {
  const lower = text.toLowerCase();
  return ASTROLOGY_TERMS.some((term) => lower.includes(term));
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_match: string, value: string) => String.fromCharCode(Number(value)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match: string, value: string) => String.fromCharCode(parseInt(value, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

interface Status {
  content: string;
  created_at: string;
  url: string;
  favourites_count: number;
  reblogs_count: number;
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

    await logToErrorLog(supabase, SOURCE, "Mastodon scraper started", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", "mastodon")
      .limit(10000);
    const existingUrls = new Set((existing || []).map((entry: any) => entry.source_url).filter(Boolean));

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

    const allStatuses = new Map<string, Status>();

    for (const hashtag of MAIN_HASHTAGS) {
      await delay(1000);
      try {
        const url = `https://${MAIN_INSTANCE}/api/v1/timelines/tag/${hashtag}?limit=40`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          summary.errors.push(`${MAIN_INSTANCE}/#${hashtag}: HTTP ${res.status}`);
          continue;
        }
        const statuses: Status[] = await res.json();
        if (!Array.isArray(statuses)) continue;
        for (const status of statuses) {
          if (status.url && !allStatuses.has(status.url)) allStatuses.set(status.url, status);
        }
      } catch (error) {
        summary.errors.push(`${MAIN_INSTANCE}/#${hashtag}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const instance of TECH_INSTANCES) {
      for (const hashtag of TECH_HASHTAGS) {
        await delay(1000);
        try {
          const url = `https://${instance}/api/v1/timelines/tag/${hashtag}?limit=40`;
          const res = await fetchWithTimeout(url);
          if (!res.ok) {
            summary.errors.push(`${instance}/#${hashtag}: HTTP ${res.status}`);
            continue;
          }
          const statuses: Status[] = await res.json();
          if (!Array.isArray(statuses)) continue;
          for (const status of statuses) {
            if (status.url && !allStatuses.has(status.url)) allStatuses.set(status.url, status);
          }
        } catch (error) {
          summary.errors.push(`${instance}/#${hashtag}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    for (const query of SEARCH_QUERIES) {
      await delay(1000);
      try {
        const url = `https://${SEARCH_INSTANCE}/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&limit=20`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          summary.errors.push(`search "${query}": HTTP ${res.status}`);
          continue;
        }
        const result = await res.json();
        const statuses: Status[] = result.statuses || [];
        for (const status of statuses) {
          if (status.url && !allStatuses.has(status.url)) allStatuses.set(status.url, status);
        }
      } catch (error) {
        summary.errors.push(`search "${query}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    summary.posts_found = allStatuses.size;

    const candidates: {
      content: string;
      matchedSlugs: string[];
      sourceUrl: string;
      score: number;
      postedAt: string;
    }[] = [];

    for (const [sourceUrl, status] of allStatuses) {
      const createdAt = new Date(status.created_at);
      if (createdAt < cutoff) continue;

      const content = stripHtml(status.content || "");
      if (!meetsMinLength("", content)) {
        summary.contentSkipped++;
        continue;
      }
      if (isAstrologyPost(content)) {
        summary.contentSkipped++;
        continue;
      }
      if (isLikelyNewsShare("", content)) {
        summary.contentSkipped++;
        continue;
      }

      const matchedSlugs = matchModels(content, keywords);
      if (matchedSlugs.length === 0) continue;
      summary.filtered_candidates++;

      if (existingUrls.has(sourceUrl)) {
        summary.dedupSkipped++;
        continue;
      }

      const score = (status.favourites_count || 0) + (status.reblogs_count || 0);
      candidates.push({ content, matchedSlugs, sourceUrl, score, postedAt: status.created_at });
    }

    const mastodonLogError = async (msg: string, ctx?: string) => {
      await logToErrorLog(supabase, SOURCE, msg, ctx || "classify");
    };
    const classifications = await classifyBatch(candidates.map((candidate) => candidate.content), geminiApiKey, 25, mastodonLogError);
    summary.classified = classifications.length;
    summary.irrelevant = classifications.filter((classification) => !classification.relevant).length;

    const targetedItems: { idx: number; slug: string }[] = [];
    for (let index = 0; index < candidates.length; index++) {
      if (!classifications[index].relevant) continue;
      for (const slug of candidates[index].matchedSlugs) {
        targetedItems.push({ idx: index, slug });
      }
    }
    const targetedResults = targetedItems.length > 0
      ? await classifyBatchTargeted(
        targetedItems.map((item) => ({ text: candidates[item.idx].content, targetModel: item.slug })),
        geminiApiKey,
        25,
        mastodonLogError,
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
        if (!modelId) continue;
        const classification = targetedMap.get(`${index}:${slug}`) || baseClassification;
        if (!classification.relevant) continue;

        const upsertResult = await upsertScrapedPost(supabase, {
          model_id: modelId,
          source: "mastodon",
          source_url: candidate.sourceUrl,
          title: candidate.content.slice(0, 120),
          content: candidate.content.slice(0, 2000),
          sentiment: classification.sentiment,
          complaint_category: classification.complaint_category,
          praise_category: classification.praise_category,
          confidence: classification.confidence,
          content_type: "full_content",
          original_language: classification.language || null,
          translated_content: classification.english_translation || null,
          score: candidate.score,
          posted_at: candidate.postedAt,
        });

        if (upsertResult.error) {
          summary.errors.push(`Insert: ${upsertResult.error}`);
          continue;
        }

        if (upsertResult.inserted) {
          summary.net_new_rows++;
          existingUrls.add(candidate.sourceUrl);
        } else {
          summary.duplicate_conflicts++;
        }
      }
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
        dedup_skipped: summary.dedupSkipped,
        content_skipped: summary.contentSkipped,
      },
      completed_at: new Date().toISOString(),
    });

    await logToErrorLog(
      supabase,
      SOURCE,
      `Completed: fetched=${summary.posts_found} filtered=${summary.filtered_candidates} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.net_new_rows} duplicateConflicts=${summary.duplicate_conflicts} errors=${summary.errors.length}`,
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
