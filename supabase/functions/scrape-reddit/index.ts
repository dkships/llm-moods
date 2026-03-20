import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyPost } from "../_shared/classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Fallback defaults — overridden by scraper_config table at runtime
const DEFAULT_SUBREDDITS = ["ClaudeAI", "ChatGPT", "LocalLLaMA", "GoogleGemini", "singularity", "artificial", "deepseek", "MachineLearning", "ChatGPTCoding", "bing", "perplexity_ai", "Bard"];

const DEFAULT_DEDICATED_SLUGS: Record<string, string> = {
  ClaudeAI: "claude",
  ChatGPT: "chatgpt",
  GoogleGemini: "gemini",
  deepseek: "deepseek",
  ChatGPTCoding: "chatgpt",
  bing: "chatgpt",
  perplexity_ai: "perplexity",
  Bard: "gemini",
};

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "sonnet", "opus", "anthropic"],
  chatgpt: ["chatgpt", "gpt-5", "gpt-4", "gpt-4o", "gpt", "openai", "copilot"],
  gemini: ["gemini", "gemini pro", "google ai", "bard"],
  grok: ["grok", "grok 4", "xai"],
  deepseek: ["deepseek", "deepseek r1", "deepseek v3"],
  perplexity: ["perplexity", "perplexity ai", "pplx"],
};

async function loadConfig(supabase: any): Promise<{ subreddits: string[]; dedicatedSlugs: Record<string, string> }> {
  try {
    const { data, error } = await supabase
      .from("scraper_config")
      .select("key, value")
      .eq("scraper", "reddit");
    if (error || !data || data.length === 0) {
      return { subreddits: DEFAULT_SUBREDDITS, dedicatedSlugs: DEFAULT_DEDICATED_SLUGS };
    }
    const subreddits = data.filter((r: any) => r.key === "subreddit").map((r: any) => r.value);
    const dedicatedSlugs: Record<string, string> = {};
    for (const r of data.filter((r: any) => r.key === "dedicated_model")) {
      const [sub, slug] = r.value.split(":");
      if (sub && slug) dedicatedSlugs[sub] = slug;
    }
    return {
      subreddits: subreddits.length > 0 ? subreddits : DEFAULT_SUBREDDITS,
      dedicatedSlugs: Object.keys(dedicatedSlugs).length > 0 ? dedicatedSlugs : DEFAULT_DEDICATED_SLUGS,
    };
  } catch {
    return { subreddits: DEFAULT_SUBREDDITS, dedicatedSlugs: DEFAULT_DEDICATED_SLUGS };
  }
}

const USER_AGENT = "LLMVibes/1.0 (llmvibes.ai)";
const DELAY_MS = 2000;
const COMMENT_SCORE_THRESHOLD = 10;
const MAX_TOP_COMMENTS = 10;

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

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function logToErrorLog(supabase: any, fn: string, msg: string, ctx?: string) {
  try { await supabase.from("error_log").insert({ function_name: fn, error_message: msg, context: ctx || null }); } catch {}
}


async function fetchJson(url: string, retries = 3): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        // Exponential backoff on rate limit
        const backoff = DELAY_MS * Math.pow(2, attempt + 1);
        await delay(backoff);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      if (attempt === retries - 1) throw e;
      await delay(DELAY_MS * (attempt + 1));
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;

    await logToErrorLog(supabase, "scrape-reddit", "JSON API scraper started", "health-check");

    // Load config from database
    const { subreddits, dedicatedSlugs } = await loadConfig(supabase);

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "reddit").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const cutoff = Date.now() - 86400 * 1000;
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, comments_classified: 0, errors: [] as string[] };
    let reqIdx = 0;

    for (const sub of subreddits) {
      if (reqIdx > 0) await delay(DELAY_MS);
      reqIdx++;

      let listing: any;
      try {
        listing = await fetchJson(`https://www.reddit.com/r/${sub}/new.json?limit=50&raw_json=1`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logToErrorLog(supabase, "scrape-reddit", `Fetch failed r/${sub}: ${msg}`, "fetch-error");
        summary.errors.push(`r/${sub}: ${msg}`);
        continue;
      }

      const posts = listing?.data?.children || [];
      summary.fetched += posts.length;
      const defaultSlug = dedicatedSlugs[sub] || undefined;

      for (const child of posts) {
        const post = child.data;
        if (!post) continue;

        const createdMs = (post.created_utc || 0) * 1000;
        if (createdMs < cutoff) continue;

        const postUrl = `https://www.reddit.com${post.permalink}`;
        const title = (post.title || "").slice(0, 500);
        const selftext = (post.selftext || "").slice(0, 2000);
        const text = `${title} ${selftext}`;
        const upvotes = post.score || 0;
        const numComments = post.num_comments || 0;
        const postedAt = new Date(createdMs).toISOString();
        const contentType = selftext.trim() ? "title_and_body" : "title_only";

        let matchedSlugs = defaultSlug ? [defaultSlug] : matchModels(text);
        if (!defaultSlug && matchedSlugs.length === 0) continue;
        if (defaultSlug) {
          for (const s of matchModels(text)) {
            if (!matchedSlugs.includes(s)) matchedSlugs.push(s);
          }
        }
        summary.filtered++;

        if (existingUrls.has(postUrl)) continue;

        // Classify the post
        const classification = await classifyPost(text, lovableApiKey);
        summary.classified++;

        if (!classification.relevant) continue;

        for (const slug of matchedSlugs) {
          const modelId = modelMap[slug];
          if (!modelId) continue;

          const { error: insertErr } = await supabase.from("scraped_posts").upsert({
            model_id: modelId, source: "reddit", source_url: postUrl,
            title, content: selftext.slice(0, 2000),
            sentiment: classification.sentiment, complaint_category: classification.complaint_category,
            praise_category: classification.praise_category,
            confidence: classification.confidence, content_type: contentType,
            score: upvotes, posted_at: postedAt,
          }, { onConflict: "source_url,model_id", ignoreDuplicates: true });

          if (insertErr) {
            summary.errors.push(`Insert: ${insertErr.message}`);
          } else {
            summary.inserted++;
            existingUrls.add(postUrl);
          }
        }

        // Fetch and classify top comments for high-engagement posts
        if (numComments >= COMMENT_SCORE_THRESHOLD) {
          await delay(DELAY_MS);
          reqIdx++;
          try {
            const commentsJson = await fetchJson(
              `https://www.reddit.com/r/${sub}/comments/${post.id}.json?sort=top&limit=${MAX_TOP_COMMENTS}&raw_json=1`
            );
            const commentListing = commentsJson?.[1]?.data?.children || [];

            for (const cc of commentListing) {
              if (cc.kind !== "t1") continue;
              const comment = cc.data;
              if (!comment?.body || comment.body.length < 20) continue;

              const commentUrl = `https://www.reddit.com${comment.permalink}`;
              if (existingUrls.has(commentUrl)) continue;

              const commentText = comment.body.slice(0, 1500);
              const commentModels = defaultSlug ? [defaultSlug] : matchModels(commentText);
              if (commentModels.length === 0 && defaultSlug) commentModels.push(defaultSlug);
              if (commentModels.length === 0) continue;

              const cClass = await classifyPost(commentText, lovableApiKey);
              summary.comments_classified++;

              if (!cClass.relevant) continue;

              for (const slug of commentModels) {
                const modelId = modelMap[slug];
                if (!modelId) continue;

                const { error: cInsertErr } = await supabase.from("scraped_posts").upsert({
                  model_id: modelId, source: "reddit", source_url: commentUrl,
                  title: `Comment on: ${title}`.slice(0, 500),
                  content: commentText,
                  sentiment: cClass.sentiment, complaint_category: cClass.complaint_category,
                  praise_category: cClass.praise_category,
                  confidence: cClass.confidence, content_type: "full_content",
                  score: comment.score || 0, posted_at: new Date((comment.created_utc || 0) * 1000).toISOString(),
                }, { onConflict: "source_url,model_id", ignoreDuplicates: true });

                if (cInsertErr) {
                  summary.errors.push(`Comment insert: ${cInsertErr.message}`);
                } else {
                  summary.inserted++;
                  existingUrls.add(commentUrl);
                }
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            summary.errors.push(`Comments ${post.id}: ${msg}`);
          }
        }
      }
    }

    await logToErrorLog(supabase, "scrape-reddit",
      `Completed: ${summary.inserted} inserted, ${summary.fetched} fetched, ${summary.filtered} filtered, ${summary.classified} posts classified, ${summary.comments_classified} comments classified, ${summary.errors.length} errors`,
      `requests=${reqIdx}`
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
