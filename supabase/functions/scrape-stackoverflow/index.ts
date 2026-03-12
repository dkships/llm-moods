import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyPost } from "../_shared/classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEARCH_TERMS = ["ChatGPT", "Claude AI", "Gemini AI", "GPT-5", "DeepSeek", "Perplexity"];

interface KeywordEntry { keyword: string; tier: string; context_words: string | null; model_slug: string; }

async function loadKeywords(supabase: any): Promise<{ modelMap: Record<string, string>; keywords: KeywordEntry[] }> {
  const { data: models } = await supabase.from("models").select("id, slug");
  const modelMap: Record<string, string> = {};
  const slugById: Record<string, string> = {};
  for (const m of models || []) { modelMap[m.slug] = m.id; slugById[m.id] = m.slug; }
  const { data: kws } = await supabase.from("model_keywords").select("keyword, tier, context_words, model_id");
  const keywords: KeywordEntry[] = (kws || []).map((k: any) => ({
    keyword: k.keyword, tier: k.tier, context_words: k.context_words, model_slug: slugById[k.model_id] || "",
  }));
  return { modelMap, keywords };
}

function matchModels(text: string, keywords: KeywordEntry[]): string[] {
  const matched: string[] = [];
  const lower = text.toLowerCase();
  const highKws = keywords.filter(k => k.tier === "high").sort((a, b) => b.keyword.length - a.keyword.length);
  for (const k of highKws) {
    if (matched.includes(k.model_slug)) continue;
    const regex = new RegExp(`\\b${k.keyword.replace(/[-\.]/g, "[-\\s.]?")}\\b`, "i");
    if (regex.test(lower)) matched.push(k.model_slug);
  }
  const ambigKws = keywords.filter(k => k.tier === "ambiguous");
  for (const k of ambigKws) {
    if (matched.includes(k.model_slug)) continue;
    const regex = new RegExp(`\\b${k.keyword.replace(/[-\.]/g, "[-\\s.]?")}\\b`, "i");
    if (!regex.test(lower)) continue;
    if (!k.context_words) { matched.push(k.model_slug); continue; }
    const contextList = k.context_words.split(",").map(w => w.trim().toLowerCase());
    if (contextList.some(cw => lower.includes(cw))) matched.push(k.model_slug);
  }
  return matched;
}

function isEnglish(text: string): boolean {
  const nw = text.replace(/\s/g, "");
  if (nw.length < 5) return true;
  return ((nw.match(/[a-zA-Z]/g) || []).length / nw.length) >= 0.6;
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/<[^>]*>/g, "").trim();
}

function meetsMinLength(title: string, content: string): boolean {
  return stripUrls(`${title} ${content}`).replace(/\s+/g, " ").trim().length >= 20;
}

async function loadRecentTitleKeys(supabase: any): Promise<Set<string>> {
  const since = new Date(Date.now() - 48 * 3600000).toISOString();
  const { data } = await supabase.from("scraped_posts").select("title, model_id").gte("posted_at", since).not("title", "is", null);
  const keys = new Set<string>();
  for (const p of data || []) if (p.title) keys.add(`${p.model_id}:${p.title.slice(0, 80).toLowerCase()}`);
  return keys;
}

function isDuplicate(titleKeys: Set<string>, title: string, modelId: string): boolean {
  return titleKeys.has(`${modelId}:${title.slice(0, 80).toLowerCase()}`);
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    await supabase.from("error_log").insert({ function_name: "scrape-stackoverflow", error_message: "Function started (v2)", context: "health-check" });

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "stackoverflow").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const oneDayAgo = Math.floor((Date.now() - 24 * 3600000) / 1000);
    const summary = { fetched: 0, inserted: 0, classified: 0, irrelevant: 0, skipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    for (const term of SEARCH_TERMS) {
      try {
        const url = `https://api.stackexchange.com/2.3/search?order=desc&sort=activity&intitle=${encodeURIComponent(term)}&site=stackoverflow&pagesize=25&filter=withbody`;
        const res = await fetch(url);
        if (!res.ok) { summary.errors.push(`${term}: ${res.status}`); await delay(2000); continue; }

        const data = await res.json();
        const items = data.items || [];
        summary.fetched += items.length;

        for (const item of items) {
          if (item.creation_date < oneDayAgo) continue;

          const title = item.title || "";
          const body = (item.body || "").replace(/<[^>]*>/g, "").slice(0, 2000);
          if (!isEnglish(title)) continue;
          if (!meetsMinLength(title, body)) { summary.contentSkipped++; continue; }

          const sourceUrl = item.link;
          if (!sourceUrl || existingUrls.has(sourceUrl)) { summary.skipped++; continue; }

          const matchedSlugs = matchModels(title + " " + body, keywords);
          if (matchedSlugs.length === 0) continue;

          let allDuped = true;
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
          }
          if (allDuped) { summary.dedupSkipped++; continue; }

          const classification = await classifyPost(`${title} ${body}`, lovableApiKey);
          summary.classified++;
          if (!classification.relevant) { summary.irrelevant++; continue; }

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, title, modelId)) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "stackoverflow", source_url: sourceUrl,
              title: title.slice(0, 500), content: body.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              confidence: classification.confidence, content_type: "title_and_body",
              score: item.score || 0,
              posted_at: new Date(item.creation_date * 1000).toISOString(),
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(error.message); } else {
              summary.inserted++;
              existingUrls.add(sourceUrl);
              titleKeys.add(`${modelId}:${title.slice(0, 80).toLowerCase()}`);
            }
          }
        }
      } catch (e) { summary.errors.push(`${term}: ${e instanceof Error ? e.message : "unknown"}`); }
      await delay(2000);
    }

    await supabase.from("error_log").insert({
      function_name: "scrape-stackoverflow",
      error_message: `Done: inserted=${summary.inserted} fetched=${summary.fetched} classified=${summary.classified} irrelevant=${summary.irrelevant}`,
      context: `skipped=${summary.skipped} errors=${summary.errors.length}`,
    });

    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown";
    await supabase.from("error_log").insert({ function_name: "scrape-stackoverflow", error_message: msg, context: "top-level error" });
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
