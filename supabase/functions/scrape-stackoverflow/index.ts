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

const SEARCH_TERMS = ["ChatGPT", "Claude AI", "Gemini AI", "GPT-5", "DeepSeek", "Perplexity"];

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

async function classifyPost(title: string, content: string, apiKey: string) {
  const truncated = (content || "").slice(0, 500);
  const prompt = `Classify this social media post about an AI model. Return ONLY valid JSON with two fields: sentiment (positive/negative/neutral) and complaint_category (lazy_responses/hallucinations/refusals/coding_quality/speed/general_drop or null if not negative). Classify as neutral ONLY if the post is purely factual news with zero opinion expressed. Post: ${title} ${truncated}`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return { sentiment: "neutral", complaint_category: null };
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { sentiment: parsed.sentiment || "neutral", complaint_category: parsed.complaint_category || null };
    }
  } catch { /* ignore */ }
  return { sentiment: "neutral", complaint_category: null };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    await supabase.from("error_log").insert({ function_name: "scrape-stackoverflow", error_message: "Function started", context: "health-check" });

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "stackoverflow");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const summary = { fetched: 0, inserted: 0, classified: 0, skipped: 0, errors: [] as string[] };

    for (const term of SEARCH_TERMS) {
      try {
        const url = `https://api.stackexchange.com/2.3/search?order=desc&sort=activity&intitle=${encodeURIComponent(term)}&site=stackoverflow&pagesize=25&filter=withbody`;
        const res = await fetch(url);
        if (!res.ok) { summary.errors.push(`${term}: ${res.status}`); await delay(2000); continue; }

        const data = await res.json();
        const items = data.items || [];
        summary.fetched += items.length;

        for (const item of items) {
          // Filter to last 24h
          if (item.creation_date < oneDayAgo) continue;

          const title = item.title || "";
          const body = (item.body || "").replace(/<[^>]*>/g, "").slice(0, 2000);
          if (!isEnglish(title)) continue;

          const sourceUrl = item.link;
          if (!sourceUrl || existingUrls.has(sourceUrl)) { summary.skipped++; continue; }

          const matchedSlugs = matchModels(title + " " + body);
          if (matchedSlugs.length === 0) continue;

          const classification = await classifyPost(title, body, lovableApiKey);
          summary.classified++;

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;
            const { error } = await supabase.from("scraped_posts").insert({
              model_id: modelId, source: "stackoverflow", source_url: sourceUrl,
              title: title.slice(0, 500), content: body.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              score: item.score || 0,
              posted_at: new Date(item.creation_date * 1000).toISOString(),
            });
            if (error) { summary.errors.push(error.message); } else { summary.inserted++; existingUrls.add(sourceUrl); }
          }
        }
      } catch (e) {
        summary.errors.push(`${term}: ${e instanceof Error ? e.message : "unknown"}`);
      }
      await delay(2000);
    }

    await supabase.from("error_log").insert({
      function_name: "scrape-stackoverflow",
      error_message: `Done: inserted=${summary.inserted} fetched=${summary.fetched} classified=${summary.classified}`,
      context: `skipped=${summary.skipped} errors=${summary.errors.length}`,
    });

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown";
    await supabase.from("error_log").insert({ function_name: "scrape-stackoverflow", error_message: msg, context: "top-level error" });
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
