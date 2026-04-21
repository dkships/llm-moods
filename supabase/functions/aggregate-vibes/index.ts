import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyScoreSmoothing,
  computeScore,
  DEFAULT_MIN_POSTS,
  getPacificDayWindow,
  getPreviousDailyScore,
  type ScoreResult,
} from "../_shared/vibes-scoring.ts";
import { internalOnlyResponse, isInternalServiceRequest } from "../_shared/runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isInternalServiceRequest(req)) return internalOnlyResponse(corsHeaders);

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
    const dailyWindow = getPacificDayWindow(now);

    const summary: Record<string, any> = {};

    for (const model of models) {
      const modelSummary: any = { daily: null, hourly: null };

      // --- Daily aggregation (Pacific-local calendar day) ---
      const { data: dailyPosts } = await supabase
        .from("scraped_posts")
        .select("sentiment, complaint_category, confidence, score, content_type, source")
        .eq("model_id", model.id)
        .gte("posted_at", dailyWindow.rangeStart)
        .lt("posted_at", dailyWindow.rangeEnd)
        .limit(5000);

      // Get the most recent historical daily row. Exclude today's row so repeated
      // runs do not smooth against their own already-updated output.
      const { data: recentDailyScores } = await supabase
        .from("vibes_scores")
        .select("period_start, score")
        .eq("model_id", model.id)
        .eq("period", "daily")
        .order("period_start", { ascending: false })
        .limit(4);

      const previousScore = getPreviousDailyScore(
        (recentDailyScores ?? []) as { period_start: string; score: number }[],
        dailyWindow.periodStart,
      );

      if (dailyPosts && dailyPosts.length > 0) {
        const result = computeScore(dailyPosts);
        result.score = applyScoreSmoothing(
          result.score,
          previousScore,
          result.eligible_posts,
          DEFAULT_MIN_POSTS,
        );

        await upsertScore(supabase, model.id, "daily", dailyWindow.periodStart, result);
        modelSummary.daily = {
          posts: dailyPosts.length,
          eligible_posts: result.eligible_posts,
          score: result.score,
          smoothed: previousScore !== null,
          thin_data: result.eligible_posts < DEFAULT_MIN_POSTS,
        };
      } else {
        // No posts — carry forward previous score for up to 3 consecutive days
        if (previousScore !== null) {
          // Check how many consecutive days already carried forward
          const { data: recentScores } = await supabase
            .from("vibes_scores")
            .select("period_start, total_posts")
            .eq("model_id", model.id)
            .eq("period", "daily")
            .lt("period_start", dailyWindow.periodStart)
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
              eligible_posts: 0,
              top_complaint: null,
            };
            await upsertScore(supabase, model.id, "daily", dailyWindow.periodStart, carryForward);
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
