import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyPost } from "../_shared/classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  try { await supabase.from("error_log").insert({ function_name: "scrape-twitter", error_message: msg, context: ctx || null }); } catch (e) { console.error("logToErrorLog failed:", msg, e); }
}

const GROK_SEARCH_PROMPT = `Search X/Twitter for recent posts (last 24 hours) about these AI models: Claude, ChatGPT, GPT-4, GPT-4o, Gemini, Grok, DeepSeek, Perplexity, GitHub Copilot, Llama, Mistral.

Find posts where users share their direct experience with these models — complaints, praise, comparisons of output quality, etc.

For EACH relevant post found, classify it and return a JSON array. Each element:
{
  "text": "the tweet text",
  "tweet_url": "https://x.com/user/status/123",
  "model": "claude|chatgpt|gemini|grok|deepseek|perplexity|copilot|llama|mistral",
  "sentiment": "positive|negative|neutral",
  "complaint_category": "lazy_responses|hallucinations|refusals|coding_quality|speed|general_drop|pricing_value|censorship|context_window|api_reliability|multimodal_quality|reasoning" or null,
  "praise_category": "output_quality|coding_quality|speed|reasoning|creativity|value|reliability|context_handling|multimodal_quality|general_improvement" or null,
  "confidence": 0.0-1.0,
  "posted_at": "ISO date string"
}

Skip posts that are just news, funding announcements, tutorials, or opinions about AI in general.
Return ONLY the JSON array, no other text.`;

// ─── Apify path ───────────────────────────────────────────────────────────────

async function runApifyPath(
  supabase: any,
  apifyToken: string,
  modelMap: Record<string, string>,
  keywords: KeywordEntry[],
  existingUrls: Set<string>,
  titleKeys: Set<string>,
  lovableApiKey: string,
) {
  const summary = {
    fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0,
    langSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[],
    backend: "apify" as const,
  };

  // Step 1 — Start actor run
  const startUrl = `https://api.apify.com/v2/acts/scrape.badger~twitter-tweets-scraper/runs?token=${apifyToken}`;
  const yesterday = new Date(Date.now() - 24 * 3600000).toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];
  // Use Twitter search operators for date/language filtering inside searchTerms
  const baseTerms = [
    "Claude AI", "ChatGPT", "Gemini AI", "Grok AI",
    "DeepSeek", "Perplexity AI", "GitHub Copilot", "Llama AI", "Mistral AI",
  ];
  const apifyInput = {
    mode: "Advanced Search",
    query: `(${baseTerms.join(" OR ")}) lang:en since:${yesterday} until:${today}`,
    query_type: "Latest",
    max_results: 200,
  };

  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apifyInput),
  });

  if (!startRes.ok) {
    const errorText = await startRes.text().catch(() => "unknown");
    await logToErrorLog(supabase, `Apify start failed HTTP ${startRes.status}: ${errorText.slice(0, 500)}`, "apify-error");
    // Treat quota/billing errors as a graceful skip so the orchestrator doesn't report a failure
    if (startRes.status === 402 || startRes.status === 403) {
      summary.errors.push(`Apify quota exceeded (HTTP ${startRes.status})`);
      return summary;
    }
    throw new Error(`Apify start returned ${startRes.status}`);
  }

  const runData = await startRes.json();
  const runId = runData.data?.id;
  const datasetId = runData.data?.defaultDatasetId;
  if (!runId || !datasetId) {
    await logToErrorLog(supabase, "No runId/datasetId from Apify", "apify-error");
    throw new Error("Missing runId from Apify");
  }

  // Step 2 — Poll status (10s intervals, max 12 polls = 2 min to stay within Edge Function wall-clock limits)
  const maxPolls = 12;
  let runStatus = "";
  for (let i = 0; i < maxPolls; i++) {
    await delay(10000);
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`);
    if (!statusRes.ok) continue;
    const statusData = await statusRes.json();
    runStatus = statusData.data?.status || "";
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(runStatus)) break;
  }

  if (!["SUCCEEDED", "ABORTED"].includes(runStatus)) {
    await logToErrorLog(supabase, `Apify run status: ${runStatus || "TIMEOUT"}`, "apify-error");
    throw new Error(`Apify run status: ${runStatus || "TIMEOUT"}`);
  }

  // Step 3 — Fetch dataset items
  const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`);
  if (!datasetRes.ok) throw new Error("Failed to fetch Apify dataset");

  const rawItems = await datasetRes.json();
  if (!Array.isArray(rawItems)) throw new Error("Invalid dataset response");

  // Filter items that have text content (handles both actor output formats)
  const items = rawItems.filter((item: any) => item.text || item.full_text);
  await logToErrorLog(supabase, `Apify raw=${rawItems.length} tweets=${items.length}`, "apify-debug");

  const cutoff = new Date(Date.now() - 24 * 3600000);
  summary.fetched = items.length;

  for (const tweet of items) {
    // Skip retweets (handle both field naming conventions)
    if (tweet.isRetweet || tweet.is_retweet) continue;

    // Parse tweet date (handle both camelCase and snake_case actor formats)
    const createdAt = new Date(tweet.created_at || tweet.createdAt);
    if (isNaN(createdAt.getTime()) || createdAt < cutoff) continue;

    const text = (tweet.text || tweet.full_text || "").slice(0, 2000);
    if (!text) continue;

    // Check lang field if available, otherwise use heuristic
    if (tweet.lang && tweet.lang !== "en" && tweet.lang !== "und") { summary.langSkipped++; continue; }
    if (!isEnglish(text)) { summary.langSkipped++; continue; }
    if (!meetsMinLength(text, "")) { summary.contentSkipped++; continue; }

    const matchedSlugs = matchModels(text, keywords);
    if (matchedSlugs.length === 0) continue;
    summary.filtered++;

    // Build source URL
    const screenName = tweet.username || tweet.user?.screen_name || tweet.screen_name || tweet.author?.userName || "";
    const sourceUrl = tweet.url || (screenName && tweet.id
      ? `https://x.com/${screenName}/status/${tweet.id}`
      : "");
    if (!sourceUrl || existingUrls.has(sourceUrl)) { summary.dedupSkipped++; continue; }

    let allDuped = true;
    const title = text.slice(0, 500);
    for (const slug of matchedSlugs) {
      const modelId = modelMap[slug];
      if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
    }
    if (allDuped) { summary.dedupSkipped++; continue; }

    const classification = await classifyPost(text, lovableApiKey);
    summary.classified++;
    if (!classification.relevant) { summary.irrelevant++; continue; }

    for (const slug of matchedSlugs) {
      const modelId = modelMap[slug];
      if (!modelId || isDuplicate(titleKeys, title, modelId)) continue;
      const { error } = await supabase.from("scraped_posts").upsert({
        model_id: modelId, source: "twitter", source_url: sourceUrl,
        title: title.slice(0, 120), content: text.slice(0, 2000),
        sentiment: classification.sentiment, complaint_category: classification.complaint_category,
        praise_category: classification.praise_category,
        confidence: classification.confidence, content_type: "title_only",
        score: (tweet.favorite_count || tweet.likeCount || 0) + (tweet.retweet_count || tweet.retweetCount || 0),
        posted_at: createdAt.toISOString(),
      }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
      if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
        summary.inserted++;
        existingUrls.add(sourceUrl);
        titleKeys.add(`${modelId}:${title.slice(0, 80).toLowerCase()}`);
      }
    }
  }

  return summary;
}

const VALID_SENTIMENTS = new Set(["positive", "negative", "neutral"]);
const VALID_COMPLAINTS = new Set([
  "lazy_responses", "hallucinations", "refusals", "coding_quality", "speed",
  "general_drop", "pricing_value", "censorship", "context_window",
  "api_reliability", "multimodal_quality", "reasoning",
]);
const VALID_PRAISES = new Set([
  "output_quality", "coding_quality", "speed", "reasoning", "creativity",
  "value", "reliability", "context_handling", "multimodal_quality",
  "general_improvement",
]);

// ─── Grok path (fallback) ─────────────────────────────────────────────────────

async function runGrokPath(
  supabase: any,
  xaiApiKey: string,
  modelMap: Record<string, string>,
  keywords: KeywordEntry[],
  existingUrls: Set<string>,
  titleKeys: Set<string>,
) {
  const summary = {
    fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0,
    langSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[],
    backend: "grok" as const,
  };

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600000);

  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast",
      input: [{ role: "user", content: GROK_SEARCH_PROMPT }],
      tools: [{
        type: "x_search",
        from_date: yesterday.toISOString().split("T")[0],
        to_date: now.toISOString().split("T")[0],
      }],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown");
    await logToErrorLog(supabase, `Grok API HTTP ${res.status}: ${errorText.slice(0, 500)}`, "grok-error");
    throw new Error(`Grok API returned ${res.status}`);
  }

  const data = await res.json();

  // Extract JSON array from Grok response
  let posts: any[] = [];
  const outputItems = data.output || [];
  for (const item of outputItems) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type !== "output_text") continue;
      const text = content.text || "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try { posts = JSON.parse(jsonMatch[0]); } catch {}
      }
    }
  }

  summary.fetched = posts.length;

  for (const post of posts) {
    if (!post.text || !post.tweet_url) continue;

    const text = post.text.slice(0, 2000);
    const sourceUrl = post.tweet_url;

    if (existingUrls.has(sourceUrl)) { summary.dedupSkipped++; continue; }

    // Use Grok's model field to match, but also run keyword matching for model_id resolution
    const matchedSlugs = matchModels(text, keywords);
    // If Grok identified a model but keywords didn't match, try the Grok model field
    if (matchedSlugs.length === 0 && post.model) {
      const grokSlug = post.model.toLowerCase();
      if (modelMap[grokSlug]) matchedSlugs.push(grokSlug);
    }
    if (matchedSlugs.length === 0) continue;
    summary.filtered++;

    const title = text.slice(0, 500);
    let allDuped = true;
    for (const slug of matchedSlugs) {
      const modelId = modelMap[slug];
      if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
    }
    if (allDuped) { summary.dedupSkipped++; continue; }

    // Grok already classified — validate against allowed values before inserting
    const sentiment = VALID_SENTIMENTS.has(post.sentiment) ? post.sentiment : null;
    if (!sentiment) { summary.irrelevant++; continue; }
    summary.classified++;

    const complaint = VALID_COMPLAINTS.has(post.complaint_category) ? post.complaint_category : null;
    const praise = VALID_PRAISES.has(post.praise_category) ? post.praise_category : null;
    const confidence = typeof post.confidence === "number" && post.confidence >= 0 && post.confidence <= 1
      ? post.confidence : 0.5;
    const postedAt = post.posted_at ? new Date(post.posted_at).toISOString() : new Date().toISOString();

    for (const slug of matchedSlugs) {
      const modelId = modelMap[slug];
      if (!modelId || isDuplicate(titleKeys, title, modelId)) continue;
      const { error } = await supabase.from("scraped_posts").upsert({
        model_id: modelId, source: "twitter", source_url: sourceUrl,
        title: title.slice(0, 120), content: text.slice(0, 2000),
        sentiment, complaint_category: complaint,
        praise_category: praise,
        confidence,
        content_type: "title_only",
        score: 0, // Grok doesn't provide engagement metrics
        posted_at: postedAt,
      }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
      if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
        summary.inserted++;
        existingUrls.add(sourceUrl);
        titleKeys.add(`${modelId}:${title.slice(0, 80).toLowerCase()}`);
      }
    }
  }

  return summary;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const apifyToken = Deno.env.get("APIFY_API_TOKEN");
    const xaiApiKey = Deno.env.get("XAI_API_KEY");

    if (!apifyToken && !xaiApiKey) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "No X credentials (set APIFY_API_TOKEN or XAI_API_KEY)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lovableApiKey = Deno.env.get("GEMINI_API_KEY");
    if (apifyToken && !lovableApiKey) {
      await logToErrorLog(supabase, "GEMINI_API_KEY not set — required for Apify path sentiment classification", "config-error");
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured (required for Apify path)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await logToErrorLog(supabase, "Twitter scraper started", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);

    const { data: existingData } = await supabase
      .from("scraped_posts").select("source_url").eq("source", "twitter").limit(10000);
    const existingUrls = new Set((existingData || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    let summary;
    if (apifyToken) {
      summary = await runApifyPath(supabase, apifyToken, modelMap, keywords, existingUrls, titleKeys, lovableApiKey!);
    } else {
      summary = await runGrokPath(supabase, xaiApiKey!, modelMap, keywords, existingUrls, titleKeys);
    }

    await logToErrorLog(
      supabase,
      `Completed (${summary.backend}): fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted} dedupSkipped=${summary.dedupSkipped}`,
      "summary",
    );

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
