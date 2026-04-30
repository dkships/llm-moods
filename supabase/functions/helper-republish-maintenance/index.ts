import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const url = new URL(req.url);
  const step = url.searchParams.get("step") || "reclassify";
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const batchSize = parseInt(url.searchParams.get("batch_size") || "500", 10);
  const daysBack = parseInt(url.searchParams.get("days_back") || "2", 10);

  try {
    if (step === "reclassify") {
      const target = `${SUPABASE_URL}/functions/v1/reclassify-posts?mode=recent_targeted&days_back=${daysBack}&batch_size=${batchSize}&offset=${offset}`;
      const res = await fetch(target, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_ROLE}`,
          "apikey": SERVICE_ROLE,
          "Content-Type": "application/json",
        },
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return new Response(JSON.stringify({ step: "reclassify", offset, status: res.status, body: json }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (step === "reaggregate") {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/reaggregate-vibes`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_ROLE}`,
          "apikey": SERVICE_ROLE,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ days_back: 30, min_posts: 5, dry_run: false, source: "lovable-republish" }),
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return new Response(JSON.stringify({ step: "reaggregate", status: res.status, body: json }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown step" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }, null, 2), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});