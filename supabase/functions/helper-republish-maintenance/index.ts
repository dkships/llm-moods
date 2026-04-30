import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const results: any = { reclassify_batches: [], reaggregate: null };

  try {
    // Step 1: reclassify recent posts in pages of 500
    let offset = 0;
    const maxIterations = 20;
    let iter = 0;
    while (iter < maxIterations) {
      iter++;
      const url = `${SUPABASE_URL}/functions/v1/reclassify-posts?mode=recent_targeted&days_back=2&batch_size=500&offset=${offset}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_ROLE}`,
          "apikey": SERVICE_ROLE,
          "Content-Type": "application/json",
        },
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = { raw: text, status: res.status }; }
      results.reclassify_batches.push({ offset, status: res.status, body: json });
      const remaining = json?.remaining_after_batch;
      if (typeof remaining !== "number" || remaining <= 0) break;
      offset += 500;
    }

    // Step 2: reaggregate
    const reaggRes = await fetch(`${SUPABASE_URL}/functions/v1/reaggregate-vibes`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE}`,
        "apikey": SERVICE_ROLE,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ days_back: 30, min_posts: 5, dry_run: false, source: "lovable-republish" }),
    });
    const reaggText = await reaggRes.text();
    try { results.reaggregate = JSON.parse(reaggText); } catch { results.reaggregate = { raw: reaggText, status: reaggRes.status }; }

    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e), partial: results }, null, 2), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});