// One-shot historical backfill helper. Fills vibes_scores chart gaps caused
// by days where a model had zero keyword matches or zero eligible posts.
//
// Existing scrapers fetch "current state" (Apify Reddit/Twitter "latest",
// Bluesky default sort, HN sorted by date with a rolling 24h window). They
// cannot replay a past date if today's run missed it. This helper queries
// the same source APIs but with date-bounded operators so we can recover
// posts from sealed Pacific-day windows.
//
// Sources that accept historical date bounds:
//   - hackernews   : Algolia search_by_date with numericFilters bounds
//   - bluesky      : app.bsky.feed.searchPosts with since/until params
//   - twitter      : Apify apidojo~tweet-scraper via searchTerms with
//                    Twitter's native "since:YYYY-MM-DD until:YYYY-MM-DD"
//
// Reddit's Apify lite actor doesn't accept date bounds, so it's omitted.
//
// Inserts arrive as classification_status='pending' so the existing
// drain-classification-queue cron picks them up on its 2-min cycle. After
// that, invoke reaggregate-vibes with days_back covering the gap window to
// rebuild scores including the new posts.
//
// This is an ephemeral helper — delete from the deployed function list
// after the backfill run completes (per project convention for one-shot
// service-role helpers).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  internalOnlyResponse,
  isInternalServiceRequest,
  readJsonBody,
} from "../_shared/runtime.ts";
import {
  corsHeaders,
  loadKeywords,
  matchModels,
  meetsMinLength,
  isLikelyNonExperienceShare,
  logToErrorLog,
  upsertPendingScrapedPost,
  type KeywordEntry,
} from "../_shared/utils.ts";
import { apifyRunUrl, scrubApifyRun } from "../_shared/apify-budget.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const SOURCE = "historical-gap-fill";

interface GapRequest {
  modelSlug: string;
  ptDate: string; // YYYY-MM-DD interpreted as Pacific date
}

interface SourceReport {
  postsFound: number;
  inserted: number;
  duplicates: number;
  matched: number;
  contentSkipped: number;
  errors: string[];
}

interface GapReport {
  modelSlug: string;
  ptDate: string;
  windowStart: string;
  windowEnd: string;
  bySource: Record<string, SourceReport>;
}

// Pacific = UTC-7 during DST (Apr 2026 is in PDT). Mirrors score-refresh
// dayWindows convention so the window boundaries align with vibes_scores rows.
function ptDateToUtcWindow(ptDate: string): { start: string; end: string } {
  const start = new Date(`${ptDate}T07:00:00Z`);
  const end = new Date(start.getTime() + 24 * 3600000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Per-model search terms for historical recovery. Wider than the high-tier
// keyword list because we cast the net broadly here and let matchModels()
// downstream filter to the actual model. Keyword filtering plus the existing
// classifier pass keeps noise out of vibes_scores.
const SEARCH_TERMS: Record<string, string[]> = {
  grok: ["Grok AI", "Grok 4", "xAI grok", "Grok"],
  gemini: ["Gemini AI", "Gemini 2.5", "Gemini Pro", "Gemini"],
  claude: ["Claude AI", "Claude Sonnet", "Claude Opus", "Claude"],
  chatgpt: ["ChatGPT", "GPT-5", "GPT-4o", "OpenAI"],
};

function emptyReport(): SourceReport {
  return {
    postsFound: 0,
    inserted: 0,
    duplicates: 0,
    matched: 0,
    contentSkipped: 0,
    errors: [],
  };
}

async function backfillHackerNews(
  supabase: any,
  modelSlug: string,
  modelId: string,
  window: { start: string; end: string },
  keywords: KeywordEntry[],
  modelMap: Record<string, string>,
): Promise<SourceReport> {
  const report = emptyReport();
  const terms = SEARCH_TERMS[modelSlug] ?? [modelSlug];
  const startSec = Math.floor(new Date(window.start).getTime() / 1000);
  const endSec = Math.floor(new Date(window.end).getTime() / 1000);

  for (const term of terms) {
    try {
      const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(term)}&tags=story&numericFilters=created_at_i>${startSec},created_at_i<${endSec}&hitsPerPage=50`;
      const res = await fetch(url);
      if (!res.ok) {
        report.errors.push(`HN "${term}": HTTP ${res.status}`);
        await delay(500);
        continue;
      }
      const data = await res.json();
      const hits = Array.isArray(data.hits) ? data.hits : [];
      report.postsFound += hits.length;

      for (const hit of hits) {
        if (!hit.title || !hit.created_at) { report.contentSkipped++; continue; }
        const text = `${hit.title} ${hit.url || ""}`;
        if (!meetsMinLength(hit.title, "")) { report.contentSkipped++; continue; }
        if (isLikelyNonExperienceShare(hit.title, "")) { report.contentSkipped++; continue; }
        const matched = matchModels(text, keywords);
        if (!matched.includes(modelSlug)) continue;
        report.matched++;

        const upsert = await upsertPendingScrapedPost(supabase, {
          model_id: modelId,
          source: "hackernews",
          source_url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          title: hit.title.slice(0, 500),
          content: hit.title.slice(0, 2000),
          content_type: "title_only",
          score: hit.points ?? 0,
          posted_at: hit.created_at,
          is_backfill: true,
        });
        if (upsert.error) { report.errors.push(`HN insert: ${upsert.error}`); continue; }
        if (upsert.inserted) report.inserted++; else report.duplicates++;
      }
    } catch (error) {
      report.errors.push(`HN "${term}": ${error instanceof Error ? error.message : String(error)}`);
    }
    await delay(500);
  }
  return report;
}

async function backfillBluesky(
  supabase: any,
  modelSlug: string,
  modelId: string,
  window: { start: string; end: string },
  keywords: KeywordEntry[],
  modelMap: Record<string, string>,
): Promise<SourceReport> {
  const report = emptyReport();
  const terms = SEARCH_TERMS[modelSlug] ?? [modelSlug];

  const handle = Deno.env.get("BLUESKY_HANDLE") ?? Deno.env.get("BSKY_HANDLE");
  const password = Deno.env.get("BLUESKY_APP_PASSWORD") ?? Deno.env.get("BSKY_APP_PASSWORD");
  if (!handle || !password) {
    report.errors.push("Missing BLUESKY_HANDLE / BLUESKY_APP_PASSWORD");
    return report;
  }
  let accessJwt: string | null = null;
  try {
    const authRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: handle, password }),
    });
    if (authRes.ok) accessJwt = (await authRes.json()).accessJwt ?? null;
  } catch (error) {
    report.errors.push(`Bluesky auth: ${error instanceof Error ? error.message : String(error)}`);
    return report;
  }
  if (!accessJwt) { report.errors.push("Bluesky auth returned no JWT"); return report; }

  for (const term of terms) {
    try {
      // searchPosts accepts since/until as ISO 8601; sort=top widens recall
      // for historical queries vs. sort=latest which biases to recent.
      const url = `https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&since=${encodeURIComponent(window.start)}&until=${encodeURIComponent(window.end)}&limit=100&sort=top`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessJwt}`, Accept: "application/json" } });
      if (!res.ok) {
        report.errors.push(`Bluesky "${term}": HTTP ${res.status}`);
        await delay(700);
        continue;
      }
      const json = await res.json();
      const posts = Array.isArray(json.posts) ? json.posts : [];
      report.postsFound += posts.length;

      for (const post of posts) {
        const text: string = post.record?.text ?? "";
        const createdAt = post.record?.createdAt ? new Date(post.record.createdAt) : null;
        if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
        // Bluesky sometimes returns posts just outside the requested window —
        // enforce the boundary client-side so we don't pollute the wrong day.
        if (createdAt < new Date(window.start) || createdAt >= new Date(window.end)) continue;
        if (!meetsMinLength(text, "")) { report.contentSkipped++; continue; }
        if (isLikelyNonExperienceShare(text, "")) { report.contentSkipped++; continue; }
        const matched = matchModels(text, keywords);
        if (!matched.includes(modelSlug)) continue;
        report.matched++;

        const handle = post.author?.handle ?? "";
        const uriParts = (post.uri ?? "").split("/");
        const rkey = uriParts[uriParts.length - 1];
        const sourceUrl = `https://bsky.app/profile/${handle}/post/${rkey}`;

        const upsert = await upsertPendingScrapedPost(supabase, {
          model_id: modelId,
          source: "bluesky",
          source_url: sourceUrl,
          title: text.slice(0, 200),
          content: text.slice(0, 2000),
          content_type: "full_content",
          score: post.likeCount ?? 0,
          posted_at: createdAt.toISOString(),
          is_backfill: true,
        });
        if (upsert.error) { report.errors.push(`Bluesky insert: ${upsert.error}`); continue; }
        if (upsert.inserted) report.inserted++; else report.duplicates++;
      }
    } catch (error) {
      report.errors.push(`Bluesky "${term}": ${error instanceof Error ? error.message : String(error)}`);
    }
    await delay(700);
  }
  return report;
}

async function backfillTwitter(
  supabase: any,
  modelSlug: string,
  modelId: string,
  window: { start: string; end: string },
  keywords: KeywordEntry[],
  modelMap: Record<string, string>,
): Promise<SourceReport> {
  const report = emptyReport();
  const apifyToken = Deno.env.get("APIFY_API_TOKEN");
  if (!apifyToken) { report.errors.push("Missing APIFY_API_TOKEN"); return report; }

  // Twitter search syntax: "term since:YYYY-MM-DD until:YYYY-MM-DD" (UTC).
  // since: is inclusive, until: is exclusive. Use the Pacific calendar date
  // string directly so the query lines up with the PT window we care about.
  const ptDate = window.start.slice(0, 10);
  const ptNextDate = window.end.slice(0, 10);
  const baseTerms = SEARCH_TERMS[modelSlug] ?? [modelSlug];
  // Cap at 2 terms per backfill day to keep Apify spend bounded
  // (~$0.02/run × 2 terms × N gap days).
  const searchTerms = baseTerms.slice(0, 2).map(
    (t) => `${t} since:${ptDate} until:${ptNextDate}`,
  );

  const apifyInput = {
    searchTerms,
    sort: "Top",
    maxItems: 50,
  };
  const maxChargeUsd = 0.10;

  try {
    const startRes = await fetch(apifyRunUrl("apidojo~tweet-scraper", apifyToken, apifyInput.maxItems, {
      timeoutSecs: 180,
      maxTotalChargeUsd: maxChargeUsd,
    }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apifyInput),
    });
    if (!startRes.ok) {
      const text = await startRes.text().catch(() => "");
      report.errors.push(`Apify start ${startRes.status}: ${text.slice(0, 300)}`);
      return report;
    }
    const runData = await startRes.json();
    const apifyRunId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;
    if (!apifyRunId || !datasetId) { report.errors.push("Apify missing runId/datasetId"); return report; }

    let status = "";
    for (let i = 0; i < 18; i++) {
      await delay(10000);
      const sRes = await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}?token=${apifyToken}`);
      if (!sRes.ok) continue;
      const sJson = await sRes.json();
      status = sJson.data?.status ?? "";
      if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) break;
    }
    if (status !== "SUCCEEDED") { report.errors.push(`Apify run ${status || "TIMEOUT"}`); return report; }

    const dsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`);
    if (!dsRes.ok) { report.errors.push(`Apify dataset HTTP ${dsRes.status}`); return report; }
    const items = await dsRes.json();
    if (!Array.isArray(items)) { report.errors.push("Apify dataset not array"); return report; }

    const tweets = items.filter((t: any) => t.text || t.full_text);
    report.postsFound += tweets.length;
    for (const tweet of tweets) {
      if (tweet.isRetweet || tweet.is_retweet) continue;
      const createdAt = new Date(tweet.created_at ?? tweet.createdAt);
      if (Number.isNaN(createdAt.getTime())) continue;
      if (createdAt < new Date(window.start) || createdAt >= new Date(window.end)) continue;
      const text = (tweet.text ?? tweet.full_text ?? "").slice(0, 2000);
      if (!text) continue;
      if (!meetsMinLength(text, "")) { report.contentSkipped++; continue; }
      if (isLikelyNonExperienceShare(text, "")) { report.contentSkipped++; continue; }
      const matched = matchModels(text, keywords);
      if (!matched.includes(modelSlug)) continue;
      report.matched++;

      const author = tweet.author?.userName ?? tweet.user?.screen_name ?? tweet.username ?? "i";
      const tweetId = tweet.id_str ?? tweet.id ?? tweet.tweetId;
      const sourceUrl = `https://twitter.com/${author}/status/${tweetId}`;
      const engagement = (tweet.likeCount ?? tweet.favorite_count ?? 0)
        + (tweet.retweetCount ?? tweet.retweet_count ?? 0);

      const upsert = await upsertPendingScrapedPost(supabase, {
        model_id: modelId,
        source: "twitter",
        source_url: sourceUrl,
        title: text.slice(0, 200),
        content: text,
        content_type: "full_content",
        score: engagement,
        posted_at: createdAt.toISOString(),
        is_backfill: true,
      });
      if (upsert.error) { report.errors.push(`Twitter insert: ${upsert.error}`); continue; }
      if (upsert.inserted) report.inserted++; else report.duplicates++;
    }
  } catch (error) {
    report.errors.push(`Twitter: ${error instanceof Error ? error.message : String(error)}`);
  }
  return report;
}

const SOURCE_FNS: Record<string, typeof backfillHackerNews> = {
  hackernews: backfillHackerNews,
  bluesky: backfillBluesky,
  twitter: backfillTwitter,
};

export async function handleHistoricalGapFill(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isInternalServiceRequest(req)) return internalOnlyResponse(corsHeaders);

  const body = await readJsonBody(req);
  const gaps: GapRequest[] = Array.isArray(body?.gaps) ? body.gaps : [];
  const sources: string[] = Array.isArray(body?.sources) && body.sources.length > 0
    ? body.sources
    : ["hackernews", "bluesky", "twitter"];

  if (gaps.length === 0) {
    return new Response(JSON.stringify({ error: "body.gaps must be a non-empty array of {modelSlug, ptDate}" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { modelMap, keywords } = await loadKeywords(supabase);
  const reports: GapReport[] = [];

  for (const gap of gaps) {
    const modelId = modelMap[gap.modelSlug];
    if (!modelId) {
      reports.push({
        modelSlug: gap.modelSlug,
        ptDate: gap.ptDate,
        windowStart: "",
        windowEnd: "",
        bySource: { _error: { ...emptyReport(), errors: [`Unknown modelSlug: ${gap.modelSlug}`] } },
      });
      continue;
    }
    const window = ptDateToUtcWindow(gap.ptDate);
    const report: GapReport = {
      modelSlug: gap.modelSlug,
      ptDate: gap.ptDate,
      windowStart: window.start,
      windowEnd: window.end,
      bySource: {},
    };
    for (const source of sources) {
      const fn = SOURCE_FNS[source];
      if (!fn) { report.bySource[source] = { ...emptyReport(), errors: [`Unknown source: ${source}`] }; continue; }
      report.bySource[source] = await fn(supabase, gap.modelSlug, modelId, window, keywords, modelMap);
    }
    reports.push(report);
  }

  // Summarize for the error_log so an operator can confirm the run from the
  // admin feed without needing the response body.
  const totalInserted = reports.reduce(
    (acc, r) => acc + Object.values(r.bySource).reduce((s, x) => s + x.inserted, 0),
    0,
  );
  await logToErrorLog(
    supabase,
    SOURCE,
    `Backfill complete: ${gaps.length} gaps processed, ${totalInserted} pending posts inserted (drain-classification-queue will classify within ~5 min)`,
    "summary",
  );

  return new Response(JSON.stringify({ source: SOURCE, gaps_processed: gaps.length, total_inserted: totalInserted, reports }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

if (import.meta.main) {
  Deno.serve(handleHistoricalGapFill);
}
