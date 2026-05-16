/**
 * audit-may16 — temporary helper for the 2026-05-16 scoring/methodology audit.
 *
 * Modes (via JSON body `mode`):
 *   - "backfill-may7"      → HN Algolia (free) + Apify Twitter for 2026-05-07 UTC
 *   - "reaggregate-dry"    → POST reaggregate-vibes with dry_run=true, diff_report=true, days_back=30
 *   - "reaggregate-apply"  → POST reaggregate-vibes with dry_run=false, days_back=30
 *
 * Auth: shared-secret header X-Audit-Secret matching a hardcoded per-session
 * token. The token rotates each audit; this file is deleted from main after
 * the run completes. Repo is public, so the per-session window is the entire
 * security boundary — keep it short.
 *
 * DELETE this directory after the audit and commit again.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  corsHeaders,
  loadKeywords,
  matchModels,
  meetsMinLength,
  isLikelyNonExperienceShare,
  loadRecentTitleKeys,
  isDuplicate,
  upsertPendingScrapedPost,
} from "../_shared/utils.ts";

const AUDIT_SECRET = "cuoVcbUo0mfVaD07iTW4sD7HNUjiS7Fo";

// 2026-05-07 UTC start/end as Unix epochs
const MAY7_START_EPOCH = 1778112000;
const MAY7_END_EPOCH = 1778198400;
const MAY7_START_ISO = "2026-05-07T00:00:00Z";
const MAY7_END_ISO = "2026-05-08T00:00:00Z";

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1/search_by_date";
const HN_TERMS = [
  "Claude",
  "ChatGPT",
  "Gemini",
  "Grok",
  "OpenAI",
  "Claude hallucinates",
  "ChatGPT dumber",
  "Gemini fails",
];

const TWITTER_SEARCH_TERMS = [
  `("claude" OR "claude ai" OR "claude code" OR anthropic OR "chatgpt" OR "chat gpt" OR "openai gpt" OR openai OR "gemini" OR "google gemini" OR "gemini ai" OR "grok" OR "grok ai" OR "xai grok") lang:en -filter:retweets`,
];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backfillHN(supabase: any) {
  const { modelMap, keywords } = await loadKeywords(supabase);
  const { data: existing } = await supabase
    .from("scraped_posts")
    .select("source_url")
    .eq("source", "hackernews")
    .limit(20000);
  const existingUrls = new Set((existing || []).map((r: any) => r.source_url).filter(Boolean));
  const titleKeys = await loadRecentTitleKeys(supabase);

  let fetched = 0, candidates = 0, inserted = 0, dedupSkipped = 0, contentSkipped = 0;
  const errors: string[] = [];

  for (const term of HN_TERMS) {
    try {
      const url = `${ALGOLIA_BASE}?query=${encodeURIComponent(term)}&tags=story&numericFilters=created_at_i>${MAY7_START_EPOCH},created_at_i<${MAY7_END_EPOCH}&hitsPerPage=100`;
      const res = await fetch(url);
      if (!res.ok) { errors.push(`${term}: ${res.status}`); await delay(500); continue; }
      const data = await res.json();
      const hits = data.hits || [];
      fetched += hits.length;

      for (const hit of hits) {
        if (!hit.title || !hit.created_at) { contentSkipped++; continue; }
        if (!meetsMinLength(hit.title, "")) { contentSkipped++; continue; }
        if (isLikelyNonExperienceShare(hit.title, hit.url || "")) { contentSkipped++; continue; }

        const sourceUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
        if (existingUrls.has(sourceUrl)) { dedupSkipped++; continue; }

        const matchedSlugs = matchModels(`${hit.title} ${hit.url || ""}`, keywords);
        if (matchedSlugs.length === 0) continue;
        candidates++;

        let allDuped = true;
        for (const slug of matchedSlugs) {
          const modelId = modelMap[slug];
          if (modelId && !isDuplicate(titleKeys, hit.title, modelId)) { allDuped = false; break; }
        }
        if (allDuped) { dedupSkipped++; continue; }

        for (const slug of matchedSlugs) {
          const modelId = modelMap[slug];
          if (!modelId || isDuplicate(titleKeys, hit.title, modelId)) continue;
          const upsertResult = await upsertPendingScrapedPost(supabase, {
            model_id: modelId,
            source: "hackernews",
            source_url: sourceUrl,
            title: hit.title.slice(0, 500),
            content: hit.title.slice(0, 2000),
            content_type: "title_only",
            score: hit.points || 0,
            posted_at: hit.created_at,
          });
          if (upsertResult.error) { errors.push(`insert: ${upsertResult.error}`); continue; }
          if (upsertResult.inserted) {
            inserted++;
            existingUrls.add(sourceUrl);
            titleKeys.add(`${modelId}:${hit.title.slice(0, 80).toLowerCase()}`);
          }
        }
      }
    } catch (e) {
      errors.push(`${term}: ${e instanceof Error ? e.message : "unknown"}`);
    }
    await delay(400);
  }

  return { source: "hackernews", window: { from: MAY7_START_ISO, to: MAY7_END_ISO }, fetched, candidates, inserted, dedupSkipped, contentSkipped, errors };
}

async function backfillTwitter(supabase: any) {
  const apifyToken = Deno.env.get("APIFY_API_TOKEN");
  if (!apifyToken) return { source: "twitter", error: "APIFY_API_TOKEN not set" };

  const { modelMap, keywords } = await loadKeywords(supabase);
  const { data: existing } = await supabase
    .from("scraped_posts")
    .select("source_url")
    .eq("source", "twitter")
    .limit(20000);
  const existingUrls = new Set((existing || []).map((r: any) => r.source_url).filter(Boolean));
  const titleKeys = await loadRecentTitleKeys(supabase);

  const apifyInput = {
    searchTerms: TWITTER_SEARCH_TERMS,
    sort: "Latest",
    maxItems: 100,
    start: MAY7_START_ISO,
    end: MAY7_END_ISO,
  };

  const startUrl = `https://api.apify.com/v2/acts/apidojo~tweet-scraper/runs?token=${apifyToken}&timeoutSecs=180&maxTotalChargeUsd=0.30`;
  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apifyInput),
  });
  if (!startRes.ok) {
    return { source: "twitter", error: `Apify start HTTP ${startRes.status}: ${(await startRes.text()).slice(0, 300)}` };
  }
  const runData = await startRes.json();
  const apifyRunId = runData.data?.id;
  const datasetId = runData.data?.defaultDatasetId;
  if (!apifyRunId || !datasetId) return { source: "twitter", error: "missing apify runId/datasetId" };

  let status = "";
  for (let i = 0; i < 18; i++) {
    await delay(10000);
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}?token=${apifyToken}`);
    if (!r.ok) continue;
    const d = await r.json();
    status = d.data?.status || "";
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) break;
  }
  if (status !== "SUCCEEDED") {
    return { source: "twitter", error: `Apify status ${status || "TIMEOUT"}` };
  }

  const dsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`);
  if (!dsRes.ok) return { source: "twitter", error: "dataset fetch failed" };
  const items: any[] = (await dsRes.json()).filter((it: any) => it.text || it.full_text);

  const may7Start = new Date(MAY7_START_ISO);
  const may7End = new Date(MAY7_END_ISO);
  let fetched = items.length, candidates = 0, inserted = 0, dedupSkipped = 0, contentSkipped = 0;
  const errors: string[] = [];

  for (const tweet of items) {
    if (tweet.isRetweet || tweet.is_retweet) continue;
    const createdAt = new Date(tweet.created_at || tweet.createdAt);
    if (Number.isNaN(createdAt.getTime())) continue;
    if (createdAt < may7Start || createdAt >= may7End) continue;
    const text = (tweet.text || tweet.full_text || "").slice(0, 2000);
    if (!text || !meetsMinLength(text, "")) { contentSkipped++; continue; }
    if (isLikelyNonExperienceShare(text, "")) { contentSkipped++; continue; }
    const matchedSlugs = matchModels(text, keywords);
    if (matchedSlugs.length === 0) continue;
    candidates++;
    const screenName = tweet.username || tweet.user?.screen_name || tweet.screen_name || tweet.author?.userName || "";
    const sourceUrl = tweet.url || (screenName && tweet.id ? `https://x.com/${screenName}/status/${tweet.id}` : "");
    if (!sourceUrl || existingUrls.has(sourceUrl)) { dedupSkipped++; continue; }
    const title = text.slice(0, 500);
    let allDuped = true;
    for (const slug of matchedSlugs) {
      const modelId = modelMap[slug];
      if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
    }
    if (allDuped) { dedupSkipped++; continue; }
    for (const slug of matchedSlugs) {
      const modelId = modelMap[slug];
      if (!modelId || isDuplicate(titleKeys, title, modelId)) continue;
      const upsertResult = await upsertPendingScrapedPost(supabase, {
        model_id: modelId,
        source: "twitter",
        source_url: sourceUrl,
        title: title.slice(0, 120),
        content: text.slice(0, 2000),
        content_type: "title_only",
        score: (tweet.favorite_count || tweet.likeCount || 0) + (tweet.retweet_count || tweet.retweetCount || 0),
        posted_at: createdAt.toISOString(),
      });
      if (upsertResult.error) { errors.push(`insert: ${upsertResult.error}`); continue; }
      if (upsertResult.inserted) {
        inserted++;
        existingUrls.add(sourceUrl);
        titleKeys.add(`${modelId}:${title.slice(0, 80).toLowerCase()}`);
      }
    }
  }

  return { source: "twitter", window: { from: MAY7_START_ISO, to: MAY7_END_ISO }, fetched, candidates, inserted, dedupSkipped, contentSkipped, errors };
}

async function callReaggregate(dryRun: boolean) {
  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${supaUrl}/functions/v1/reaggregate-vibes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      days_back: 30,
      dry_run: dryRun,
      diff_report: true,
    }),
  });
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 2000) }; }
  return { status: res.status, ...parsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.headers.get("x-audit-secret") !== AUDIT_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch {}
  const mode = body.mode;

  try {
    if (mode === "backfill-may7") {
      const hn = await backfillHN(supabase);
      const tw = await backfillTwitter(supabase);
      return new Response(JSON.stringify({ mode, hn, twitter: tw }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (mode === "reaggregate-dry") {
      const result = await callReaggregate(true);
      return new Response(JSON.stringify({ mode, result }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (mode === "reaggregate-apply") {
      const result = await callReaggregate(false);
      return new Response(JSON.stringify({ mode, result }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "unknown mode", validModes: ["backfill-may7", "reaggregate-dry", "reaggregate-apply"] }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown", stack: e instanceof Error ? e.stack?.slice(0, 1000) : null }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
