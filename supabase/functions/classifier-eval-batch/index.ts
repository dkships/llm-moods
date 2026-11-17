import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyBatchTargeted, type ClassifyResult, type UsageSample } from "../_shared/classifier.ts";
import { modelMentionText, targetModelLabel, type PendingModelMentionRow } from "../_shared/classification-state.ts";
import {
  internalOnlyResponse,
  isInternalServiceRequest,
  isRunPipelineTriggerRequest,
  isSchedulerRequest,
  readJsonBody,
} from "../_shared/runtime.ts";
import { corsHeaders } from "../_shared/utils.ts";

// Standing classifier eval over the provider Batch APIs (50% of standard price).
// Runs where the OpenAI / Anthropic keys already live, so an eval never needs a
// key outside Supabase. Never writes to scraped_posts or scores.
//
//   submit  → loads posts by id, runs production classifyBatchTargeted with
//             fetch intercepted to capture each request body, submits one batch
//             per arm, returns the batch ids.
//   collect → for finished batches, replays production classifyBatchTargeted
//             with fetch answered from the batch output, so parsing and
//             alignment are exactly production's. Returns labels + usage.
//
//   cache_probe → sends one production request (first BATCH_SIZE posts)
//             `repeats` times per variant, synchronously, and reports
//             cached_tokens. Variants may only set CACHE_PROBE_KEYS.
//
//   caller ──pg_net──▶ submit ──▶ OpenAI / Anthropic batch
//   caller ──pg_net──▶ collect ◀── batch output ──▶ replay ──▶ labels
//
// Invoke from SQL so the scheduler token never leaves the database:
//   select net.http_post(url, jsonb_build_object('scheduler','pg_cron',
//     'pipeline','classifier-eval', 'token',(select token from scheduler_tokens where id=1),
//     'action','submit', ...));
// then read the reply from net._http_response.

const CODE_VERSION = "2026-11-17.2";
const BATCH_SIZE = 20; // drain DEFAULT_BATCH_SIZE
const MAX_POSTS = 500;
const MAX_ARMS = 8;
const ALLOWED_MODEL = /^(gpt-|claude-)[a-z0-9.-]+$/;
const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high"]);
const UUID = /^[0-9a-f-]{36}$/i;
const ARM_ID = /^[a-z0-9-]{1,40}$/;
const OPENAI = "https://api.openai.com/v1";
const ANTHROPIC = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const CACHE_PROBE_KEYS = new Set(["service_tier", "prompt_cache_key", "prompt_cache_options", "prompt_cache_retention"]);
const MAX_PROBE_VARIANTS = 6;
const MAX_PROBE_REPEATS = 4;

type Effort = "none" | "low" | "medium" | "high";
type Provider = "openai" | "anthropic";
interface Arm { id: string; model: string; effort: Effort }
interface StoredReply { status: number; body: unknown }

const realFetch = globalThis.fetch.bind(globalThis);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function providerOf(model: string): Provider {
  return model.startsWith("claude") ? "anthropic" : "openai";
}

function parseArms(raw: unknown): Arm[] | string {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ARMS) { return `arms: 1-${MAX_ARMS} required`; }
  const arms: Arm[] = [];
  for (const a of raw) {
    if (!ARM_ID.test(String(a?.id)) || !ALLOWED_MODEL.test(String(a?.model)) || !ALLOWED_EFFORTS.has(String(a?.effort))) {
      return `bad arm ${JSON.stringify(a)}`;
    }
    arms.push({ id: a.id, model: a.model, effort: a.effort });
  }
  return arms;
}

function parsePostIds(raw: unknown): string[] | string {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_POSTS) { return `post_ids: 1-${MAX_POSTS} required`; }
  if (!raw.every((id) => typeof id === "string" && UUID.test(id))) { return "post_ids must be uuids"; }
  return raw as string[];
}

async function loadItems(ids: string[]) {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase
    .from("scraped_posts")
    .select("id, model_id, title, content, source_url, classification_attempts, models(name, slug)")
    .in("id", ids);
  if (error) { throw new Error(`load posts: ${error.message}`); }
  const byId = new Map((data as PendingModelMentionRow[]).map((r) => [r.id, r]));

  // Keep caller order so labels line up with post_ids.
  const rows = ids.map((id) => byId.get(id)).filter((r): r is PendingModelMentionRow => !!r && modelMentionText(r).length > 0);
  return { rows, items: rows.map((r) => ({ text: modelMentionText(r), targetModel: targetModelLabel(r) })) };
}

// The request body minus transport-only fields, so capture and replay hash alike.
function normalizedBody(raw: unknown): Record<string, unknown> {
  const body = JSON.parse(String(raw));
  delete body.service_tier;
  return body;
}

async function customId(arm: Arm, body: Record<string, unknown>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(JSON.stringify(body)));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${arm.id}__${hex.slice(0, 20)}`;
}

// Runs production classification with every outbound call answered by `answer`.
async function runProduction(
  arm: Arm,
  items: { text: string; targetModel: string }[],
  answer: (body: Record<string, unknown>) => Promise<Response>,
) {
  const usage: UsageSample[] = [];
  globalThis.fetch = ((_url: string, init: RequestInit) => answer(normalizedBody(init.body))) as typeof fetch;
  try {
    const results = await classifyBatchTargeted(items, "eval", BATCH_SIZE, async () => {}, {
      model: arm.model,
      reasoningEffort: arm.effort,
      serviceTier: "default",
      onUsage: (s) => { usage.push(s); },
    });
    return { results, usage };
  } finally {
    globalThis.fetch = realFetch;
  }
}

function apiKey(provider: Provider): string {
  const key = Deno.env.get(provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY");
  if (!key) { throw new Error(`${provider} key missing`); }
  return key;
}

function anthropicHeaders(): HeadersInit {
  return { "x-api-key": apiKey("anthropic"), "anthropic-version": ANTHROPIC_VERSION, "Content-Type": "application/json" };
}

async function submitOpenAi(arm: Arm, requests: [string, Record<string, unknown>][]): Promise<string> {
  const lines = requests.map(([custom_id, body]) => JSON.stringify({ custom_id, method: "POST", url: "/v1/chat/completions", body }));
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new Blob([lines.join("\n") + "\n"]), `${arm.id}.jsonl`);
  const auth = { Authorization: `Bearer ${apiKey("openai")}` };

  const upload = await (await realFetch(`${OPENAI}/files`, { method: "POST", headers: auth, body: form })).json();
  if (!upload.id) { throw new Error(`openai upload ${arm.id}: ${JSON.stringify(upload).slice(0, 300)}`); }

  const batch = await (await realFetch(`${OPENAI}/batches`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ input_file_id: upload.id, endpoint: "/v1/chat/completions", completion_window: "24h" }),
  })).json();
  if (!batch.id) { throw new Error(`openai batch ${arm.id}: ${JSON.stringify(batch).slice(0, 300)}`); }
  return batch.id;
}

async function submitAnthropic(arm: Arm, requests: [string, Record<string, unknown>][]): Promise<string> {
  const batch = await (await realFetch(`${ANTHROPIC}/messages/batches`, {
    method: "POST",
    headers: anthropicHeaders(),
    body: JSON.stringify({ requests: requests.map(([custom_id, params]) => ({ custom_id, params })) }),
  })).json();
  if (!batch.id) { throw new Error(`anthropic batch ${arm.id}: ${JSON.stringify(batch).slice(0, 300)}`); }
  return batch.id;
}

async function submit(arms: Arm[], items: { text: string; targetModel: string }[]) {
  const batches: Record<string, { provider: Provider; batch_id: string; requests: number }> = {};
  for (const arm of arms) {
    const captured = new Map<string, Record<string, unknown>>();
    await runProduction(arm, items, async (body) => {
      captured.set(await customId(arm, body), body);
      return new Response(JSON.stringify({ error: { message: "capture" } }), { status: 400 });
    });

    const provider = providerOf(arm.model);
    const requests = [...captured];
    const batchId = provider === "openai" ? await submitOpenAi(arm, requests) : await submitAnthropic(arm, requests);
    batches[arm.id] = { provider, batch_id: batchId, requests: requests.length };
  }
  return batches;
}

// Returns null while the batch is still running.
async function downloadOpenAi(batchId: string): Promise<{ state: string; replies: Record<string, StoredReply> | null }> {
  const auth = { Authorization: `Bearer ${apiKey("openai")}` };
  const batch = await (await realFetch(`${OPENAI}/batches/${batchId}`, { headers: auth })).json();
  if (batch.status !== "completed") { return { state: `${batch.status} ${JSON.stringify(batch.request_counts ?? {})}`, replies: null }; }

  const replies: Record<string, StoredReply> = {};
  for (const fileId of [batch.output_file_id, batch.error_file_id].filter(Boolean)) {
    const text = await (await realFetch(`${OPENAI}/files/${fileId}/content`, { headers: auth })).text();
    for (const line of text.split("\n").filter(Boolean)) {
      const r = JSON.parse(line);
      replies[r.custom_id] = { status: r.response?.status_code ?? 500, body: r.response?.body ?? r.error };
    }
  }
  return { state: "completed", replies };
}

async function downloadAnthropic(batchId: string): Promise<{ state: string; replies: Record<string, StoredReply> | null }> {
  const batch = await (await realFetch(`${ANTHROPIC}/messages/batches/${batchId}`, { headers: anthropicHeaders() })).json();
  if (batch.processing_status !== "ended") {
    return { state: `${batch.processing_status} ${JSON.stringify(batch.request_counts ?? {})}`, replies: null };
  }

  const replies: Record<string, StoredReply> = {};
  const text = await (await realFetch(batch.results_url, { headers: anthropicHeaders() })).text();
  for (const line of text.split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    replies[r.custom_id] = r.result?.type === "succeeded" ? { status: 200, body: r.result.message } : { status: 500, body: r.result };
  }
  return { state: "completed", replies };
}

function label(r: ClassifyResult | undefined) {
  if (!r) { return { failed: true }; }
  const ok = r.status === undefined || r.status === "classified" || r.status === "irrelevant";
  return {
    failed: !ok,
    relevant: r.relevant,
    sentiment: r.sentiment,
    complaint: r.complaint_category,
    praise: r.praise_category,
    error: ok ? undefined : (r.error ?? r.status ?? null)?.toString().slice(0, 160),
  };
}

async function collect(arms: Arm[], ids: string[], rows: PendingModelMentionRow[], items: { text: string; targetModel: string }[], batchIds: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const arm of arms) {
    const batchId = batchIds[arm.id];
    if (!batchId) { out[arm.id] = { state: "no batch id" }; continue; }

    const download = providerOf(arm.model) === "openai" ? await downloadOpenAi(batchId) : await downloadAnthropic(batchId);
    if (!download.replies) { out[arm.id] = { state: download.state }; continue; }

    const replies = download.replies;
    let misses = 0;
    const { results, usage } = await runProduction(arm, items, async (body) => {
      const hit = replies[await customId(arm, body)];
      if (!hit) {
        // A singleton retry after a count mismatch was never in the batch.
        misses++;
        return new Response(JSON.stringify({ error: { message: "not in batch" } }), { status: 400 });
      }
      return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { "Content-Type": "application/json" } });
    });

    out[arm.id] = {
      state: "completed",
      misses,
      usage: usage.map((u) => ({ in: u.promptTokens, cached: u.cacheReadTokens ?? 0, out: u.completionTokens })),
      labels: rows.map((r, i) => ({ id: r.id, ...label(results[i]) })),
    };
  }
  return { missing_posts: ids.length - rows.length, arms: out };
}

function parseVariants(raw: unknown): Record<string, unknown>[] | string {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PROBE_VARIANTS) { return `variants: 1-${MAX_PROBE_VARIANTS} required`; }
  for (const v of raw) {
    if (!v || typeof v !== "object" || Object.keys(v).some((k) => !CACHE_PROBE_KEYS.has(k))) {
      return `variant keys must be in ${[...CACHE_PROBE_KEYS].join(", ")}`;
    }
  }
  return raw as Record<string, unknown>[];
}

async function cacheProbe(arm: Arm, items: { text: string; targetModel: string }[], variants: Record<string, unknown>[], repeats: number) {
  // Capture the first production request body, then replay it per variant.
  let body: Record<string, unknown> | null = null;
  await runProduction(arm, items.slice(0, BATCH_SIZE), async (b) => {
    body ??= b;
    return new Response(JSON.stringify({ error: { message: "capture" } }), { status: 400 });
  });
  if (!body) { throw new Error("no request captured"); }

  const calls: unknown[] = [];
  for (const [variant, extra] of variants.entries()) {
    for (let r = 0; r < repeats; r++) {
      const started = Date.now();
      const res = await realFetch(`${OPENAI}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey("openai")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...(body as Record<string, unknown>), ...extra }),
      });
      const data = await res.json().catch(() => null);
      calls.push({
        variant,
        repeat: r,
        status: res.status,
        tier: data?.service_tier ?? null,
        prompt: data?.usage?.prompt_tokens ?? null,
        cached: data?.usage?.prompt_tokens_details?.cached_tokens ?? null,
        completion: data?.usage?.completion_tokens ?? null,
        ms: Date.now() - started,
        error: res.ok ? undefined : JSON.stringify(data?.error ?? data).slice(0, 200),
      });
    }
  }
  return calls;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") { return new Response(null, { headers: corsHeaders }); }

  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req)
    && !isRunPipelineTriggerRequest(req)
    && !await isSchedulerRequest(body, "classifier-eval")
  ) {
    return internalOnlyResponse(corsHeaders);
  }

  const arms = parseArms(body?.arms);
  if (typeof arms === "string") { return json({ code_version: CODE_VERSION, error: arms }, 400); }
  const ids = parsePostIds(body?.post_ids);
  if (typeof ids === "string") { return json({ code_version: CODE_VERSION, error: ids }, 400); }

  try {
    const { rows, items } = await loadItems(ids);
    if (body?.action === "submit") {
      return json({ code_version: CODE_VERSION, posts: rows.length, batches: await submit(arms, items) });
    }
    if (body?.action === "cache_probe") {
      const variants = parseVariants(body?.variants);
      if (typeof variants === "string") { return json({ code_version: CODE_VERSION, error: variants }, 400); }
      if (providerOf(arms[0].model) !== "openai") { return json({ code_version: CODE_VERSION, error: "cache_probe is OpenAI only" }, 400); }
      const repeats = Math.max(1, Math.min(Number(body?.repeats) || 3, MAX_PROBE_REPEATS));
      return json({ code_version: CODE_VERSION, calls: await cacheProbe(arms[0], items, variants, repeats) });
    }
    if (body?.action === "collect") {
      return json({ code_version: CODE_VERSION, posts: rows.length, ...await collect(arms, ids, rows, items, body?.batch_ids ?? {}) });
    }
    return json({ code_version: CODE_VERSION, error: "action must be submit, collect or cache_probe" }, 400);
  } catch (e) {
    return json({ code_version: CODE_VERSION, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
