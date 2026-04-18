import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, meetsMinLength, isLikelyNewsShare, logToErrorLog, triggerAggregateVibes } from "../_shared/utils.ts";

const MAIN_INSTANCE = "mastodon.social";
const MAIN_HASHTAGS = ["chatgpt", "claudeai", "grok", "llm"];
const TECH_INSTANCES = ["mastodon.online", "techhub.social", "sigmoid.social", "hachyderm.io"];
const TECH_HASHTAGS = ["llm", "chatgpt"];

const ASTROLOGY_TERMS = ["horoscope", "zodiac", "mercury retrograde", "natal chart", "birth chart", "sun sign", "moon sign", "rising sign", "astrology"];
function isAstrologyPost(text: string): boolean {
  const lower = text.toLowerCase();
  return ASTROLOGY_TERMS.some(term => lower.includes(term));
}

const SEARCH_QUERIES = [
  "Claude AI", "ChatGPT", "GPT dumber", "Claude worse", "Gemini bad", "AI getting worse",
];
const SEARCH_INSTANCE = "mastodon.social";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
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

    // Phase 1a: Full hashtag set on main instance
    for (const hashtag of MAIN_HASHTAGS) {
      await delay(1000);
      try {
        const url = `https://${MAIN_INSTANCE}/api/v1/timelines/tag/${hashtag}?limit=40`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) { summary.errors.push(`${MAIN_INSTANCE}/#${hashtag}: HTTP ${res.status}`); continue; }
        const statuses: Status[] = await res.json();
        if (!Array.isArray(statuses)) continue;
        for (const s of statuses) {
          if (s.url && !allStatuses.has(s.url)) allStatuses.set(s.url, s);
        }
      } catch (e) {
        summary.errors.push(`${MAIN_INSTANCE}/#${hashtag}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Phase 1b: Targeted hashtags on tech instances
    for (const instance of TECH_INSTANCES) {
      for (const hashtag of TECH_HASHTAGS) {
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

      const content = stripHtml(status.content || "");
      if (!meetsMinLength("", content)) { summary.contentSkipped++; continue; }
      if (isAstrologyPost(content)) { summary.contentSkipped++; continue; }
      if (isLikelyNewsShare("", content)) { summary.contentSkipped++; continue; }

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

    // Pass 2b: Re-classify each matched model with targeted sentiment.
    const targetedItems: { idx: number; slug: string }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (!classifications[i].relevant) continue;
      for (const slug of candidates[i].matchedSlugs) {
        targetedItems.push({ idx: i, slug });
      }
    }
    const targetedResults = targetedItems.length > 0
      ? await classifyBatchTargeted(
          targetedItems.map(item => ({ text: candidates[item.idx].content, targetModel: item.slug })),
          lovableApiKey, 25, mastodonLogError
        )
      : [];
    const targetedMap = new Map<string, typeof classifications[0]>();
    targetedItems.forEach((item, j) => targetedMap.set(`${item.idx}:${item.slug}`, targetedResults[j]));

    // Pass 3: insert
    for (let i = 0; i < candidates.length; i++) {
      const classification = classifications[i];
      if (!classification.relevant) continue;
      const c = candidates[i];

      for (const slug of c.matchedSlugs) {
        const modelId = modelMap[slug];
        if (!modelId) continue;
        const cls = targetedMap.get(`${i}:${slug}`) || classification;
        if (!cls.relevant) continue;
        const { error } = await supabase.from("scraped_posts").upsert({
          model_id: modelId, source: "mastodon", source_url: c.sourceUrl,
          title: c.content.slice(0, 120), content: c.content.slice(0, 2000),
          sentiment: cls.sentiment, complaint_category: cls.complaint_category,
          praise_category: cls.praise_category,
          confidence: cls.confidence, content_type: "full_content",
          original_language: cls.language || null,
          translated_content: cls.english_translation || null,
          score: c.score, posted_at: c.postedAt,
        }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
        if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
          summary.inserted++;
          existingUrls.add(c.sourceUrl);
        }
      }
    }

    await logToErrorLog(supabase, "scrape-mastodon", `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted} errors=${summary.errors.length}`, "summary");
    await triggerAggregateVibes(supabase, "scrape-mastodon");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-mastodon", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
