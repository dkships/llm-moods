import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ScoreResult {
  score: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  total_posts: number;
  top_complaint: string | null;
}

function computeScore(posts: { sentiment: string | null; complaint_category: string | null; confidence: number | null; score: number | null; content_type: string | null; source?: string | null }[]): ScoreResult {
  const MIN_CONFIDENCE = 0.65;
  const MAX_SOURCE_SHARE = 0.5;

  // First pass: compute per-source total weights to detect dominance
  const sourceRawWeights: Record<string, number> = {};
  const eligible: { w: number; sentiment: string | null; complaint_category: string | null; source: string }[] = [];

  for (const p of posts) {
    const rawConf = p.confidence ?? 0.5;
    if (rawConf < MIN_CONFIDENCE) continue; // Skip low-confidence posts

    const contentMult = p.content_type === "title_only" ? 0.6 : 1.0;
    const conf = Math.max(0, Math.min(1, rawConf)) * contentMult;
    const engagement = (p.score && p.score > 0) ? Math.log(p.score + 1) : 1.0;
    const w = conf * engagement;
    const src = p.source || "unknown";
    sourceRawWeights[src] = (sourceRawWeights[src] || 0) + w;
    eligible.push({ w, sentiment: p.sentiment, complaint_category: p.complaint_category, source: src });
  }

  // Compute per-source scale factors to cap dominant sources
  const totalRaw = Object.values(sourceRawWeights).reduce((a, b) => a + b, 0);
  const sourceScale: Record<string, number> = {};
  if (totalRaw > 0) {
    const maxAllowed = totalRaw * MAX_SOURCE_SHARE;
    for (const [src, srcW] of Object.entries(sourceRawWeights)) {
      sourceScale[src] = srcW > maxAllowed ? maxAllowed / srcW : 1.0;
    }
  }

  // Second pass: accumulate with source caps applied
  let positiveW = 0, negativeW = 0, neutralW = 0;
  let positiveC = 0, negativeC = 0, neutralC = 0;
  const complaints: Record<string, number> = {};

  for (const e of eligible) {
    const w = e.w * (sourceScale[e.source] ?? 1.0);
    if (e.sentiment === "positive") { positiveW += w; positiveC++; }
    else if (e.sentiment === "negative") {
      negativeW += w; negativeC++;
      if (e.complaint_category) complaints[e.complaint_category] = (complaints[e.complaint_category] || 0) + w;
    } else { neutralW += w; neutralC++; }
  }

  const totalW = positiveW + negativeW + neutralW;
  const effectivePositive = positiveW + neutralW * 0.3;
  const score = totalW > 0 ? Math.round((effectivePositive / totalW) * 100) : 50;

  let topComplaint: string | null = null;
  let maxCount = 0;
  for (const [cat, count] of Object.entries(complaints)) {
    if (count > maxCount) { maxCount = count; topComplaint = cat; }
  }

  return { score, positive_count: positiveC, negative_count: negativeC, neutral_count: neutralC, total_posts: posts.length, top_complaint: topComplaint };
}

async function upsertScore(supabase: any, modelId: string, period: string, periodStart: string, result: ScoreResult) {
  const { data: existing } = await supabase
    .from("vibes_scores")
    .select("id")
    .eq("model_id", modelId)
    .eq("period", period)
    .eq("period_start", periodStart)
    .maybeSingle();

  const payload = {
    score: result.score,
    positive_count: result.positive_count,
    negative_count: result.negative_count,
    neutral_count: result.neutral_count,
    total_posts: result.total_posts,
    top_complaint: result.top_complaint,
  };

  if (existing) {
    await supabase.from("vibes_scores").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("vibes_scores").insert({ model_id: modelId, period, period_start: periodStart, ...payload });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    let body: any = {};
    try { body = await req.json(); } catch {}

    const daysBack = body.days_back ?? 30;
    const minPosts = body.min_posts ?? 5;
    const dryRun = body.dry_run ?? false;

    await supabase.from("error_log").insert({
      function_name: "reaggregate-vibes",
      error_message: `Started: days_back=${daysBack}, min_posts=${minPosts}, dry_run=${dryRun}`,
      context: "health-check",
    });

    const { data: models } = await supabase.from("models").select("id, name, slug");
    if (!models || models.length === 0) {
      return new Response(JSON.stringify({ error: "No models found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build array of UTC calendar days
    const now = new Date();
    const days: Date[] = [];
    for (let d = daysBack; d >= 0; d--) {
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d));
      days.push(day);
    }

    const rangeStart = days[0].toISOString();
    const rangeEnd = days[days.length - 1].toISOString();

    const summary: Record<string, { days_processed: number; days_skipped: number; scores: { date: string; score: number; posts: number }[] }> = {};

    for (const model of models) {
      const modelResult = { days_processed: 0, days_skipped: 0, scores: [] as { date: string; score: number; posts: number }[] };

      // Delete existing daily scores in range to remove stale carry-forwards
      if (!dryRun) {
        await supabase
          .from("vibes_scores")
          .delete()
          .eq("model_id", model.id)
          .eq("period", "daily")
          .gte("period_start", rangeStart)
          .lte("period_start", rangeEnd);
      }

      // Get seed score: the most recent daily score BEFORE the range
      const { data: seedRow } = await supabase
        .from("vibes_scores")
        .select("score")
        .eq("model_id", model.id)
        .eq("period", "daily")
        .lt("period_start", rangeStart)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle();

      let previousScore: number | null = seedRow?.score ?? null;
      let consecutiveEmpty = 0;

      for (const day of days) {
        const dayStart = day.toISOString();
        const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
        const dayEnd = nextDay.toISOString();
        const dayLabel = dayStart.split("T")[0];

        // Get all posts for this calendar day
        const { data: posts } = await supabase
          .from("scraped_posts")
          .select("sentiment, complaint_category, confidence, score, content_type, source")
          .eq("model_id", model.id)
          .gte("posted_at", dayStart)
          .lt("posted_at", dayEnd)
          .limit(5000);

        const postCount = posts?.length ?? 0;

        if (postCount === 0) {
          consecutiveEmpty++;
          // Carry forward previous score for up to 3 days to avoid short chart gaps
          if (previousScore !== null && consecutiveEmpty <= 3) {
            const carryForward: ScoreResult = {
              score: previousScore,
              positive_count: 0,
              negative_count: 0,
              neutral_count: 0,
              total_posts: 0,
              top_complaint: null,
            };
            if (!dryRun) {
              await upsertScore(supabase, model.id, "daily", dayStart, carryForward);
            }
            modelResult.days_processed++;
            modelResult.scores.push({ date: dayLabel, score: previousScore, posts: 0 });
          } else {
            modelResult.days_skipped++;
          }
          continue;
        }

        consecutiveEmpty = 0;

        const result = computeScore(posts!);

        // Apply smoothing based on post count
        if (previousScore !== null) {
          if (postCount < minPosts) {
            // Thin data: heavy smoothing toward previous score
            result.score = Math.round(0.4 * result.score + 0.6 * previousScore);
          } else {
            // Normal data: standard smoothing
            result.score = Math.round(0.7 * result.score + 0.3 * previousScore);
          }
        }

        if (!dryRun) {
          await upsertScore(supabase, model.id, "daily", dayStart, result);
        }

        previousScore = result.score;
        modelResult.days_processed++;
        modelResult.scores.push({ date: dayLabel, score: result.score, posts: postCount });
      }

      summary[model.slug] = modelResult;
    }

    await supabase.from("error_log").insert({
      function_name: "reaggregate-vibes",
      error_message: `Complete: ${models.length} models, ${daysBack} days`,
      context: JSON.stringify(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { processed: v.days_processed, skipped: v.days_skipped }]))),
    });

    return new Response(JSON.stringify({ status: "complete", dry_run: dryRun, summary }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await supabase.from("error_log").insert({ function_name: "reaggregate-vibes", error_message: msg, context: "top-level error" });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
