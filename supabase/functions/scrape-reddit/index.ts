import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUBREDDITS = ["ClaudeAI", "ChatGPT", "LocalLLaMA", "GoogleGemini", "singularity", "artificial", "deepseek"];

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "sonnet", "opus", "anthropic"],
  chatgpt: ["chatgpt", "gpt-5", "gpt-4", "gpt-4o", "gpt", "openai"],
  gemini: ["gemini", "gemini pro", "google ai"],
  grok: ["grok", "grok 4", "xai"],
  deepseek: ["deepseek", "deepseek r1", "deepseek v3"],
};

const USER_AGENT = "llmvibes:v1.0 (contact: hello@llmvibes.ai)";

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

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function classifyPost(
  title: string, content: string, apiKey: string
): Promise<{ sentiment: string; complaint_category: string | null }> {
  const truncated = (content || "").slice(0, 500);
  const prompt = `Classify this social media post about an AI model. Return ONLY valid JSON with two fields: sentiment (positive/negative/neutral) and complaint_category (lazy_responses/hallucinations/refusals/coding_quality/speed/general_drop or null if not negative). Post: ${title} ${truncated}`;
  try {
    const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) { await res.text(); return { sentiment: "neutral", complaint_category: null }; }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { sentiment: parsed.sentiment || "neutral", complaint_category: parsed.complaint_category || null };
    }
    return { sentiment: "neutral", complaint_category: null };
  } catch {
    return { sentiment: "neutral", complaint_category: null };
  }
}

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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
    await supabase.from("error_log").insert({ function_name: "scrape-reddit", error_message: "Function started", context: "health-check" });

    const { data: models, error: modelsErr } = await supabase.from("models").select("id, slug");
    if (modelsErr) throw modelsErr;

    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "reddit");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, errors: [] as string[] };

    for (let i = 0; i < SUBREDDITS.length; i++) {
      const sub = SUBREDDITS[i];
      if (i > 0) await delay(2000);

      try {
        const res = await fetchWithTimeout(
          `https://www.reddit.com/r/${sub}/new.json?limit=25`,
          { headers: { "User-Agent": USER_AGENT } }
        );
        if (!res.ok) {
          const msg = `r/${sub}: HTTP ${res.status}`;
          summary.errors.push(msg);
          await logToErrorLog(supabase, "scrape-reddit", `Reddit fetch failed: ${msg}`, sub);
          continue;
        }

        const json = await res.json();
        const posts = json?.data?.children || [];
        summary.fetched += posts.length;

        for (const child of posts) {
          const post = child.data;
          const text = `${post.title || ""} ${post.selftext || ""}`;
          const matchedSlugs = matchModels(text);
          if (matchedSlugs.length === 0) continue;
          summary.filtered++;

          const sourceUrl = `https://www.reddit.com${post.permalink}`;
          if (existingUrls.has(sourceUrl)) continue;

          const classification = await classifyPost(post.title || "", post.selftext || "", lovableApiKey);
          summary.classified++;

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;

            const { error: insertErr } = await supabase.from("scraped_posts").insert({
              model_id: modelId, source: "reddit", source_url: sourceUrl,
              title: (post.title || "").slice(0, 500), content: (post.selftext || "").slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              score: post.score || 0,
              posted_at: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : new Date().toISOString(),
            });

            if (insertErr) {
              summary.errors.push(`Insert: ${insertErr.message}`);
              await logToErrorLog(supabase, "scrape-reddit", insertErr.message, `insert for ${slug} in r/${sub}`);
            } else {
              summary.inserted++;
              existingUrls.add(sourceUrl);
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        summary.errors.push(`r/${sub}: ${msg}`);
        await logToErrorLog(supabase, "scrape-reddit", msg, sub);
      }
    }

    await logToErrorLog(supabase, "scrape-reddit", `Successfully scraped ${summary.inserted} posts from reddit`, `fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified}`);

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown error";
    await logToErrorLog(supabase, "scrape-reddit", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
