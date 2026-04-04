import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch } from "../_shared/classifier.ts";
import { loadKeywords, matchModels } from "../_shared/utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HN_KEYWORDS = ["ChatGPT", "Claude AI", "Gemini AI", "GPT-4", "GPT-5", "Grok", "LLM"];
const BLUESKY_KEYWORDS = ["ChatGPT", "Claude", "Gemini", "Grok", "LLM", "OpenAI", "Anthropic"];

const REDDIT_KEYWORDS = ["ChatGPT", "Claude", "Gemini", "Grok"];
const REDDIT_SUBREDDITS = ["ClaudeAI", "ChatGPT", "LocalLLaMA", "GoogleGemini", "singularity", "artificial", "MachineLearning"];

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

// ====== SOURCE 4: Twitter/X via Apify ======
const TWITTER_SEARCH_TERMS = ["Claude AI", "ChatGPT", "Gemini AI", "Grok AI"];

// ====== SOURCE 5: Stack Overflow ======
const SO_SEARCH_TERMS = ["ChatGPT", "Claude AI", "Gemini AI", "GPT-5"];

// ====== SOURCE 6: GitHub Issues ======
const GH_REPOS: { owner: string; repo: string; defaultSlug: string | null }[] = [
  { owner: "anthropics", repo: "anthropic-sdk-python", defaultSlug: "claude" },
  { owner: "anthropics", repo: "courses", defaultSlug: "claude" },
  { owner: "openai", repo: "openai-python", defaultSlug: "chatgpt" },
  { owner: "google-gemini", repo: "generative-ai-python", defaultSlug: "gemini" },
  { owner: "ollama", repo: "ollama", defaultSlug: null },
  { owner: "ggerganov", repo: "llama.cpp", defaultSlug: null },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    let body: any = {};
    try { body = await req.json(); } catch {}

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;

    // Optional date range targeting (defaults to 90-day window)
    const defaultStart = Math.floor((Date.now() - 90 * 86400000) / 1000);
    const defaultEnd = Math.floor(Date.now() / 1000);
    const startEpoch = body.start_date
      ? Math.floor(new Date(body.start_date + "T00:00:00Z").getTime() / 1000)
      : defaultStart;
    const endEpoch = body.end_date
      ? Math.floor(new Date(body.end_date + "T23:59:59Z").getTime() / 1000)
      : defaultEnd;
    const isTargeted = !!(body.start_date || body.end_date);

    // Reduce page limits when date-targeted to stay within edge function timeout
    const hnMaxPages = isTargeted ? 5 : 20;
    const bskyMaxPages = isTargeted ? 5 : 10;

    await log(supabase, `Backfill started: start=${new Date(startEpoch * 1000).toISOString().split("T")[0]}, end=${new Date(endEpoch * 1000).toISOString().split("T")[0]}, targeted=${isTargeted}`, "health-check");

    // Load model map and keywords from DB (same as active scrapers)
    const { modelMap, keywords } = await loadKeywords(supabase);

    // Load existing URLs for dedup
    const { data: existingData } = await supabase.from("scraped_posts").select("source_url").not("source_url", "is", null).limit(10000);
    const existingUrls = new Set((existingData || []).map((e: any) => e.source_url));

    const totals: Record<string, Record<string, number>> = {};
    const addTotal = (source: string, model: string) => {
      if (!totals[source]) totals[source] = {};
      totals[source][model] = (totals[source][model] || 0) + 1;
    };

    // ====== SOURCE 1: Hacker News via Algolia ======
    await log(supabase, "Starting HN Algolia backfill", "phase");
    for (const keyword of HN_KEYWORDS) {
      for (let page = 0; page < hnMaxPages; page++) {
        await delay(1000);
        try {
          const url = `http://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(keyword)}&tags=story&numericFilters=created_at_i>${startEpoch},created_at_i<${endEpoch}&hitsPerPage=50&page=${page}`;
          const data = await fetchJson(url);
          const hits = data.hits || [];
          if (hits.length === 0) break;

          // Pass 1: collect candidates
          const hnCandidates: { text: string; matchedSlugs: string[]; sourceUrl: string; title: string; score: number; postedAt: string }[] = [];
          for (const hit of hits) {
            const sourceUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
            if (existingUrls.has(sourceUrl)) continue;

            const title = hit.title || "";
            const text = title;
            const matchedSlugs = matchModels(text, keywords);
            if (matchedSlugs.length === 0) continue;

            hnCandidates.push({ text, matchedSlugs, sourceUrl, title, score: hit.points || 0, postedAt: hit.created_at || new Date().toISOString() });
          }

          // Pass 2: batch classify
          const hnClassifications = await classifyBatch(hnCandidates.map(c => c.text), apiKey);

          // Pass 3: insert
          for (let j = 0; j < hnCandidates.length; j++) {
            const classification = hnClassifications[j];
            if (!classification.relevant) continue;
            const c = hnCandidates[j];

            for (const slug of c.matchedSlugs) {
              const modelId = modelMap[slug];
              if (!modelId) continue;
              const { error } = await supabase.from("scraped_posts").upsert({
                model_id: modelId, source: "hackernews", source_url: c.sourceUrl,
                title: c.title.slice(0, 500), content: null,
                sentiment: classification.sentiment, complaint_category: classification.complaint_category,
                praise_category: classification.praise_category,
                confidence: classification.confidence, content_type: "title_only",
                score: c.score, posted_at: c.postedAt,
                is_backfill: true,
              }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
              if (!error) {
                existingUrls.add(c.sourceUrl);
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
      for (let page = 0; page < bskyMaxPages; page++) {
        await delay(1000);
        try {
          let url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(keyword)}&limit=50`;
          if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
          const data = await fetchJson(url);
          const posts = data.posts || [];
          cursor = data.cursor;

          if (posts.length === 0) break;

          // Pass 1: collect candidates
          const bskyCandidates: { text: string; matchedSlugs: string[]; sourceUrl: string; score: number; createdAt: string }[] = [];
          for (const post of posts) {
            const text = post.record?.text || "";
            const sourceUrl = `https://bsky.app/profile/${post.author?.handle || "unknown"}/post/${post.uri?.split("/").pop() || ""}`;
            if (existingUrls.has(sourceUrl)) continue;

            // Check if within date range
            const createdAt = post.record?.createdAt || post.indexedAt;
            const postTime = createdAt ? new Date(createdAt).getTime() : 0;
            if (postTime < startEpoch * 1000) continue;
            if (postTime > endEpoch * 1000) continue;

            const matchedSlugs = matchModels(text, keywords);
            if (matchedSlugs.length === 0) continue;

            const score = (post.likeCount || 0) + (post.repostCount || 0);
            bskyCandidates.push({ text, matchedSlugs, sourceUrl, score, createdAt: createdAt || new Date().toISOString() });
          }

          // Pass 2: batch classify
          const bskyClassifications = await classifyBatch(bskyCandidates.map(c => c.text), apiKey);

          // Pass 3: insert
          for (let j = 0; j < bskyCandidates.length; j++) {
            const classification = bskyClassifications[j];
            if (!classification.relevant) continue;
            const c = bskyCandidates[j];

            for (const slug of c.matchedSlugs) {
              const modelId = modelMap[slug];
              if (!modelId) continue;
              const { error } = await supabase.from("scraped_posts").upsert({
                model_id: modelId, source: "bluesky", source_url: c.sourceUrl,
                title: c.text.slice(0, 120), content: c.text.slice(0, 2000),
                sentiment: classification.sentiment, complaint_category: classification.complaint_category,
                praise_category: classification.praise_category,
                confidence: classification.confidence, content_type: "full_content",
                score: c.score, posted_at: c.createdAt,
                is_backfill: true,
              }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
              if (!error) {
                existingUrls.add(c.sourceUrl);
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
          const url = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(keyword)}&subreddit=${sub}&sort=desc&size=100&after=${startEpoch}&before=${endEpoch}`;
          const data = await fetchJson(url);
          const submissions = data.data || [];

          if (submissions.length === 0) continue;

          // Pass 1: collect candidates
          const redditCandidates: { text: string; matchedSlugs: string[]; postUrl: string; title: string; selftext: string; score: number; postedAt: string; contentType: string }[] = [];
          for (const post of submissions) {
            const postUrl = `https://www.reddit.com${post.permalink || `/r/${sub}/comments/${post.id}`}`;
            if (existingUrls.has(postUrl)) continue;

            const title = (post.title || "").slice(0, 500);
            const selftext = (post.selftext || "").slice(0, 500);
            const text = `${title} ${selftext}`;
            const matchedSlugs = matchModels(text, keywords);
            if (matchedSlugs.length === 0) continue;

            const contentType = selftext.trim() ? "title_and_body" : "title_only";
            const postedAt = post.created_utc ? new Date(post.created_utc * 1000).toISOString() : new Date().toISOString();
            redditCandidates.push({ text, matchedSlugs, postUrl, title, selftext, score: post.score || 0, postedAt, contentType });
          }

          // Pass 2: batch classify
          const redditClassifications = await classifyBatch(redditCandidates.map(c => c.text), apiKey);

          // Pass 3: insert
          for (let j = 0; j < redditCandidates.length; j++) {
            const classification = redditClassifications[j];
            if (!classification.relevant) continue;
            const c = redditCandidates[j];

            for (const slug of c.matchedSlugs) {
              const modelId = modelMap[slug];
              if (!modelId) continue;
              const { error } = await supabase.from("scraped_posts").upsert({
                model_id: modelId, source: "reddit", source_url: c.postUrl,
                title: c.title, content: c.selftext.slice(0, 2000),
                sentiment: classification.sentiment, complaint_category: classification.complaint_category,
                praise_category: classification.praise_category,
                confidence: classification.confidence, content_type: c.contentType,
                score: c.score, posted_at: c.postedAt,
                is_backfill: true,
              }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
              if (!error) {
                existingUrls.add(c.postUrl);
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

    // ====== SOURCE 4: Twitter/X via Apify ======
    const apifyToken = Deno.env.get("APIFY_API_TOKEN");
    if (apifyToken) {
      await log(supabase, "Starting Twitter/X Apify backfill", "phase");
      try {
        const startDate = new Date(startEpoch * 1000).toISOString().split("T")[0];
        const endDate = new Date(endEpoch * 1000).toISOString().split("T")[0];

        const startRes = await fetch(`https://api.apify.com/v2/acts/apidojo~tweet-scraper/runs?token=${apifyToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            searchTerms: TWITTER_SEARCH_TERMS,
            maxItems: isTargeted ? 100 : 50,
            sort: "Latest",
            tweetLanguage: "en",
            includeSearchTerms: true,
            start: startDate,
            end: endDate,
          }),
        });

        if (!startRes.ok) {
          await log(supabase, `Apify start failed HTTP ${startRes.status}`, "twitter-error");
        } else {
          const runData = await startRes.json();
          const runId = runData.data?.id;
          const datasetId = runData.data?.defaultDatasetId;

          if (runId && datasetId) {
            // Poll status (10s intervals, max 12 polls = 2 min)
            let runStatus = "";
            for (let i = 0; i < 12; i++) {
              await delay(10000);
              try {
                const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`);
                if (statusRes.ok) {
                  const statusData = await statusRes.json();
                  runStatus = statusData.data?.status || "";
                  if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(runStatus)) break;
                }
              } catch {}
            }

            if (runStatus === "SUCCEEDED" || runStatus === "ABORTED") {
              const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`);
              if (datasetRes.ok) {
                const rawItems = await datasetRes.json();
                const items = Array.isArray(rawItems) ? rawItems.filter((t: any) => t.text || t.full_text) : [];

                const twitterCandidates: { text: string; matchedSlugs: string[]; sourceUrl: string; score: number; postedAt: string }[] = [];
                for (const tweet of items) {
                  if (tweet.isRetweet || tweet.is_retweet) continue;
                  const text = (tweet.text || tweet.full_text || "").slice(0, 2000);
                  if (!text) continue;

                  const screenName = tweet.username || tweet.user?.screen_name || tweet.screen_name || "";
                  const sourceUrl = tweet.url || (screenName && tweet.id ? `https://x.com/${screenName}/status/${tweet.id}` : "");
                  if (!sourceUrl || existingUrls.has(sourceUrl)) continue;

                  const matchedSlugs = matchModels(text, keywords);
                  if (matchedSlugs.length === 0) continue;

                  const createdAt = new Date(tweet.created_at || tweet.createdAt);
                  const score = (tweet.favorite_count || tweet.likeCount || 0) + (tweet.retweet_count || tweet.retweetCount || 0);
                  twitterCandidates.push({ text, matchedSlugs, sourceUrl, score, postedAt: isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString() });
                }

                const twitterClassifications = await classifyBatch(twitterCandidates.map(c => c.text), apiKey);
                for (let j = 0; j < twitterCandidates.length; j++) {
                  const classification = twitterClassifications[j];
                  if (!classification.relevant) continue;
                  const c = twitterCandidates[j];
                  for (const slug of c.matchedSlugs) {
                    const modelId = modelMap[slug];
                    if (!modelId) continue;
                    const { error } = await supabase.from("scraped_posts").upsert({
                      model_id: modelId, source: "twitter", source_url: c.sourceUrl,
                      title: c.text.slice(0, 120), content: c.text.slice(0, 2000),
                      sentiment: classification.sentiment, complaint_category: classification.complaint_category,
                      praise_category: classification.praise_category,
                      confidence: classification.confidence, content_type: "title_only",
                      score: c.score, posted_at: c.postedAt, is_backfill: true,
                    }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
                    if (!error) { existingUrls.add(c.sourceUrl); addTotal("twitter", slug); }
                  }
                }
                await log(supabase, `Twitter backfill: ${items.length} tweets fetched, ${JSON.stringify(totals.twitter || {})}`, "progress");
              }
            } else {
              await log(supabase, `Twitter Apify run status: ${runStatus || "TIMEOUT"} — skipping`, "twitter-warn");
            }
          }
        }
      } catch (e) {
        await log(supabase, `Twitter backfill error: ${e instanceof Error ? e.message : String(e)}`, "twitter-error");
      }
    } else {
      await log(supabase, "APIFY_API_TOKEN not set — skipping Twitter backfill", "config");
    }

    // ====== SOURCE 5: Stack Overflow ======
    await log(supabase, "Starting Stack Overflow backfill", "phase");
    for (const term of SO_SEARCH_TERMS) {
      await delay(2000);
      try {
        const url = `https://api.stackexchange.com/2.3/search?order=desc&sort=creation&intitle=${encodeURIComponent(term)}&site=stackoverflow&pagesize=50&filter=withbody&fromdate=${startEpoch}&todate=${endEpoch}`;
        const res = await fetch(url);
        if (!res.ok) { await log(supabase, `SO "${term}": HTTP ${res.status}`, "so-error"); continue; }

        const data = await res.json();
        const items = data.items || [];

        const soCandidates: { text: string; matchedSlugs: string[]; sourceUrl: string; title: string; body: string; score: number; postedAt: string }[] = [];
        for (const item of items) {
          const title = item.title || "";
          const body = (item.body || "").replace(/<[^>]*>/g, "").slice(0, 2000);
          const sourceUrl = item.link;
          if (!sourceUrl || existingUrls.has(sourceUrl)) continue;

          const matchedSlugs = matchModels(title + " " + body, keywords);
          if (matchedSlugs.length === 0) continue;

          soCandidates.push({
            text: `${title} ${body}`, matchedSlugs, sourceUrl, title, body,
            score: item.score || 0,
            postedAt: new Date(item.creation_date * 1000).toISOString(),
          });
        }

        const soClassifications = await classifyBatch(soCandidates.map(c => c.text), apiKey);
        for (let j = 0; j < soCandidates.length; j++) {
          const classification = soClassifications[j];
          if (!classification.relevant) continue;
          const c = soCandidates[j];
          for (const slug of c.matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "stackoverflow", source_url: c.sourceUrl,
              title: c.title.slice(0, 500), content: c.body.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              praise_category: classification.praise_category,
              confidence: classification.confidence, content_type: "title_and_body",
              score: c.score, posted_at: c.postedAt, is_backfill: true,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (!error) { existingUrls.add(c.sourceUrl); addTotal("stackoverflow", slug); }
          }
        }
      } catch (e) {
        await log(supabase, `SO "${term}": ${e instanceof Error ? e.message : String(e)}`, "so-error");
      }
    }
    await log(supabase, `SO backfill complete: ${JSON.stringify(totals.stackoverflow || {})}`, "progress");

    // ====== SOURCE 6: GitHub Issues ======
    const githubToken = Deno.env.get("GITHUB_TOKEN");
    await log(supabase, "Starting GitHub Issues backfill", "phase");
    const ghSince = new Date(startEpoch * 1000).toISOString();
    for (const { owner, repo, defaultSlug } of GH_REPOS) {
      await delay(2000);
      try {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&sort=created&direction=desc&per_page=30&since=${ghSince}`;
        const headers: Record<string, string> = { "User-Agent": "LLMVibes/1.0", Accept: "application/vnd.github.v3+json" };
        if (githubToken) headers.Authorization = `token ${githubToken}`;

        const res = await fetch(url, { headers });
        if (!res.ok) { await log(supabase, `GH ${owner}/${repo}: HTTP ${res.status}`, "gh-error"); continue; }

        const issues: any[] = await res.json();
        if (!Array.isArray(issues)) continue;

        const ghCandidates: { text: string; matchedSlugs: string[]; htmlUrl: string; title: string; body: string; score: number; createdAt: string; contentType: string }[] = [];
        for (const issue of issues) {
          if (issue.pull_request) continue;

          // Filter by end date
          const createdAt = issue.created_at || "";
          if (createdAt && new Date(createdAt).getTime() > endEpoch * 1000) continue;

          const title = (issue.title || "").slice(0, 500);
          const body = (issue.body || "").slice(0, 500);
          const text = `${title} ${body}`;
          const htmlUrl = issue.html_url || "";
          if (!htmlUrl || existingUrls.has(htmlUrl)) continue;

          let matchedSlugs: string[];
          if (defaultSlug) {
            matchedSlugs = [defaultSlug];
            for (const s of matchModels(text, keywords)) {
              if (!matchedSlugs.includes(s)) matchedSlugs.push(s);
            }
          } else {
            matchedSlugs = matchModels(text, keywords);
            if (matchedSlugs.length === 0) continue;
          }

          const reactions = issue.reactions?.total_count || 0;
          const comments = issue.comments || 0;
          const contentType = body.trim() ? "title_and_body" : "title_only";
          ghCandidates.push({ text, matchedSlugs, htmlUrl, title, body, score: reactions + comments, createdAt, contentType });
        }

        const ghClassifications = await classifyBatch(ghCandidates.map(c => c.text), apiKey);
        for (let j = 0; j < ghCandidates.length; j++) {
          const classification = ghClassifications[j];
          if (!classification.relevant) continue;
          const c = ghCandidates[j];
          for (const slug of c.matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "github", source_url: c.htmlUrl,
              title: c.title.slice(0, 500), content: c.body.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              praise_category: classification.praise_category,
              confidence: classification.confidence, content_type: c.contentType,
              score: c.score, posted_at: c.createdAt, is_backfill: true,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (!error) { existingUrls.add(c.htmlUrl); addTotal("github", slug); }
          }
        }
      } catch (e) {
        await log(supabase, `GH ${owner}/${repo}: ${e instanceof Error ? e.message : String(e)}`, "gh-error");
      }
    }
    await log(supabase, `GitHub backfill complete: ${JSON.stringify(totals.github || {})}`, "progress");

    await log(supabase, `Backfill complete: ${JSON.stringify(totals)}`, "complete");

    return new Response(JSON.stringify({ status: "complete", targeted: isTargeted, totals }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await log(supabase, msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
