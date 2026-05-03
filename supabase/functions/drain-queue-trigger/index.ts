console.log("drain-queue-trigger module load");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  console.log("drain-queue-trigger request", req.method);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "missing_env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = { limit: 50 };
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = { ...body, ...parsed };
  } catch {
    // no body or invalid JSON — use defaults
  }

  const upstream = await fetch(`${supabaseUrl}/functions/v1/drain-classification-queue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
