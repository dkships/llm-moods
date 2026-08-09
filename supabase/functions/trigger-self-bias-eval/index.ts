// TEMPORARY helper: forwards a service-role POST to check-gemini-self-bias.
// Delete after the eval report has been read.
Deno.serve(async () => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${url}/functions/v1/check-gemini-self-bias`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      candidates: ["gpt-5.6-luna", "gpt-5.6-luna@low", "gpt-5.6-terra"],
      oracle: "gemini-3-flash-preview",
      sample_size: 300,
      eval_minute_limit: 10,
      eval_daily_limit: 200,
    }),
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});