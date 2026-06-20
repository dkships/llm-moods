// EPHEMERAL HELPER — delete from the deployed function list after the Reddit
// actor bake-off. Lets us smoke-test arbitrary Apify actors using the
// server-side APIFY_API_TOKEN (never leaves the runtime). Intentionally ungated
// so it can be driven via curl with different actor+input per call — which is
// exactly why it MUST be deleted after use (it spends Apify credit).
//
// Body: {actor, input, maxItems?, maxTotalChargeUsd?, pollSecs?, label?}
//   actor: "owner/name" or "owner~name"
// Returns yield/reliability/cost/shape diagnostics so actors can be compared
// without re-running.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function truncateItem(item: unknown): unknown {
  if (item === null || typeof item !== "object") return item;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v.length > 300 ? `${v.slice(0, 300)}…[${v.length}]` : v;
    else if (Array.isArray(v)) out[k] = `[array:${v.length}]`;
    else if (v && typeof v === "object") out[k] = `{obj:${Object.keys(v).length} keys}`;
    else out[k] = v;
  }
  return out;
}

function fieldOf(item: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const token = Deno.env.get("APIFY_API_TOKEN");
  if (!token) return json({ error: "missing APIFY_API_TOKEN" }, 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const actorRaw = String(body.actor ?? "");
  if (!actorRaw) return json({ error: "missing 'actor'" }, 400);
  const actorId = actorRaw.replace("/", "~");
  const input = (body.input ?? {}) as Record<string, unknown>;
  const maxItems = Number(body.maxItems ?? 60);
  const maxTotalChargeUsd = Number(body.maxTotalChargeUsd ?? 0.2);
  const pollSecs = Math.min(Number(body.pollSecs ?? 150), 270);
  const label = String(body.label ?? actorRaw);
  const startedAt = Date.now();

  // Start run
  const runParams = new URLSearchParams({
    token,
    maxItems: String(Math.max(1, maxItems)),
    timeout: String(Math.max(30, pollSecs)),
    maxTotalChargeUsd: String(Math.max(0.01, maxTotalChargeUsd)),
  });
  const startRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?${runParams}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!startRes.ok) {
    const text = await startRes.text().catch(() => "");
    return json({ label, actor: actorRaw, error: `start HTTP ${startRes.status}`, detail: text.slice(0, 400) }, 200);
  }
  const startData = await startRes.json();
  const runId = startData?.data?.id;
  const datasetId = startData?.data?.defaultDatasetId;
  if (!runId || !datasetId) return json({ label, actor: actorRaw, error: "no runId/datasetId" }, 200);

  // Poll to terminal
  let status = "";
  let usageTotalUsd: number | null = null;
  let statusMessage: string | null = null;
  const deadline = Date.now() + pollSecs * 1000;
  while (Date.now() < deadline) {
    await sleep(Math.min(8000, Math.max(1000, deadline - Date.now())));
    const sRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    if (!sRes.ok) continue;
    const sData = await sRes.json();
    status = sData?.data?.status ?? "";
    usageTotalUsd = sData?.data?.usageTotalUsd ?? usageTotalUsd;
    statusMessage = sData?.data?.statusMessage ?? statusMessage;
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) break;
  }
  if (status && !["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    await fetch(`https://api.apify.com/v2/actor-runs/${runId}/abort?token=${token}`, { method: "POST" }).catch(() => {});
    status = status || "TIMED-OUT";
  }

  // Fetch dataset
  const dRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&format=json&limit=400`);
  const items: unknown[] = dRes.ok ? await dRes.json().catch(() => []) : [];
  const arr = Array.isArray(items) ? items : [];

  // Diagnostics
  const typeHist: Record<string, number> = {};
  const subs: Record<string, number> = {};
  let withBody = 0;
  let withComments = 0;
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const t = String(o.dataType ?? o.type ?? "unknown");
    typeHist[t] = (typeHist[t] ?? 0) + 1;
    const sub = fieldOf(o, ["communityName", "subreddit", "community", "parsedCommunityName", "subredditName"]);
    if (sub) subs[sub] = (subs[sub] ?? 0) + 1;
    if (fieldOf(o, ["body", "comment", "text", "selftext"])) withBody++;
    if (Array.isArray(o.comments) && o.comments.length > 0) withComments++;
  }

  return json({
    label,
    actor: actorRaw,
    status,
    statusMessage,
    durationMs: Date.now() - startedAt,
    usageTotalUsd,
    itemCount: arr.length,
    typeHist,
    distinctSubreddits: subs,
    itemsWithBodyText: withBody,
    itemsWithNestedComments: withComments,
    sampleKeys: arr.length ? Object.keys(arr[0] as Record<string, unknown>) : [],
    sample: arr.slice(0, 3).map(truncateItem),
  });
});
