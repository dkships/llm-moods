// TEMPORARY research helper — delete from the deployed function list (and this
// repo) when the July 2026 research articles ship. Read-only against the DB
// except mode "reaggregate", which forwards to the existing reaggregate-vibes
// function with the service-role key. Gate: service-role JWT or the pg_cron
// scheduler body (same accepted-risk pattern as the scrapers; every mode is
// bounded — the one paid mode has a hard $0.10 in-code Apify charge cap).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  internalOnlyResponse,
  isInternalServiceRequest,
  isSchedulerRequest,
  readJsonBody,
} from "../_shared/runtime.ts";
import {
  apifyDatasetItemsUrl,
  apifyRunUrl,
  checkApifyBudget,
  scrubApifyRun,
} from "../_shared/apify-budget.ts";
import {
  computeScore,
  getLocalDateLabel,
  PACIFIC_TIMEZONE,
  type ScoreInputPost,
} from "../_shared/vibes-scoring.ts";

const SOURCE = "research-window-export";
const CODE_VERSION = "2026-07-17-a";
const APIFY_MAX_TOTAL_CHARGE_USD = 0.10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface PostRow {
  id: string;
  model_id: string;
  posted_at: string;
  sentiment: string | null;
  complaint_category: string | null;
  praise_category: string | null;
  confidence: number | null;
  score: number | null;
  content_type: string | null;
  source: string | null;
  source_url: string | null;
  title: string | null;
  content: string | null;
}

async function pagePosts(
  supabase: ReturnType<typeof createClient>,
  since: string,
  until: string,
  columns: string,
): Promise<PostRow[]> {
  const rows: PostRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 100_000; from += pageSize) {
    const { data, error } = await supabase
      .from("scraped_posts")
      .select(columns)
      .eq("classification_status", "classified")
      .gte("posted_at", since)
      .lte("posted_at", until)
      .order("posted_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`page ${from}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as PostRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function dailyMatrix(supabase: ReturnType<typeof createClient>, since: string, until: string) {
  const rows = await pagePosts(
    supabase,
    since,
    until,
    "model_id, posted_at, sentiment, complaint_category, confidence, score, content_type, source",
  );

  const byCell = new Map<string, PostRow[]>();
  for (const row of rows) {
    const day = getLocalDateLabel(new Date(row.posted_at), PACIFIC_TIMEZONE);
    const key = `${row.model_id}|${day}`;
    const bucket = byCell.get(key);
    if (bucket) bucket.push(row);
    else byCell.set(key, [row]);
  }

  const { data: models, error: modelsErr } = await supabase.from("models").select("id, slug");
  if (modelsErr) throw new Error(modelsErr.message);
  const slugById = new Map<string, string>(
    (models ?? []).map((m: { id: string; slug: string }) => [m.id, m.slug] as [string, string]),
  );

  const { data: stored, error: storedErr } = await supabase
    .from("vibes_scores")
    .select("model_id, period_start, score")
    .eq("period", "daily")
    .gte("period_start", since)
    .lte("period_start", until);
  if (storedErr) throw new Error(storedErr.message);
  const storedByCell = new Map<string, number>(
    (stored ?? []).map((s: { model_id: string; period_start: string; score: number }) =>
      [
        `${s.model_id}|${getLocalDateLabel(new Date(s.period_start), PACIFIC_TIMEZONE)}`,
        s.score,
      ] as [string, number]
    ),
  );

  interface MatrixCell {
    model: string;
    date: string;
    positive: number;
    negative: number;
    neutral: number;
    eligible: number;
    total: number;
    recomputed_score: number;
    stored_score: number | null;
    complaints: Record<string, number>;
    sources: Record<string, number>;
  }
  const cells: MatrixCell[] = [];
  for (const [key, posts] of byCell) {
    const [modelId, day] = key.split("|");
    const recomputed = computeScore(posts as ScoreInputPost[]);
    const complaints: Record<string, number> = {};
    const sources: Record<string, number> = {};
    for (const post of posts) {
      if (post.sentiment === "negative" && post.complaint_category) {
        complaints[post.complaint_category] = (complaints[post.complaint_category] || 0) + 1;
      }
      const src = post.source || "unknown";
      sources[src] = (sources[src] || 0) + 1;
    }
    cells.push({
      model: slugById.get(modelId) ?? modelId,
      date: day,
      positive: recomputed.positive_count,
      negative: recomputed.negative_count,
      neutral: recomputed.neutral_count,
      eligible: recomputed.eligible_posts,
      total: posts.length,
      recomputed_score: recomputed.score,
      stored_score: storedByCell.get(key) ?? null,
      complaints,
      sources,
    });
  }
  cells.sort((a, b) => (a.date === b.date ? a.model.localeCompare(b.model) : a.date.localeCompare(b.date)));
  return { cells, post_rows_scanned: rows.length };
}

async function keywordPosts(
  supabase: ReturnType<typeof createClient>,
  terms: string[],
  since: string,
  until: string,
  limit: number,
) {
  const cleaned = terms
    .map((t) => String(t).replace(/[%_,()]/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12);
  if (cleaned.length === 0) throw new Error("no usable terms");
  const orFilter = cleaned
    .flatMap((t) => [`content.ilike.*${t}*`, `title.ilike.*${t}*`])
    .join(",");
  const { data, error } = await supabase
    .from("scraped_posts")
    .select(
      "id, model_id, posted_at, sentiment, complaint_category, praise_category, confidence, score, content_type, source, source_url, title, content",
    )
    .eq("classification_status", "classified")
    .gte("posted_at", since)
    .lte("posted_at", until)
    .or(orFilter)
    .order("posted_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 2000));
  if (error) throw new Error(error.message);
  return { posts: data ?? [], terms: cleaned };
}

async function twitterSearch(searchTerms: string[], maxItems: number) {
  const apifyToken = Deno.env.get("APIFY_API_TOKEN");
  if (!apifyToken) throw new Error("APIFY_API_TOKEN missing");
  const terms = searchTerms.map((t) => String(t)).filter(Boolean).slice(0, 5);
  if (terms.length === 0) throw new Error("no search terms");
  const cappedItems = Math.min(Math.max(maxItems || 50, 10), 150);

  const budget = await checkApifyBudget(apifyToken, APIFY_MAX_TOTAL_CHARGE_USD);
  if (!budget.allowed) {
    return { skipped: true, reason: budget.reason, apifyBudget: budget.usage };
  }

  const startRes = await fetch(
    apifyRunUrl("apidojo~tweet-scraper", apifyToken, cappedItems, {
      timeoutSecs: 180,
      maxTotalChargeUsd: APIFY_MAX_TOTAL_CHARGE_USD,
    }),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchTerms: terms, sort: "Top", maxItems: cappedItems }),
    },
  );
  if (!startRes.ok) throw new Error(`Apify start ${startRes.status}`);
  const runData = await startRes.json();
  const runId = runData.data?.id;
  const datasetId = runData.data?.defaultDatasetId;
  if (!runId || !datasetId) throw new Error("Missing Apify runId/datasetId");

  let status = "";
  let terminal: unknown = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`);
    if (!res.ok) continue;
    const payload = await res.json();
    status = payload.data?.status || "";
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
      terminal = payload.data;
      break;
    }
  }
  if (status !== "SUCCEEDED") {
    return { error: `Apify run ${status || "TIMEOUT"}`, apifyUsage: scrubApifyRun(terminal) };
  }
  const datasetRes = await fetch(apifyDatasetItemsUrl(datasetId, apifyToken, { limit: cappedItems }));
  if (!datasetRes.ok) throw new Error("dataset fetch failed");
  const items = await datasetRes.json();
  const slim = (Array.isArray(items) ? items : [])
    .filter((t: Record<string, unknown>) => (t.text || t.full_text) && !t.isRetweet && !t.is_retweet)
    .map((t: Record<string, any>) => ({
      text: String(t.text || t.full_text || "").slice(0, 2000),
      url: t.url || t.twitterUrl || null,
      created_at: t.created_at || t.createdAt || null,
      author: t.author?.userName || t.author?.username || null,
      followers: t.author?.followers ?? null,
      likes: t.likeCount ?? t.favorite_count ?? null,
      retweets: t.retweetCount ?? null,
      views: t.viewCount ?? null,
      is_reply: Boolean(t.isReply ?? t.in_reply_to_status_id),
    }));
  return { tweets: slim, count: slim.length, apifyUsage: scrubApifyRun(terminal), apifyBudget: budget.usage };
}

async function forwardReaggregate(daysBack: number) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("missing env");
  const res = await fetch(`${supabaseUrl}/functions/v1/reaggregate-vibes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ days_back: Math.min(Math.max(daysBack || 21, 1), 100) }),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch { /* keep raw text */ }
  return { status: res.status, response: parsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = (await readJsonBody(req)) as Record<string, unknown>;
  if (!isInternalServiceRequest(req) && !isSchedulerRequest(body, SOURCE)) {
    return internalOnlyResponse(corsHeaders);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const mode = String(body.mode || "");
    const since = String(body.since || "2026-04-15T00:00:00Z");
    const until = String(body.until || new Date().toISOString());

    if (mode === "ping") {
      return jsonResponse({ ok: true, codeVersion: CODE_VERSION });
    }
    if (mode === "daily_matrix") {
      return jsonResponse({ codeVersion: CODE_VERSION, ...(await dailyMatrix(supabase, since, until)) });
    }
    if (mode === "keyword_posts") {
      const terms = Array.isArray(body.terms) ? (body.terms as string[]) : [];
      const limit = Number(body.limit) || 500;
      return jsonResponse({ codeVersion: CODE_VERSION, ...(await keywordPosts(supabase, terms, since, until, limit)) });
    }
    if (mode === "twitter_search") {
      const terms = Array.isArray(body.search_terms) ? (body.search_terms as string[]) : [];
      return jsonResponse({ codeVersion: CODE_VERSION, ...(await twitterSearch(terms, Number(body.max_items) || 50)) });
    }
    if (mode === "reaggregate") {
      return jsonResponse({ codeVersion: CODE_VERSION, ...(await forwardReaggregate(Number(body.days_back))) });
    }
    return jsonResponse({ error: `unknown mode: ${mode}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return jsonResponse({ error: msg }, 500);
  }
});
