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

function matchModels(text: string, keywords: KeywordEntry[], communityName?: string): string[] {
  const matched: string[] = [];
  if (communityName) {
    const subSlug = SUBREDDIT_MODEL_MAP[communityName];
    if (subSlug && !matched.includes(subSlug)) matched.push(subSlug);
  }
  const lower = text.toLowerCase();
  // Tier 1: high confidence (check longer phrases first)
  const highKws = keywords.filter(k => k.tier === "high").sort((a, b) => b.keyword.length - a.keyword.length);
  for (const k of highKws) {
    if (matched.includes(k.model_slug)) continue;
    const regex = new RegExp(`\\b${k.keyword.replace(/[-\.]/g, "[-\\s.]?")}\\b`, "i");
    if (regex.test(lower)) matched.push(k.model_slug);
  }
  // Tier 2: ambiguous (only if context words present)
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
  try { await supabase.from("error_log").insert({ function_name: "scrape-reddit-apify", error_message: msg, context: ctx || null }); } catch {}
}

const CLASSIFY_PROMPT = `You are analyzing a social media post to determine if it expresses an opinion about the quality or performance of an AI language model (like ChatGPT, Claude, Gemini, Grok, DeepSeek, or Perplexity).

Step 1 — RELEVANCE: Is this post actually about the user's experience with an AI model's quality, performance, or behavior? Posts about AI news, company business decisions, stock prices, hiring, or general AI discussion WITHOUT a quality opinion are NOT relevant.

Step 2 — If relevant, classify sentiment and complaint type.

Also return a "confidence" field between 0.0 and 1.0 indicating how confident you are in this classification. 1.0 = clearly about this model with clear sentiment. 0.5 = ambiguous or could go either way. 0.0 = random guess.

Return ONLY valid JSON:
{"relevant": true/false, "sentiment": "positive"/"negative"/"neutral", "complaint_category": "lazy_responses"/"hallucinations"/"refusals"/"coding_quality"/"speed"/"general_drop"/null, "confidence": 0.0-1.0}

If relevant is false, sentiment and complaint_category should be null.
Classify as neutral ONLY if genuinely no opinion is expressed. Most posts that ARE relevant express clear sentiment. When in doubt between neutral and negative, lean negative. When in doubt between neutral and positive, lean positive.

Post to classify: `;

async function classifyPost(text: string, apiKey: string): Promise<{ relevant: boolean; sentiment: string | null; complaint_category: string | null; confidence: number }> {
  const truncated = text.slice(0, 600);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "user", content: CLASSIFY_PROMPT + truncated }] }),
    });
    if (!res.ok) return { relevant: true, sentiment: "neutral", complaint_category: null, confidence: 0.5 };
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { relevant: parsed.relevant !== false, sentiment: parsed.sentiment || null, complaint_category: parsed.complaint_category || null, confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5 };
    }
    return { relevant: true, sentiment: "neutral", complaint_category: null, confidence: 0.5 };
  } catch { return { relevant: true, sentiment: "neutral", complaint_category: null, confidence: 0.5 }; }
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
    await logToErrorLog(supabase, "Reddit Apify scraper started (v2 - tiered matching)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);

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
      maxItems: 50, maxPostCount: 10, maxComments: 0, skipComments: true,
      proxy: { useApifyProxy: true },
    };

    const startRes = await fetch(startUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apifyInput) });
    if (!startRes.ok) {
      const errorText = await startRes.text().catch(() => "unknown");
      await logToErrorLog(supabase, `Apify start failed HTTP ${startRes.status}: ${errorText.slice(0, 500)}`, "apify-error");
      return new Response(JSON.stringify({ error: `Apify start returned ${startRes.status}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const runData = await startRes.json();
    const runId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;
    if (!runId || !datasetId) {
      await logToErrorLog(supabase, `No runId/datasetId`, "apify-error");
      return new Response(JSON.stringify({ error: "Missing runId from Apify" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const maxPolls = 24;
    let runStatus = "";
    for (let i = 0; i < maxPolls; i++) {
      await delay(10000);
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`);
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();
      runStatus = statusData.data?.status || "";
      if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(runStatus)) break;
    }

    if (runStatus !== "SUCCEEDED") {
      await logToErrorLog(supabase, `Apify run status: ${runStatus || "TIMEOUT"}`, "apify-error");
      return new Response(JSON.stringify({ error: `Apify run status: ${runStatus || "TIMEOUT"}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`);
    if (!datasetRes.ok) return new Response(JSON.stringify({ error: "Failed to fetch dataset" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const items = await datasetRes.json();
    if (!Array.isArray(items)) return new Response(JSON.stringify({ error: "Invalid dataset response" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const posts = items.filter((item: any) => item.dataType === "post");
    const { data: existingData } = await supabase.from("scraped_posts").select("source_url").eq("source", "reddit");
    const existingUrls = new Set((existingData || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const cutoff = new Date(Date.now() - 24 * 3600000);
    const summary = { apifyItems: items.length, apifyPosts: posts.length, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, langSkipped: 0, duplicateSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    for (const post of posts) {
      const createdAt = new Date(post.createdAt);
      if (createdAt < cutoff) continue;

      const title = post.title || "";
      const body = post.body || "";
      const fullText = `${title} ${body}`;

      if (!isEnglish(fullText)) { summary.langSkipped++; continue; }
      if (!meetsMinLength(title, body)) { summary.contentSkipped++; continue; }

      const matchedSlugs = matchModels(fullText, keywords, post.communityName);
      if (matchedSlugs.length === 0) continue;
      summary.filtered++;

      const sourceUrl = post.url || "";
      if (!sourceUrl || existingUrls.has(sourceUrl)) { summary.duplicateSkipped++; continue; }

      let allDuped = true;
      for (const slug of matchedSlugs) {
        const modelId = modelMap[slug];
        if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
      }
      if (allDuped) { summary.dedupSkipped++; continue; }

      const classification = await classifyPost(fullText, lovableApiKey);
      summary.classified++;
      if (!classification.relevant) { summary.irrelevant++; continue; }

      for (const slug of matchedSlugs) {
        const modelId = modelMap[slug];
        if (!modelId || isDuplicate(titleKeys, title, modelId)) continue;
        const { error } = await supabase.from("scraped_posts").insert({
          model_id: modelId, source: "reddit", source_url: sourceUrl,
          title: title.slice(0, 120), content: (body || title).slice(0, 2000),
          sentiment: classification.sentiment, complaint_category: classification.complaint_category,
          confidence: classification.confidence, content_type: body ? "title_and_body" : "title_only",
          score: post.upVotes || 0, posted_at: post.createdAt,
        });
        if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
          summary.inserted++;
          existingUrls.add(sourceUrl);
          titleKeys.add(`${modelId}:${title.slice(0, 80).toLowerCase()}`);
        }
      }
    }

    await logToErrorLog(supabase, `Completed: posts=${summary.apifyPosts} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted} dedupSkipped=${summary.dedupSkipped}`, "summary");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
