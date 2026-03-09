import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "sonnet", "opus", "anthropic"],
  chatgpt: ["chatgpt", "gpt-5", "gpt-4", "gpt-4o", "gpt", "openai"],
  gemini: ["gemini", "gemini pro", "google ai"],
  grok: ["grok", "grok 4", "xai"],
  deepseek: ["deepseek", "deepseek r1", "deepseek v3"],
  perplexity: ["perplexity", "perplexity ai", "pplx"],
};

function isEnglish(text: string): boolean {
  const noWhitespace = text.replace(/\s/g, "");
  if (noWhitespace.length < 5) return true;
  const latinCount = (noWhitespace.match(/[a-zA-Z]/g) || []).length;
  return latinCount / noWhitespace.length >= 0.6;
}

function matchModels(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  for (const [slug, keywords] of Object.entries(MODEL_KEYWORDS)) {
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw.replace("-", "[-\\s]?")}\\b`, "i");
      if (regex.test(lower)) {
        if (!matched.includes(slug)) matched.push(slug);
        break;
      }
    }
  }
  return matched;
}

async function classifyPost(
  title: string, content: string, apiKey: string
): Promise<{ sentiment: string; complaint_category: string | null }> {
  const truncated = (content || "").slice(0, 500);
  const prompt = `Classify this social media post about an AI model. Return ONLY valid JSON with two fields: sentiment (positive/negative/neutral) and complaint_category (lazy_responses/hallucinations/refusals/coding_quality/speed/general_drop or null if not negative). Classify as neutral ONLY if the post is purely factual news with zero opinion expressed. Most social media posts express some sentiment — when in doubt, choose positive or negative, not neutral. Post: ${title} ${truncated}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "user", content: prompt }] }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return { sentiment: "neutral", complaint_category: null };
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { sentiment: parsed.sentiment || "neutral", complaint_category: parsed.complaint_category || null };
      }
    } catch { /* classification failed */ }
    return { sentiment: "neutral", complaint_category: null };
  } catch {
    return { sentiment: "neutral", complaint_category: null };
  }
}

async function logToErrorLog(supabase: any, functionName: string, errorMessage: string, context?: string) {
  try {
    await supabase.from("error_log").insert({ function_name: functionName, error_message: errorMessage, context: context || null });
  } catch (e) {
    console.error("Failed to log to error_log:", e);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1/search_by_date";

const STORY_SEARCH_TERMS = [
  "Claude", "ChatGPT", "GPT-5", "Gemini", "Grok", "DeepSeek", "Perplexity", "OpenAI", "Anthropic",
];

const COMMENT_SEARCH_TERMS = [
  "Claude dumb", "ChatGPT worse", "GPT bad", "Gemini sucks", "Grok useless", "DeepSeek bad", "Perplexity worse",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    await logToErrorLog(supabase, "scrape-hackernews", "Function started (Algolia)", "health-check");

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "hackernews");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const summary = { stories: 0, comments: 0, classified: 0, inserted: 0, skipped: 0, errors: [] as string[] };

    // Search stories
    for (const term of STORY_SEARCH_TERMS) {
      try {
        const url = `${ALGOLIA_BASE}?query=${encodeURIComponent(term)}&tags=story&numericFilters=created_at_i>${oneDayAgo}&hitsPerPage=50`;
        const res = await fetch(url);
        if (!res.ok) { summary.errors.push(`Story search ${term}: ${res.status}`); await delay(1000); continue; }
        const data = await res.json();
        const hits = data.hits || [];
        summary.stories += hits.length;

        for (const hit of hits) {
          if (!hit.title || !isEnglish(hit.title)) continue;
          const sourceUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
          if (existingUrls.has(sourceUrl)) { summary.skipped++; continue; }

          const matchedSlugs = matchModels(hit.title + " " + (hit.url || ""));
          if (matchedSlugs.length === 0) continue;

          const classification = await classifyPost(hit.title, hit.title, lovableApiKey);
          summary.classified++;

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;
            const { error } = await supabase.from("scraped_posts").insert({
              model_id: modelId, source: "hackernews", source_url: sourceUrl,
              title: hit.title.slice(0, 500), content: hit.title.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              score: hit.points || 0,
              posted_at: hit.created_at || new Date().toISOString(),
            });
            if (error) { summary.errors.push(error.message); } else { summary.inserted++; existingUrls.add(sourceUrl); }
          }
        }
      } catch (e) {
        summary.errors.push(`Story ${term}: ${e instanceof Error ? e.message : "unknown"}`);
      }
      await delay(1000);
    }

    // Search high-sentiment comments
    for (const term of COMMENT_SEARCH_TERMS) {
      try {
        const url = `${ALGOLIA_BASE}?query=${encodeURIComponent(term)}&tags=comment&numericFilters=created_at_i>${oneDayAgo}&hitsPerPage=30`;
        const res = await fetch(url);
        if (!res.ok) { await delay(1000); continue; }
        const data = await res.json();
        const hits = data.hits || [];
        summary.comments += hits.length;

        for (const hit of hits) {
          const text = (hit.comment_text || "").replace(/<[^>]*>/g, "");
          if (!text || !isEnglish(text)) continue;
          const sourceUrl = hit.story_id
            ? `https://news.ycombinator.com/item?id=${hit.story_id}`
            : `https://news.ycombinator.com/item?id=${hit.objectID}`;
          if (existingUrls.has(sourceUrl)) { summary.skipped++; continue; }

          const matchedSlugs = matchModels(text);
          if (matchedSlugs.length === 0) continue;

          const classification = await classifyPost(text.slice(0, 200), text, lovableApiKey);
          summary.classified++;

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;
            const { error } = await supabase.from("scraped_posts").insert({
              model_id: modelId, source: "hackernews", source_url: sourceUrl,
              title: text.slice(0, 200), content: text.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              score: hit.points || 0,
              posted_at: hit.created_at || new Date().toISOString(),
            });
            if (error) { summary.errors.push(error.message); } else { summary.inserted++; existingUrls.add(sourceUrl); }
          }
        }
      } catch (e) {
        summary.errors.push(`Comment ${term}: ${e instanceof Error ? e.message : "unknown"}`);
      }
      await delay(1000);
    }

    await logToErrorLog(supabase, "scrape-hackernews", `Algolia: inserted=${summary.inserted} stories=${summary.stories} comments=${summary.comments} classified=${summary.classified}`, `skipped=${summary.skipped} errors=${summary.errors.length}`);

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-hackernews", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
