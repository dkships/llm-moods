import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch } from "../_shared/classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INSTANCES = ["https://lemmy.world", "https://lemmy.ml"];
const SEARCH_TERMS = ["Claude", "ChatGPT", "GPT-5", "Gemini", "Grok", "LLM"];

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

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function logToErrorLog(supabase: any, msg: string, ctx?: string) {
  try { await supabase.from("error_log").insert({ function_name: "scrape-lemmy", error_message: msg, context: ctx || null }); } catch {}
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;
    await logToErrorLog(supabase, "Lemmy scraper started (v2 - tiered matching)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "lemmy").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const cutoff = new Date(Date.now() - 24 * 3600000);
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, langSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };
    let reqIdx = 0;

    for (const instance of INSTANCES) {
      for (const term of SEARCH_TERMS) {
        if (reqIdx > 0) await delay(2000);
        reqIdx++;

        try {
          const url = `${instance}/api/v3/search?q=${encodeURIComponent(term)}&type_=Posts&sort=New&limit=20`;
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) { summary.errors.push(`${instance} "${term}": HTTP ${res.status}`); continue; }

          const json = await res.json();
          const posts = json.posts || [];
          summary.fetched += posts.length;

          // Pass 1: collect candidates
          const candidates: { fullText: string; matchedSlugs: string[]; sourceUrl: string; title: string; body: string; score: number; published: string }[] = [];
          for (const item of posts) {
            const post = item.post || item.post_view?.post;
            const counts = item.counts || item.post_view?.counts;
            if (!post) continue;

            const publishedAt = new Date(post.published);
            if (publishedAt < cutoff) continue;

            const title = post.name || "";
            const body = post.body || "";
            const fullText = `${title} ${body}`;

            if (!isEnglish(fullText)) { summary.langSkipped++; continue; }
            if (!meetsMinLength(title, body)) { summary.contentSkipped++; continue; }

            const matchedSlugs = matchModels(fullText, keywords);
            if (matchedSlugs.length === 0) continue;
            summary.filtered++;

            const sourceUrl = post.ap_id || "";
            if (!sourceUrl || existingUrls.has(sourceUrl)) continue;

            let allDuped = true;
            for (const slug of matchedSlugs) {
              const modelId = modelMap[slug];
              if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
            }
            if (allDuped) { summary.dedupSkipped++; continue; }

            candidates.push({ fullText, matchedSlugs, sourceUrl, title, body, score: counts?.score || 0, published: post.published });
          }

          // Pass 2: batch classify
          const lemmyLogError = async (msg: string, ctx?: string) => {
            await logToErrorLog(supabase, msg, ctx || "classify");
          };
          const classifications = await classifyBatch(candidates.map(c => c.fullText), lovableApiKey, 25, lemmyLogError);
          summary.classified += classifications.length;
          summary.irrelevant += classifications.filter(c => !c.relevant).length;

          // Pass 3: insert
          for (let i = 0; i < candidates.length; i++) {
            const classification = classifications[i];
            if (!classification.relevant) continue;
            const c = candidates[i];

            for (const slug of c.matchedSlugs) {
              const modelId = modelMap[slug];
              if (!modelId || isDuplicate(titleKeys, c.title, modelId)) continue;
              const { error } = await supabase.from("scraped_posts").upsert({
                model_id: modelId, source: "lemmy", source_url: c.sourceUrl,
                title: c.title.slice(0, 120), content: (c.body || c.title).slice(0, 2000),
                sentiment: classification.sentiment, complaint_category: classification.complaint_category,
                praise_category: classification.praise_category,
                confidence: classification.confidence, content_type: c.body ? "title_and_body" : "title_only",
                score: c.score, posted_at: c.published,
              }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
              if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
                summary.inserted++;
                existingUrls.add(c.sourceUrl);
                titleKeys.add(`${modelId}:${c.title.slice(0, 80).toLowerCase()}`);
              }
            }
          }
        } catch (e) { summary.errors.push(`${instance} "${term}": ${e instanceof Error ? e.message : String(e)}`); }
      }
    }

    await logToErrorLog(supabase, `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted}`, "summary");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
