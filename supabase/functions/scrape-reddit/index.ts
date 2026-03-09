import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEDICATED_SUBS: Record<string, string> = {
  ClaudeAI: "claude",
  ChatGPT: "chatgpt",
  GoogleGemini: "gemini",
  deepseek: "deepseek",
};

const GENERAL_SUBS = ["LocalLLaMA", "singularity", "artificial"];
const GENERAL_SEARCH_TERMS = ["Claude", "ChatGPT", "Gemini", "Grok", "DeepSeek"];

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "sonnet", "opus", "anthropic"],
  chatgpt: ["chatgpt", "gpt-5", "gpt-4", "gpt-4o", "gpt", "openai"],
  gemini: ["gemini", "gemini pro", "google ai"],
  grok: ["grok", "grok 4", "xai"],
  deepseek: ["deepseek", "deepseek r1", "deepseek v3"],
};

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PULLPUSH_UA = "llmvibes:v1.0 (contact: hello@llmvibes.ai)";
const DELAY_MS = 4000;

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

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
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

interface RedditPost {
  title?: string;
  selftext?: string;
  permalink?: string;
  created_utc?: number;
  score?: number;
  author?: string;
  subreddit?: string;
}

// Track how many PullPush calls we've made for debug logging
let debugCallCount = 0;

async function fetchPullPush(
  supabase: any, subreddit: string, query: string | null, afterEpoch: number
): Promise<RedditPost[]> {
  const params = new URLSearchParams({
    subreddit,
    sort: "desc",
    size: "25",
    after: String(afterEpoch),
  });
  if (query) params.set("q", query);

  const url = `https://api.pullpush.io/reddit/search/submission/?${params.toString()}`;

  const shouldLog = debugCallCount < 3;
  debugCallCount++;

  if (shouldLog) {
    await logToErrorLog(supabase, "scrape-reddit", `PullPush URL: ${url}`, "debug-url");
  }

  const res = await fetchWithTimeout(url, { headers: { "User-Agent": PULLPUSH_UA } });
  const bodyText = await res.text();

  if (shouldLog) {
    await logToErrorLog(supabase, "scrape-reddit", `PullPush status=${res.status} body=${bodyText.slice(0, 500)}`, "debug-response");
  }

  if (!res.ok) {
    throw new Error(`PullPush HTTP ${res.status} for r/${subreddit}${query ? ` q=${query}` : ""}`);
  }

  const json = JSON.parse(bodyText);
  return json?.data || [];
}

async function fetchOldReddit(
  supabase: any, subreddit: string, query: string | null
): Promise<RedditPost[]> {
  // For old.reddit.com fallback we fetch /new.json or /search.json
  let url: string;
  if (query) {
    url = `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&sort=new&t=day&limit=25`;
  } else {
    url = `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?limit=25`;
  }

  await logToErrorLog(supabase, "scrape-reddit", `Fallback URL: ${url}`, "debug-fallback");

  const res = await fetchWithTimeout(url, { headers: { "User-Agent": BROWSER_UA } });
  const bodyText = await res.text();

  await logToErrorLog(supabase, "scrape-reddit", `Fallback status=${res.status} body=${bodyText.slice(0, 300)}`, "debug-fallback-response");

  if (!res.ok) {
    throw new Error(`old.reddit fallback HTTP ${res.status} for r/${subreddit}`);
  }

  const json = JSON.parse(bodyText);
  const children = json?.data?.children || [];
  return children.map((c: any) => ({
    title: c.data?.title,
    selftext: c.data?.selftext,
    permalink: c.data?.permalink,
    created_utc: c.data?.created_utc,
    score: c.data?.score,
    author: c.data?.author,
    subreddit: c.data?.subreddit,
  }));
}

async function fetchRedditPosts(
  supabase: any, subreddit: string, query: string | null, afterEpoch: number
): Promise<RedditPost[]> {
  try {
    const posts = await fetchPullPush(supabase, subreddit, query, afterEpoch);
    if (posts.length > 0) return posts;
    // PullPush returned 0 results — try fallback
    await logToErrorLog(supabase, "scrape-reddit", `PullPush returned 0 for r/${subreddit}${query ? ` q=${query}` : ""}, trying old.reddit fallback`, "fallback");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logToErrorLog(supabase, "scrape-reddit", `PullPush failed: ${msg}, trying old.reddit fallback`, "fallback");
  }

  try {
    return await fetchOldReddit(supabase, subreddit, query);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logToErrorLog(supabase, "scrape-reddit", `Fallback also failed: ${msg}`, "fallback-error");
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Reset debug counter each invocation
  debugCallCount = 0;

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    await logToErrorLog(supabase, "scrape-reddit", "Function started", "health-check");

    const { data: models, error: modelsErr } = await supabase.from("models").select("id, slug");
    if (modelsErr) throw modelsErr;
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "reddit");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const afterEpoch = Math.floor(Date.now() / 1000) - 86400; // Unix seconds, 24h ago
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, errors: [] as string[] };
    const seenPermalinks = new Set<string>();
    let requestCount = 0;

    async function processPosts(posts: RedditPost[], defaultSlug?: string) {
      for (const post of posts) {
        const permalink = post.permalink || "";
        if (!permalink || seenPermalinks.has(permalink)) continue;
        seenPermalinks.add(permalink);

        const text = `${post.title || ""} ${post.selftext || ""}`;
        let matchedSlugs = defaultSlug ? [defaultSlug] : matchModels(text);
        if (!defaultSlug && matchedSlugs.length === 0) continue;
        if (defaultSlug) {
          const additional = matchModels(text);
          for (const s of additional) {
            if (!matchedSlugs.includes(s)) matchedSlugs.push(s);
          }
        }
        summary.filtered++;

        const sourceUrl = `https://www.reddit.com${permalink}`;
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
            await logToErrorLog(supabase, "scrape-reddit", insertErr.message, `insert for ${slug}`);
          } else {
            summary.inserted++;
            existingUrls.add(sourceUrl);
          }
        }
      }
    }

    // 1. Dedicated subreddits
    for (const [sub, defaultSlug] of Object.entries(DEDICATED_SUBS)) {
      if (requestCount > 0) await delay(DELAY_MS);
      const posts = await fetchRedditPosts(supabase, sub, null, afterEpoch);
      requestCount++;
      summary.fetched += posts.length;
      await processPosts(posts, defaultSlug);
    }

    // 2. General subreddits
    for (const sub of GENERAL_SUBS) {
      for (const term of GENERAL_SEARCH_TERMS) {
        if (requestCount > 0) await delay(DELAY_MS);
        const posts = await fetchRedditPosts(supabase, sub, term, afterEpoch);
        requestCount++;
        summary.fetched += posts.length;
        await processPosts(posts);
      }
    }

    await logToErrorLog(supabase, "scrape-reddit",
      `Completed: ${summary.inserted} inserted, ${summary.fetched} fetched, ${summary.filtered} filtered, ${summary.classified} classified, ${summary.errors.length} errors`,
      `requests=${requestCount}`
    );

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
