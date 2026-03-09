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
    const hourlyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const since1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const summary: Record<string, any> = {};

    for (const model of models) {
      const modelSummary: any = { daily: null, hourly: null };

      // --- Daily aggregation (last 24h) ---
      const { data: dailyPosts } = await supabase
        .from("scraped_posts")
        .select("sentiment, complaint_category, confidence, score, content_type")
        .eq("model_id", model.id)
        .gte("posted_at", since24h);

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

      if (dailyPosts && dailyPosts.length > 0) {
        const result = computeScore(dailyPosts);
        // Apply exponential smoothing: 70% new + 30% previous
        if (previousScore !== null) {
          result.score = Math.round(0.7 * result.score + 0.3 * previousScore);
        }
        await upsertScore(supabase, model.id, "daily", dailyStart.toISOString(), result);
        modelSummary.daily = { posts: dailyPosts.length, score: result.score, smoothed: previousScore !== null };
      } else {
        // No posts — keep previous day's score
        const { data: prevScore } = await supabase
          .from("vibes_scores")
          .select("*")
          .eq("model_id", model.id)
          .eq("period", "daily")
          .order("period_start", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prevScore) {
          await upsertScore(supabase, model.id, "daily", dailyStart.toISOString(), {
            score: prevScore.score,
            positive_count: prevScore.positive_count || 0,
            negative_count: prevScore.negative_count || 0,
            neutral_count: prevScore.neutral_count || 0,
            total_posts: prevScore.total_posts || 0,
            top_complaint: prevScore.top_complaint,
          });
          modelSummary.daily = { posts: 0, score: prevScore.score, carried_forward: true };
        }
      }

      // --- Hourly aggregation (last 1h) ---
      const { data: hourlyPosts } = await supabase
        .from("scraped_posts")
        .select("sentiment, complaint_category, confidence, score, content_type")
        .eq("model_id", model.id)
        .gte("posted_at", since1h);

      if (hourlyPosts && hourlyPosts.length > 0) {
        const result = computeScore(hourlyPosts);
        await upsertScore(supabase, model.id, "hourly", hourlyStart.toISOString(), result);
        modelSummary.hourly = { posts: hourlyPosts.length, score: result.score };
      }

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

function computeScore(posts: { sentiment: string | null; complaint_category: string | null; confidence: number | null; score: number | null; content_type: string | null }[]): ScoreResult {
  let positiveW = 0, negativeW = 0, neutralW = 0;
  let positiveC = 0, negativeC = 0, neutralC = 0;
  const complaints: Record<string, number> = {};

  for (const p of posts) {
    const conf = Math.max(0, Math.min(1, p.confidence ?? 0.5));
    const engagement = (p.score && p.score > 0) ? Math.log(p.score + 1) : 1.0;
    const w = conf * engagement;
    if (p.sentiment === "positive") { positiveW += w; positiveC++; }
    else if (p.sentiment === "negative") {
      negativeW += w; negativeC++;
      if (p.complaint_category) complaints[p.complaint_category] = (complaints[p.complaint_category] || 0) + w;
    } else { neutralW += w; neutralC++; }
  }

  const totalW = positiveW + negativeW + neutralW;
  const effectivePositive = positiveW + neutralW * 0.5;
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
