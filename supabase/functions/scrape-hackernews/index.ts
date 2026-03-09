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
};

function isEnglish(text: string): boolean {
  const noWhitespace = text.replace(/\s/g, "");
  if (noWhitespace.length < 5) return true;
  const latinCount = (noWhitespace.match(/[a-zA-Z]/g) || []).length;
  return latinCount / noWhitespace.length >= 0.6;
}

const RELEVANT_DOMAINS = ["anthropic.com", "openai.com", "deepmind.google", "deepseek.com"];
const HN_API = "https://hacker-news.firebaseio.com/v0";

function matchModels(text: string, url?: string): string[] {
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
  if (url) {
    const lowerUrl = url.toLowerCase();
    for (const domain of RELEVANT_DOMAINS) {
      if (lowerUrl.includes(domain)) {
        const slug = domain.includes("anthropic") ? "claude"
          : domain.includes("openai") ? "chatgpt"
          : domain.includes("deepseek") ? "deepseek"
          : "gemini";
        if (!matched.includes(slug)) matched.push(slug);
      }
    }
  }
  return matched;
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string): Promise<any> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) { await res.text(); return null; }
    return res.json();
  } catch {
    return null;
  }
}

async function fetchInBatches<T>(
  ids: number[], batchSize: number, delayMs: number, fn: (id: number) => Promise<T | null>
): Promise<(T | null)[]> {
  const results: (T | null)[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < ids.length) await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}

async function classifyPost(
  title: string, content: string, apiKey: string
): Promise<{ sentiment: string; complaint_category: string | null }> {
  const truncated = (content || "").slice(0, 500);
  const prompt = `Classify this social media post about an AI model. Return ONLY valid JSON with two fields: sentiment (positive/negative/neutral) and complaint_category (lazy_responses/hallucinations/refusals/coding_quality/speed/general_drop or null if not negative). Classify as neutral ONLY if the post is purely factual news with zero opinion expressed. Most social media posts express some sentiment — when in doubt, choose positive or negative, not neutral. Posts with any emotional language, slang, sarcasm, or subjective judgment should NOT be neutral. Post: ${title} ${truncated}`;
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
      if (!res.ok) { await res.text(); return { sentiment: "neutral", complaint_category: null }; }
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { sentiment: parsed.sentiment || "neutral", complaint_category: parsed.complaint_category || null };
      }
    } catch {
      // classification failed
    }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    // Health check log
    await supabase.from("error_log").insert({ function_name: "scrape-hackernews", error_message: "Function started", context: "health-check" });

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "hackernews");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const [topIds, newIds, bestIds] = await Promise.all([
      fetchJson(`${HN_API}/topstories.json`),
      fetchJson(`${HN_API}/newstories.json`),
      fetchJson(`${HN_API}/beststories.json`),
    ]);

    const allIds = [...new Set([
      ...((topIds || []) as number[]).slice(0, 100),
      ...((newIds || []) as number[]).slice(0, 100),
      ...((bestIds || []) as number[]).slice(0, 100),
    ])];

    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, errors: [] as string[] };

    const items = await fetchInBatches(allIds, 10, 200, async (id) => fetchJson(`${HN_API}/item/${id}.json`));
    summary.fetched = items.filter(Boolean).length;

    for (const item of items) {
      if (!item || item.type !== "story" || !item.title) continue;

      const matchedSlugs = matchModels(item.title, item.url);
      if (matchedSlugs.length === 0) continue;
      summary.filtered++;

      const sourceUrl = `https://news.ycombinator.com/item?id=${item.id}`;
      if (existingUrls.has(sourceUrl)) continue;

      let commentText = "";
      const kids = (item.kids || []).slice(0, 5) as number[];
      if (kids.length > 0) {
        const comments = await fetchInBatches(kids, 5, 100, async (kid) => fetchJson(`${HN_API}/item/${kid}.json`));
        commentText = comments
          .filter((c) => c?.text)
          .map((c) => c!.text.replace(/<[^>]*>/g, "").slice(0, 200))
          .join(" ");
      }

      const fullContent = `${item.text || ""} ${commentText}`.trim();
      const classification = await classifyPost(item.title, fullContent, lovableApiKey);
      summary.classified++;

      for (const slug of matchedSlugs) {
        const modelId = modelMap[slug];
        if (!modelId) continue;

        const { error } = await supabase.from("scraped_posts").insert({
          model_id: modelId, source: "hackernews", source_url: sourceUrl,
          title: item.title.slice(0, 500), content: fullContent.slice(0, 2000),
          sentiment: classification.sentiment, complaint_category: classification.complaint_category,
          score: item.score || 0,
          posted_at: item.time ? new Date(item.time * 1000).toISOString() : new Date().toISOString(),
        });

        if (error) {
          summary.errors.push(`Insert: ${error.message}`);
          await logToErrorLog(supabase, "scrape-hackernews", error.message, `insert for ${slug}`);
        } else {
          summary.inserted++;
          existingUrls.add(sourceUrl);
        }
      }
    }

    await logToErrorLog(supabase, "scrape-hackernews", `Successfully scraped ${summary.inserted} posts from hackernews`, `fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified}`);

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
