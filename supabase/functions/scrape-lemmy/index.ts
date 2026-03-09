import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INSTANCES = ["https://lemmy.world", "https://lemmy.ml"];
const SEARCH_TERMS = ["Claude", "ChatGPT", "GPT-5", "Gemini", "Grok", "DeepSeek", "LLM"];

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "sonnet", "opus", "anthropic"],
  chatgpt: ["chatgpt", "gpt-5", "gpt-4", "gpt-4o", "gpt", "openai"],
  gemini: ["gemini", "gemini pro", "google ai"],
  grok: ["grok", "grok 4", "xai"],
  deepseek: ["deepseek", "deepseek r1", "deepseek v3"],
};

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

function isEnglish(text: string): boolean {
  const noWhitespace = text.replace(/\s/g, "");
  if (noWhitespace.length < 5) return true;
  const latinCount = (noWhitespace.match(/[a-zA-Z]/g) || []).length;
  return latinCount / noWhitespace.length >= 0.6;
}

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function logToErrorLog(supabase: any, msg: string, ctx?: string) {
  try {
    await supabase.from("error_log").insert({ function_name: "scrape-lemmy", error_message: msg, context: ctx || null });
  } catch {}
}

async function classifyPost(text: string, apiKey: string): Promise<{ sentiment: string; complaint_category: string | null }> {
  const truncated = text.slice(0, 500);
  const prompt = `Classify this social media post about an AI model. Return ONLY valid JSON with two fields: sentiment (positive/negative/neutral) and complaint_category (lazy_responses/hallucinations/refusals/coding_quality/speed/general_drop or null if not negative). Classify as neutral ONLY if the post is purely factual news with zero opinion expressed. Most social media posts express some sentiment — when in doubt, choose positive or negative, not neutral. Posts with any emotional language, slang, sarcasm, or subjective judgment should NOT be neutral. Post: ${truncated}`;
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
    return { sentiment: "neutral", complaint_category: null };
  } catch { return { sentiment: "neutral", complaint_category: null }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    await logToErrorLog(supabase, "Lemmy scraper started", "health-check");

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "lemmy");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, langSkipped: 0, errors: [] as string[] };
    let reqIdx = 0;

    for (const instance of INSTANCES) {
      for (const term of SEARCH_TERMS) {
        if (reqIdx > 0) await delay(2000);
        reqIdx++;

        try {
          const url = `${instance}/api/v3/search?q=${encodeURIComponent(term)}&type_=Posts&sort=New&limit=20`;
          const res = await fetch(url, { headers: { "Accept": "application/json" } });

          if (!res.ok) {
            summary.errors.push(`${instance} "${term}": HTTP ${res.status}`);
            continue;
          }

          const json = await res.json();
          const posts = json.posts || [];
          summary.fetched += posts.length;

          for (const item of posts) {
            const post = item.post || item.post_view?.post;
            const counts = item.counts || item.post_view?.counts;
            if (!post) continue;

            const publishedAt = new Date(post.published);
            if (publishedAt < cutoff) continue;

            const title = post.name || "";
            const body = post.body || "";
            const fullText = `${title} ${body}`;

            if (!isEnglish(fullText)) {
              summary.langSkipped++;
              continue;
            }

            const matchedSlugs = matchModels(fullText);
            if (matchedSlugs.length === 0) continue;
            summary.filtered++;

            const sourceUrl = post.ap_id || "";
            if (!sourceUrl || existingUrls.has(sourceUrl)) continue;

            const classification = await classifyPost(fullText, lovableApiKey);
            summary.classified++;

            for (const slug of matchedSlugs) {
              const modelId = modelMap[slug];
              if (!modelId) continue;
              const { error } = await supabase.from("scraped_posts").insert({
                model_id: modelId, source: "lemmy", source_url: sourceUrl,
                title: title.slice(0, 120), content: (body || title).slice(0, 2000),
                sentiment: classification.sentiment, complaint_category: classification.complaint_category,
                score: counts?.score || 0,
                posted_at: post.published,
              });
              if (error) {
                summary.errors.push(`Insert: ${error.message}`);
              } else {
                summary.inserted++;
                existingUrls.add(sourceUrl);
              }
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          summary.errors.push(`${instance} "${term}": ${msg}`);
        }
      }
    }

    await logToErrorLog(supabase, `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} inserted=${summary.inserted} langSkipped=${summary.langSkipped} errors=${summary.errors.length}`, "summary");

    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
