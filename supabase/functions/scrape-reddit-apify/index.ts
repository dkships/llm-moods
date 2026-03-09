import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUBREDDIT_MODEL_MAP: Record<string, string> = {
  "r/ClaudeAI": "claude",
  "r/claudeai": "claude",
  "r/ChatGPT": "chatgpt",
  "r/chatgpt": "chatgpt",
  "r/GoogleGemini": "gemini",
  "r/googlegemini": "gemini",
  "r/deepseek": "deepseek",
  "r/Deepseek": "deepseek",
  "r/perplexity_ai": "perplexity",
  "r/Perplexity_AI": "perplexity",
};

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "sonnet", "opus", "anthropic"],
  chatgpt: ["chatgpt", "gpt-5", "gpt-4", "gpt-4o", "gpt", "openai"],
  gemini: ["gemini", "gemini pro", "google ai"],
  grok: ["grok", "grok 4", "xai"],
  deepseek: ["deepseek", "deepseek r1", "deepseek v3"],
  perplexity: ["perplexity", "perplexity ai", "pplx"],
};

function matchModels(text: string, communityName?: string): string[] {
  const matched: string[] = [];
  if (communityName) {
    const subSlug = SUBREDDIT_MODEL_MAP[communityName];
    if (subSlug && !matched.includes(subSlug)) matched.push(subSlug);
  }
  const lower = text.toLowerCase();
  for (const [slug, keywords] of Object.entries(MODEL_KEYWORDS)) {
    if (matched.includes(slug)) continue;
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw.replace("-", "[-\\s]?")}\\b`, "i");
      if (regex.test(lower)) { matched.push(slug); break; }
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
    await supabase.from("error_log").insert({ function_name: "scrape-reddit-apify", error_message: msg, context: ctx || null });
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
    const apifyToken = Deno.env.get("APIFY_API_TOKEN");
    if (!apifyToken) {
      await logToErrorLog(supabase, "APIFY_API_TOKEN not configured", "config-error");
      return new Response(JSON.stringify({ error: "APIFY_API_TOKEN not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    await logToErrorLog(supabase, "Reddit Apify scraper started (async mode)", "health-check");

    // Step 1: Start the Apify run (async)
    const startUrl = `https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/runs?token=${apifyToken}`;
    const apifyInput = {
      startUrls: [
        { url: "https://www.reddit.com/r/ClaudeAI/new/" },
        { url: "https://www.reddit.com/r/ChatGPT/new/" },
        { url: "https://www.reddit.com/r/LocalLLaMA/new/" },
        { url: "https://www.reddit.com/r/GoogleGemini/new/" },
        { url: "https://www.reddit.com/r/deepseek/new/" },
        { url: "https://www.reddit.com/r/artificial/new/" },
        { url: "https://www.reddit.com/r/perplexity_ai/new/" },
      ],
      maxItems: 50,
      maxPostCount: 10,
      maxComments: 0,
      skipComments: true,
      proxy: { useApifyProxy: true },
    };

    const startRes = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apifyInput),
    });

    if (!startRes.ok) {
      const errorText = await startRes.text().catch(() => "unknown");
      await logToErrorLog(supabase, `Apify start failed HTTP ${startRes.status}: ${errorText.slice(0, 500)}`, "apify-error");
      return new Response(JSON.stringify({ error: `Apify start returned ${startRes.status}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const runData = await startRes.json();
    const runId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;
    if (!runId || !datasetId) {
      await logToErrorLog(supabase, `No runId/datasetId in response: ${JSON.stringify(runData).slice(0, 500)}`, "apify-error");
      return new Response(JSON.stringify({ error: "Missing runId from Apify" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await logToErrorLog(supabase, `Run started: runId=${runId} datasetId=${datasetId}`, "debug");

    // Step 2: Poll for completion (max ~4 minutes)
    const maxPolls = 24;
    const pollInterval = 10_000; // 10 seconds
    let runStatus = "";

    for (let i = 0; i < maxPolls; i++) {
      await delay(pollInterval);
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`);
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();
      runStatus = statusData.data?.status || "";
      if (runStatus === "SUCCEEDED" || runStatus === "FAILED" || runStatus === "ABORTED" || runStatus === "TIMED-OUT") break;
    }

    if (runStatus !== "SUCCEEDED") {
      await logToErrorLog(supabase, `Apify run ended with status: ${runStatus || "TIMEOUT"}`, "apify-error");
      return new Response(JSON.stringify({ error: `Apify run status: ${runStatus || "TIMEOUT"}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 3: Fetch dataset items
    const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`);
    if (!datasetRes.ok) {
      await logToErrorLog(supabase, `Dataset fetch failed: HTTP ${datasetRes.status}`, "apify-error");
      return new Response(JSON.stringify({ error: "Failed to fetch dataset" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const items = await datasetRes.json();
    if (!Array.isArray(items)) {
      await logToErrorLog(supabase, "Dataset response is not an array", "apify-error");
      return new Response(JSON.stringify({ error: "Invalid dataset response" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const posts = items.filter((item: any) => item.dataType === "post");

    // Load models and existing URLs
    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "reddit");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const summary = { apifyItems: items.length, apifyPosts: posts.length, filtered: 0, classified: 0, inserted: 0, langSkipped: 0, duplicateSkipped: 0, errors: [] as string[] };

    for (const post of posts) {
      const createdAt = new Date(post.createdAt);
      if (createdAt < cutoff) continue;

      const title = post.title || "";
      const body = post.body || "";
      const fullText = `${title} ${body}`;

      if (!isEnglish(fullText)) { summary.langSkipped++; continue; }

      const matchedSlugs = matchModels(fullText, post.communityName);
      if (matchedSlugs.length === 0) continue;
      summary.filtered++;

      const sourceUrl = post.url || "";
      if (!sourceUrl || existingUrls.has(sourceUrl)) { summary.duplicateSkipped++; continue; }

      const classification = await classifyPost(fullText, lovableApiKey);
      summary.classified++;

      for (const slug of matchedSlugs) {
        const modelId = modelMap[slug];
        if (!modelId) continue;
        const { error } = await supabase.from("scraped_posts").insert({
          model_id: modelId, source: "reddit", source_url: sourceUrl,
          title: title.slice(0, 120), content: (body || title).slice(0, 2000),
          sentiment: classification.sentiment, complaint_category: classification.complaint_category,
          score: post.upVotes || 0,
          posted_at: post.createdAt,
        });
        if (error) {
          summary.errors.push(`Insert: ${error.message}`);
        } else {
          summary.inserted++;
          existingUrls.add(sourceUrl);
        }
      }
    }

    await logToErrorLog(supabase, `Completed: apifyItems=${summary.apifyItems} apifyPosts=${summary.apifyPosts} filtered=${summary.filtered} classified=${summary.classified} inserted=${summary.inserted} langSkipped=${summary.langSkipped} dupes=${summary.duplicateSkipped} errors=${summary.errors.length}`, "summary");

    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
