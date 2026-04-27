import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  claimServiceLock,
  refreshScores,
  releaseServiceLock,
  type ModelRow,
} from "../_shared/score-refresh.ts";

// Cron currently calls this function with the public anon JWT. Keep handler
// auth compatible with pg_cron and use service-role credentials only from env.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let lockOwner: string | null = null;

  try {
    const { data: models, error: modelsError } = await supabase
      .from("models")
      .select("id, name, slug");
    if (modelsError) throw new Error(`Failed to fetch models: ${modelsError.message}`);
    if (!models || models.length === 0) {
      return new Response(JSON.stringify({ error: "No models found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lock = await claimServiceLock(supabase, "vibes-score-refresh", 900);
    lockOwner = lock.owner;
    if (!lock.claimed) {
      return new Response(JSON.stringify({ status: "skipped", reason: "score_refresh_already_running" }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summary = await refreshScores(supabase, models as ModelRow[], {
      daysBack: 2,
      includeHourly: true,
    });

    await supabase.from("error_log").insert({
      function_name: "aggregate-vibes",
      error_message: `Score refresh complete: daily=${summary.daily_rows} hourly=${summary.hourly_rows}`,
      context: JSON.stringify({
        posts_scanned: summary.posts_scanned,
        skipped_days: summary.skipped_days,
        models: summary.models,
      }),
    });

    return new Response(JSON.stringify({ status: "complete", summary }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown";
    try {
      await supabase.from("error_log").insert({
        function_name: "aggregate-vibes",
        error_message: message,
        context: "top-level error",
      });
    } catch {}
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (lockOwner) {
      try {
        await releaseServiceLock(supabase, "vibes-score-refresh", lockOwner);
      } catch (e) {
        console.error("Failed to release score lock", e);
      }
    }
  }
});
