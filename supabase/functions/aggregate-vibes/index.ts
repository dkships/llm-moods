import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    await supabase.from("error_log").insert({ function_name: "aggregate-vibes", error_message: "Function started", context: "health-check" });

    const { data: models } = await supabase.from("models").select("id, name, slug");
    if (!models || models.length === 0) {
      return new Response(JSON.stringify({ error: "No models found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const dailyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const summary: Record<string, any> = {};

    for (const model of models) {
      const modelSummary: any = { daily: null, hourly: null };

      // --- Daily aggregation (last 24h) ---
      const { data: dailyPosts } = await supabase
        .from("scraped_posts")
        .select("sentiment, complaint_category, confidence, score, content_type, source")
        .eq("model_id", model.id)
        .gte("posted_at", since24h)
        .limit(5000);

      // Get previous daily score for exponential smoothing
      const { data: prevDailyScore } = await supabase
        .from("vibes_scores")
        .select("score")
        .eq("model_id", model.id)
        .eq("period", "daily")
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle();

      const previousScore = prevDailyScore?.score ?? null;

      const MIN_POSTS = 5;

      if (dailyPosts && dailyPosts.length > 0) {
        const result = computeScore(dailyPosts);
        // Apply smoothing: heavier toward previous when data is thin
        if (previousScore !== null) {
          if (dailyPosts.length < MIN_POSTS) {
            // Thin data: lean more on previous score to dampen noise
            result.score = Math.round(0.4 * result.score + 0.6 * previousScore);
          } else {
            result.score = Math.round(0.7 * result.score + 0.3 * previousScore);
          }
        }
        await upsertScore(supabase, model.id, "daily", dailyStart.toISOString(), result);
        modelSummary.daily = { posts: dailyPosts.length, score: result.score, smoothed: previousScore !== null, thin_data: dailyPosts.length < MIN_POSTS };
      } else {
        // No posts — carry forward previous score for up to 3 consecutive days
        if (previousScore !== null) {
          // Check how many consecutive days already carried forward
          const { data: recentScores } = await supabase
            .from("vibes_scores")
            .select("total_posts")
            .eq("model_id", model.id)
            .eq("period", "daily")
            .order("period_start", { ascending: false })
            .limit(3);

          const consecutiveEmpty = (recentScores || [])
            .filter((s: any) => s.total_posts === 0).length;

          if (consecutiveEmpty < 3) {
            const carryForward: ScoreResult = {
              score: previousScore,
              positive_count: 0,
              negative_count: 0,
              neutral_count: 0,
              total_posts: 0,
              top_complaint: null,
            };
            await upsertScore(supabase, model.id, "daily", dailyStart.toISOString(), carryForward);
            modelSummary.daily = { posts: 0, score: previousScore, carried_forward: true, consecutive_empty: consecutiveEmpty + 1 };
          } else {
            modelSummary.daily = { posts: 0, skipped: true, reason: "carry_forward_cap_reached" };
          }
        } else {
          modelSummary.daily = { posts: 0, skipped: true };
        }
      }

      // --- Hourly aggregation (trailing 24h) ---
      const hourlyResults: { hour: string; posts: number; score: number }[] = [];
      for (let h = 23; h >= 0; h--) {
        const hStart = new Date(Date.UTC(
          now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
          now.getUTCHours() - h
        ));
        const hEnd = new Date(hStart.getTime() + 60 * 60 * 1000);

        const { data: hPosts } = await supabase
          .from("scraped_posts")
          .select("sentiment, complaint_category, confidence, score, content_type, source")
          .eq("model_id", model.id)
          .gte("posted_at", hStart.toISOString())
          .lt("posted_at", hEnd.toISOString())
          .limit(5000);

        if (hPosts && hPosts.length > 0) {
          const result = computeScore(hPosts);
          await upsertScore(supabase, model.id, "hourly", hStart.toISOString(), result);
          hourlyResults.push({ hour: hStart.toISOString(), posts: hPosts.length, score: result.score });
        }
      }
      modelSummary.hourly = hourlyResults.length > 0
        ? { hours_with_data: hourlyResults.length, details: hourlyResults }
        : { hours_with_data: 0 };

      summary[model.slug] = modelSummary;
    }

    try {
      await supabase.from("error_log").insert({
        function_name: "aggregate-vibes",
        error_message: `Successfully aggregated vibes for ${models.length} models`,
        context: JSON.stringify(summary),
      });
    } catch {}

    return new Response(JSON.stringify({ aggregated: summary }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("aggregate-vibes error:", e);
    try {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await supabase.from("error_log").insert({
        function_name: "aggregate-vibes",
        error_message: e instanceof Error ? e.message : "Unknown",
        context: "top-level error",
      });
    } catch {}
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

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
