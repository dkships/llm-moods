import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HASHTAGS = ["chatgpt", "claude", "gemini", "grok", "deepseek", "llm", "openai", "anthropic"];

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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function isEnglish(text: string): boolean {
  const noWhitespace = text.replace(/\s/g, "");
  if (noWhitespace.length < 5) return true;
  const latinCount = (noWhitespace.match(/[a-zA-Z]/g) || []).length;
  return latinCount / noWhitespace.length >= 0.6;
}

async function logToErrorLog(supabase: any, msg: string, ctx?: string) {
  try {
    await supabase.from("error_log").insert({ function_name: "scrape-mastodon", error_message: msg, context: ctx || null });
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
    await logToErrorLog(supabase, "Mastodon scraper started (hashtag timelines)", "health-check");

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "mastodon");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, errors: [] as string[] };
    let reqIdx = 0;

    for (const hashtag of HASHTAGS) {
      if (reqIdx > 0) await delay(1000);
      reqIdx++;

      try {
        const url = `https://mastodon.social/api/v1/timelines/tag/${hashtag}?limit=40`;
        const res = await fetch(url, { headers: { "Accept": "application/json" } });

        if (reqIdx <= 3) {
          await logToErrorLog(supabase, `Hashtag #${hashtag} status=${res.status}`, "debug");
        }

        if (!res.ok) {
          summary.errors.push(`#${hashtag}: HTTP ${res.status}`);
          continue;
        }

        const statuses = await res.json();
        if (!Array.isArray(statuses)) {
          summary.errors.push(`#${hashtag}: response not an array`);
          continue;
        }
        summary.fetched += statuses.length;

        for (const status of statuses) {
          const createdAt = new Date(status.created_at);
          if (createdAt < cutoff) continue;

          const content = stripHtml(status.content || "");
          const matchedSlugs = matchModels(content);
          if (matchedSlugs.length === 0) continue;
          summary.filtered++;

          const sourceUrl = status.url || "";
          if (!sourceUrl || existingUrls.has(sourceUrl)) continue;

          const classification = await classifyPost(content, lovableApiKey);
          summary.classified++;

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;
            const { error } = await supabase.from("scraped_posts").insert({
              model_id: modelId, source: "mastodon", source_url: sourceUrl,
              title: content.slice(0, 120), content: content.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              score: (status.reblogs_count || 0) + (status.favourites_count || 0),
              posted_at: status.created_at,
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
        summary.errors.push(`#${hashtag}: ${msg}`);
      }
    }

    await logToErrorLog(supabase, `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} inserted=${summary.inserted} errors=${summary.errors.length}`, "summary");

    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
