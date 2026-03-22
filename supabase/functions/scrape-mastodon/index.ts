import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, isEnglish, meetsMinLength, logToErrorLog } from "../_shared/utils.ts";

const INSTANCES = ["mastodon.social", "mastodon.online", "techhub.social", "sigmoid.social"];
const HASHTAGS = ["chatgpt", "claudeai", "gemini", "grok", "llm", "aitools"];

const SEARCH_QUERIES = [
  "Claude AI", "ChatGPT", "GPT dumber", "Claude worse", "Gemini bad", "AI getting worse",
];
const SEARCH_INSTANCE = "mastodon.social";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }


async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

interface Status {
  id: string;
  content: string;
  created_at: string;
  url: string;
  favourites_count: number;
  reblogs_count: number;
  language: string | null;
  account?: { acct?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;
    await logToErrorLog(supabase, "scrape-mastodon", "Mastodon scraper started (v3 - multi-instance + search)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "mastodon").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const cutoff = new Date(Date.now() - 24 * 3600000);
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, langSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    // Collect all statuses, deduped by URL
    const allStatuses = new Map<string, Status>();

    // Phase 1: Hashtag timelines across all instances
    for (const instance of INSTANCES) {
      for (const hashtag of HASHTAGS) {
        await delay(1000);
        try {
          const url = `https://${instance}/api/v1/timelines/tag/${hashtag}?limit=40`;
          const res = await fetchWithTimeout(url);
          if (!res.ok) { summary.errors.push(`${instance}/#${hashtag}: HTTP ${res.status}`); continue; }
          const statuses: Status[] = await res.json();
          if (!Array.isArray(statuses)) continue;
          for (const s of statuses) {
            if (s.url && !allStatuses.has(s.url)) allStatuses.set(s.url, s);
          }
        } catch (e) {
          summary.errors.push(`${instance}/#${hashtag}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // Phase 2: Search queries on mastodon.social
    for (const query of SEARCH_QUERIES) {
      await delay(1000);
      try {
        const url = `https://${SEARCH_INSTANCE}/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&limit=20`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) { summary.errors.push(`search "${query}": HTTP ${res.status}`); continue; }
        const result = await res.json();
        const statuses: Status[] = result.statuses || [];
        for (const s of statuses) {
          if (s.url && !allStatuses.has(s.url)) allStatuses.set(s.url, s);
        }
      } catch (e) {
        summary.errors.push(`search "${query}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    summary.fetched = allStatuses.size;

    // Phase 3: Collect candidates from all statuses
    const candidates: { content: string; matchedSlugs: string[]; sourceUrl: string; score: number; postedAt: string }[] = [];
    for (const [sourceUrl, status] of allStatuses) {
      const createdAt = new Date(status.created_at);
      if (createdAt < cutoff) continue;

      const lang = status.language;
      if (lang && lang !== "en" && !lang.startsWith("en")) { summary.langSkipped++; continue; }

      const content = stripHtml(status.content || "");
      if (!isEnglish(content)) { summary.langSkipped++; continue; }
      if (!meetsMinLength("", content)) { summary.contentSkipped++; continue; }

      const matchedSlugs = matchModels(content, keywords);
      if (matchedSlugs.length === 0) continue;
      summary.filtered++;

      if (existingUrls.has(sourceUrl)) { summary.dedupSkipped++; continue; }

      const score = (status.favourites_count || 0) + (status.reblogs_count || 0);
      candidates.push({ content, matchedSlugs, sourceUrl, score, postedAt: status.created_at });
    }

    // Pass 2: batch classify
    const mastodonLogError = async (msg: string, ctx?: string) => {
      await logToErrorLog(supabase, "scrape-mastodon", msg, ctx || "classify");
    };
    const classifications = await classifyBatch(candidates.map(c => c.content), lovableApiKey, 25, mastodonLogError);
    summary.classified = classifications.length;
    summary.irrelevant = classifications.filter(c => !c.relevant).length;

    // Pass 3: insert
    for (let i = 0; i < candidates.length; i++) {
      const classification = classifications[i];
      if (!classification.relevant) continue;
      const c = candidates[i];

      for (const slug of c.matchedSlugs) {
        const modelId = modelMap[slug];
        if (!modelId) continue;
        const { error } = await supabase.from("scraped_posts").upsert({
          model_id: modelId, source: "mastodon", source_url: c.sourceUrl,
          title: c.content.slice(0, 120), content: c.content.slice(0, 2000),
          sentiment: classification.sentiment, complaint_category: classification.complaint_category,
          praise_category: classification.praise_category,
          confidence: classification.confidence, content_type: "full_content",
          score: c.score, posted_at: c.postedAt,
        }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
        if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
          summary.inserted++;
          existingUrls.add(c.sourceUrl);
        }
      }
    }

    await logToErrorLog(supabase, "scrape-mastodon", `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted} errors=${summary.errors.length}`, "summary");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-mastodon", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
