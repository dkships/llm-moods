import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: models } = await supabase.from("models").select("id, name, slug");
    if (!models || models.length === 0) {
      return new Response(JSON.stringify({ error: "No models found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();

    // Daily: start of today UTC
    const dailyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // Hourly: start of current hour UTC
    const hourlyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));

    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const since1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const summary: Record<string, any> = {};

    for (const model of models) {
      const modelSummary: any = { daily: null, hourly: null };

      // --- Daily aggregation (last 24h) ---
      const { data: dailyPosts } = await supabase
        .from("scraped_posts")
        .select("sentiment, complaint_category")
        .eq("model_id", model.id)
        .gte("posted_at", since24h);

      if (dailyPosts && dailyPosts.length > 0) {
        const result = computeScore(dailyPosts);
        await upsertScore(supabase, model.id, "daily", dailyStart.toISOString(), result);
        modelSummary.daily = { posts: dailyPosts.length, score: result.score };
      }

      // --- Hourly aggregation (last 1h) ---
      const { data: hourlyPosts } = await supabase
        .from("scraped_posts")
        .select("sentiment, complaint_category")
        .eq("model_id", model.id)
        .gte("posted_at", since1h);

      if (hourlyPosts && hourlyPosts.length > 0) {
        const result = computeScore(hourlyPosts);
        await upsertScore(supabase, model.id, "hourly", hourlyStart.toISOString(), result);
        modelSummary.hourly = { posts: hourlyPosts.length, score: result.score };
      }

      summary[model.slug] = modelSummary;
    }

    return new Response(JSON.stringify({ aggregated: summary }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("aggregate-vibes error:", e);
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

function computeScore(
  posts: { sentiment: string | null; complaint_category: string | null }[]
): ScoreResult {
  let positive = 0, negative = 0, neutral = 0;
  const complaints: Record<string, number> = {};

  for (const p of posts) {
    if (p.sentiment === "positive") positive++;
    else if (p.sentiment === "negative") {
      negative++;
      if (p.complaint_category) {
        complaints[p.complaint_category] = (complaints[p.complaint_category] || 0) + 1;
      }
    } else neutral++;
  }

  const total = posts.length;
  // neutral counts as 0.5 positive
  const effectivePositive = positive + neutral * 0.5;
  const score = Math.round((effectivePositive / total) * 100);

  let topComplaint: string | null = null;
  let maxCount = 0;
  for (const [cat, count] of Object.entries(complaints)) {
    if (count > maxCount) {
      maxCount = count;
      topComplaint = cat;
    }
  }

  return { score, positive_count: positive, negative_count: negative, neutral_count: neutral, total_posts: total, top_complaint: topComplaint };
}

async function upsertScore(
  supabase: any,
  modelId: string,
  period: string,
  periodStart: string,
  result: ScoreResult
) {
  // Check if exists
  const { data: existing } = await supabase
    .from("vibes_scores")
    .select("id")
    .eq("model_id", modelId)
    .eq("period", period)
    .eq("period_start", periodStart)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("vibes_scores")
      .update({
        score: result.score,
        positive_count: result.positive_count,
        negative_count: result.negative_count,
        neutral_count: result.neutral_count,
        total_posts: result.total_posts,
        top_complaint: result.top_complaint,
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("vibes_scores").insert({
      model_id: modelId,
      period,
      period_start: periodStart,
      score: result.score,
      positive_count: result.positive_count,
      negative_count: result.negative_count,
      neutral_count: result.neutral_count,
      total_posts: result.total_posts,
      top_complaint: result.top_complaint,
    });
  }
}
