import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyPost } from "../_shared/classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HN_KEYWORDS = ["ChatGPT", "Claude AI", "Gemini AI", "GPT-4", "GPT-5", "Grok", "DeepSeek", "LLM"];
const BLUESKY_KEYWORDS = ["ChatGPT", "Claude", "Gemini", "Grok", "DeepSeek", "Perplexity", "LLM", "OpenAI", "Anthropic"];

const REDDIT_KEYWORDS = ["ChatGPT", "Claude", "Gemini", "Grok", "DeepSeek"];
const REDDIT_SUBREDDITS = ["ClaudeAI", "ChatGPT", "LocalLLaMA", "GoogleGemini", "singularity", "artificial", "deepseek", "MachineLearning"];

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "sonnet", "opus", "anthropic"],
  chatgpt: ["chatgpt", "gpt-5", "gpt-4", "gpt-4o", "gpt", "openai", "copilot"],
  gemini: ["gemini", "gemini pro", "google ai", "bard"],
  grok: ["grok", "grok 4", "xai"],
  deepseek: ["deepseek", "deepseek r1", "deepseek v3"],
  perplexity: ["perplexity", "perplexity ai", "pplx"],
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

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function log(supabase: any, msg: string, ctx?: string) {
  try { await supabase.from("error_log").insert({ function_name: "backfill-historical", error_message: msg, context: ctx || null }); } catch {}
}


function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "LLMVibes/1.0 (llmvibes.ai)", Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    await log(supabase, "Backfill started", "health-check");

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    // Load existing URLs for dedup
    const { data: existingData } = await supabase.from("scraped_posts").select("source_url").not("source_url", "is", null).limit(10000);
    const existingUrls = new Set((existingData || []).map((e: any) => e.source_url));

    const ninetyDaysAgo = Math.floor((Date.now() - 90 * 86400000) / 1000);
    const totals: Record<string, Record<string, number>> = {};
    const addTotal = (source: string, model: string) => {
      if (!totals[source]) totals[source] = {};
      totals[source][model] = (totals[source][model] || 0) + 1;
    };

    // ====== SOURCE 1: Hacker News via Algolia ======
    await log(supabase, "Starting HN Algolia backfill", "phase");
    for (const keyword of HN_KEYWORDS) {
      for (let page = 0; page < 20; page++) {
        await delay(1000);
        try {
          const url = `http://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(keyword)}&tags=story&numericFilters=created_at_i>${ninetyDaysAgo}&hitsPerPage=50&page=${page}`;
          const data = await fetchJson(url);
          const hits = data.hits || [];
          if (hits.length === 0) break;

          for (const hit of hits) {
            const sourceUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
            if (existingUrls.has(sourceUrl)) continue;

            const title = hit.title || "";
            const text = title;
            const matchedSlugs = matchModels(text);
            if (matchedSlugs.length === 0) continue;

            const classification = await classifyPost(text, apiKey);
            if (!classification.relevant) continue;

            for (const slug of matchedSlugs) {
              const modelId = modelMap[slug];
              if (!modelId) continue;
              const { error } = await supabase.from("scraped_posts").upsert({
                model_id: modelId, source: "hackernews", source_url: sourceUrl,
                title: title.slice(0, 500), content: null,
                sentiment: classification.sentiment, complaint_category: classification.complaint_category,
                praise_category: classification.praise_category,
                confidence: classification.confidence, content_type: "title_only",
                score: hit.points || 0, posted_at: hit.created_at || new Date().toISOString(),
                is_backfill: true,
              }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
              if (!error) {
                existingUrls.add(sourceUrl);
                addTotal("hackernews", slug);
              }
            }
          }

          if (hits.length < 50) break;
        } catch (e) {
          await log(supabase, `HN "${keyword}" page ${page}: ${e instanceof Error ? e.message : String(e)}`, "error");
          break;
        }
      }
      await log(supabase, `Backfill progress: hackernews - "${keyword}" complete - ${JSON.stringify(totals.hackernews || {})}`, "progress");
    }

    // ====== SOURCE 2: Bluesky ======
    await log(supabase, "Starting Bluesky backfill", "phase");
    for (const keyword of BLUESKY_KEYWORDS) {
      let cursor: string | undefined = undefined;
      for (let page = 0; page < 10; page++) {
        await delay(1000);
        try {
          let url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(keyword)}&limit=50`;
          if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
          const data = await fetchJson(url);
          const posts = data.posts || [];
          cursor = data.cursor;

          if (posts.length === 0) break;

          for (const post of posts) {
            const text = post.record?.text || "";
            const sourceUrl = `https://bsky.app/profile/${post.author?.handle || "unknown"}/post/${post.uri?.split("/").pop() || ""}`;
            if (existingUrls.has(sourceUrl)) continue;

            // Check if within 90 days
            const createdAt = post.record?.createdAt || post.indexedAt;
            if (createdAt && new Date(createdAt).getTime() < ninetyDaysAgo * 1000) continue;

            const matchedSlugs = matchModels(text);
            if (matchedSlugs.length === 0) continue;

            const classification = await classifyPost(text, apiKey);
            if (!classification.relevant) continue;

            const score = (post.likeCount || 0) + (post.repostCount || 0);

            for (const slug of matchedSlugs) {
              const modelId = modelMap[slug];
              if (!modelId) continue;
              const { error } = await supabase.from("scraped_posts").upsert({
                model_id: modelId, source: "bluesky", source_url: sourceUrl,
                title: text.slice(0, 120), content: text.slice(0, 2000),
                sentiment: classification.sentiment, complaint_category: classification.complaint_category,
                praise_category: classification.praise_category,
                confidence: classification.confidence, content_type: "full_content",
                score, posted_at: createdAt || new Date().toISOString(),
                is_backfill: true,
              }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
              if (!error) {
                existingUrls.add(sourceUrl);
                addTotal("bluesky", slug);
              }
            }
          }

          if (!cursor || posts.length < 50) break;
        } catch (e) {
          await log(supabase, `Bluesky "${keyword}" page ${page}: ${e instanceof Error ? e.message : String(e)}`, "error");
          break;
        }
      }
      await log(supabase, `Backfill progress: bluesky - "${keyword}" complete - ${JSON.stringify(totals.bluesky || {})}`, "progress");
    }

    // ====== SOURCE 3: Reddit via PullPush ======
    await log(supabase, "Starting PullPush Reddit backfill", "phase");
    for (const sub of REDDIT_SUBREDDITS) {
      for (const keyword of REDDIT_KEYWORDS) {
        await delay(1000);
        try {
          const url = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(keyword)}&subreddit=${sub}&sort=desc&size=100&after=${ninetyDaysAgo}`;
          const data = await fetchJson(url);
          const submissions = data.data || [];

          if (submissions.length === 0) continue;

          for (const post of submissions) {
            const postUrl = `https://www.reddit.com${post.permalink || `/r/${sub}/comments/${post.id}`}`;
            if (existingUrls.has(postUrl)) continue;

            const title = (post.title || "").slice(0, 500);
            const selftext = (post.selftext || "").slice(0, 500);
            const text = `${title} ${selftext}`;
            const matchedSlugs = matchModels(text);
            if (matchedSlugs.length === 0) continue;

            const classification = await classifyPost(text, apiKey);
            if (!classification.relevant) continue;

            const contentType = selftext.trim() ? "title_and_body" : "title_only";
            const postedAt = post.created_utc ? new Date(post.created_utc * 1000).toISOString() : new Date().toISOString();

            for (const slug of matchedSlugs) {
              const modelId = modelMap[slug];
              if (!modelId) continue;
              const { error } = await supabase.from("scraped_posts").upsert({
                model_id: modelId, source: "reddit", source_url: postUrl,
                title, content: selftext.slice(0, 2000),
                sentiment: classification.sentiment, complaint_category: classification.complaint_category,
                praise_category: classification.praise_category,
                confidence: classification.confidence, content_type: contentType,
                score: post.score || 0, posted_at: postedAt,
                is_backfill: true,
              }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
              if (!error) {
                existingUrls.add(postUrl);
                addTotal("reddit", slug);
              }
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await log(supabase, `PullPush r/${sub} "${keyword}": ${msg}`, "pullpush-error");
          // Don't break — PullPush can be flaky, skip and continue
        }
      }
      await log(supabase, `Backfill progress: reddit - r/${sub} complete - ${JSON.stringify(totals.reddit || {})}`, "progress");
    }

    await log(supabase, `Backfill complete: ${JSON.stringify(totals)}`, "complete");

    return new Response(JSON.stringify({ status: "complete", totals }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await log(supabase, msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
