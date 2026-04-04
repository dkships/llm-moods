import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    let body: any = {};
    try { body = await req.json(); } catch {}

    const daysBack = body.days_back ?? 30;
    const modelSlugFilter = body.model_slug ?? null;

    const { data: models } = await supabase.from("models").select("id, name, slug");
    if (!models || models.length === 0) {
      return new Response(JSON.stringify({ error: "No models found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const filteredModels = modelSlugFilter
      ? models.filter((m: any) => m.slug === modelSlugFilter)
      : models;

    const now = new Date();
    const days: string[] = [];
    for (let d = daysBack; d >= 0; d--) {
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d));
      days.push(day.toISOString().slice(0, 10));
    }

    const rangeStart = days[0] + "T00:00:00.000Z";
    const rangeEnd = days[days.length - 1] + "T23:59:59.999Z";

    const report: Record<string, any[]> = {};

    for (const model of filteredModels) {
      // Get all scraped posts in range grouped by date and source
      const { data: posts } = await supabase
        .from("scraped_posts")
        .select("posted_at, source")
        .eq("model_id", model.id)
        .gte("posted_at", rangeStart)
        .lte("posted_at", rangeEnd)
        .limit(10000);

      // Build per-day post counts by source
      const postsByDay: Record<string, Record<string, number>> = {};
      for (const p of posts || []) {
        const day = new Date(p.posted_at).toISOString().slice(0, 10);
        if (!postsByDay[day]) postsByDay[day] = {};
        postsByDay[day][p.source] = (postsByDay[day][p.source] || 0) + 1;
      }

      // Get vibes scores in range
      const { data: scores } = await supabase
        .from("vibes_scores")
        .select("period_start, score, total_posts")
        .eq("model_id", model.id)
        .eq("period", "daily")
        .gte("period_start", rangeStart)
        .lte("period_start", rangeEnd)
        .order("period_start", { ascending: true });

      const scoresByDay: Record<string, { score: number; total_posts: number }> = {};
      for (const s of scores || []) {
        const day = new Date(s.period_start).toISOString().slice(0, 10);
        scoresByDay[day] = { score: s.score, total_posts: s.total_posts };
      }

      // Build report for each day
      const modelReport: any[] = [];
      for (const day of days) {
        const sources = postsByDay[day] || {};
        const totalPosts = Object.values(sources).reduce((a, b) => a + b, 0);
        const vibes = scoresByDay[day] || null;

        modelReport.push({
          date: day,
          scraped_post_count: totalPosts,
          posts_by_source: totalPosts > 0 ? sources : {},
          vibes_score: vibes?.score ?? null,
          vibes_total_posts: vibes?.total_posts ?? null,
          is_carry_forward: vibes !== null && vibes.total_posts === 0,
        });
      }

      report[model.slug] = modelReport;
    }

    // Summary: identify gap periods per model
    const summary: Record<string, { total_days: number; days_with_posts: number; days_carry_forward: number; days_no_score: number; gap_periods: string[] }> = {};
    for (const [slug, days_report] of Object.entries(report)) {
      let gapStart: string | null = null;
      const gaps: string[] = [];
      let carryForward = 0;
      let withPosts = 0;
      let noScore = 0;

      for (const day of days_report) {
        if (day.scraped_post_count === 0) {
          if (!gapStart) gapStart = day.date;
        } else {
          if (gapStart) {
            const prevDay = days_report[days_report.indexOf(day) - 1];
            gaps.push(`${gapStart} to ${prevDay?.date || gapStart}`);
            gapStart = null;
          }
          withPosts++;
        }
        if (day.is_carry_forward) carryForward++;
        if (day.vibes_score === null) noScore++;
      }
      if (gapStart) {
        gaps.push(`${gapStart} to ${days_report[days_report.length - 1].date}`);
      }

      summary[slug] = {
        total_days: days_report.length,
        days_with_posts: withPosts,
        days_carry_forward: carryForward,
        days_no_score: noScore,
        gap_periods: gaps,
      };
    }

    return new Response(JSON.stringify({ summary, details: report }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
