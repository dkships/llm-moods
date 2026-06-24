import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { claimServiceLock, releaseServiceLock } from "../_shared/score-refresh.ts";
import {
  internalOnlyResponse,
  isInternalServiceRequest,
  isRunPipelineTriggerRequest,
  isSchedulerRequest,
  readJsonBody,
} from "../_shared/runtime.ts";
import {
  buildContribution,
  groupByCluster,
  mergeCluster,
  parseRecordRumors,
  type RawClaim,
  type RumorContribution,
  type RumorRow,
  type SourceRef,
} from "../_shared/rumor-rollup.ts";

const SOURCE = "aggregate-rumors";
const LOCK_KEY = "rumor-aggregate";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Tuning. The candidate set is bounded by the leak-lexicon SQL pre-filter; batch
// stays small (~10) because the per-post `claims[]` output is larger than the
// sentiment classifier's one-result-per-post, so a big batch risks max_tokens
// truncation of the array.
const CANDIDATE_LIMIT = 200;
const EXTRACT_BATCH_SIZE = 10;
const EXTRACT_CONCURRENCY = 4;
const EXTRACT_MAX_TOKENS = 8000;
const MAX_REPRESENTATIVE = 4;
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

// Current released flagships — drives the model's `is_unreleased` judgment.
// EPHEMERAL: refresh this alongside the codename `model_keywords` rows each cycle
// (see the residual-risk note in the plan / CLAUDE.md).
const RELEASED_SET =
  "Claude: Opus 4.8, Sonnet 4.6, Haiku 4.5 (Fable 5 / Mythos 5 currently suspended). " +
  "ChatGPT/OpenAI: GPT-5.4 and earlier. Gemini: 3 Pro, 3 Flash, 3.5 Flash. Grok: 4 and earlier. " +
  "Anything newer/higher than these, or an unrecognized codename, is UNRELEASED.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Rumor extraction always uses an Anthropic Claude model (Haiku by default). We
// follow CLASSIFIER_MODEL only when it's a claude-* id so a Gemini rollback of the
// sentiment classifier never accidentally routes rumor extraction to Gemini.
function rumorModel(): string {
  const configured = Deno.env.get("CLASSIFIER_MODEL");
  return configured && configured.toLowerCase().startsWith("claude")
    ? configured
    : "claude-haiku-4-5-20251001";
}

const RECORD_RUMORS_TOOL_NAME = "record_rumors";

const CLAIM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_rumor", "target_family", "is_unreleased", "claim_type", "claim_summary", "confidence"],
  properties: {
    is_rumor: { type: "boolean" },
    target_family: { type: "string", enum: ["claude", "chatgpt", "gemini", "grok", "unknown"] },
    version_label: { type: ["string", "null"] },
    codename: { type: ["string", "null"] },
    is_unreleased: { type: "boolean" },
    claim_type: { type: "string", enum: ["launch", "in_testing", "imminent", "delayed", "return", "other"] },
    claim_summary: { type: "string" },
    rumored_benefit: { type: ["string", "null"] },
    signals: { type: ["string", "null"] },
    eta_text: { type: ["string", "null"] },
    eta_date: { type: ["string", "null"] },
    confidence: { type: "number" },
  },
};

const RECORD_RUMORS_TOOL = {
  name: RECORD_RUMORS_TOOL_NAME,
  description: "Record upcoming-model rumor claims extracted from the posts.",
  // strict tool use is intentionally OFF — the nullable-union fields above 400
  // under the structured-output JSON-Schema subset (same constraint as the
  // sentiment classifier). Forced tool_choice already yields schema-shaped output.
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["posts"],
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "claims"],
          properties: {
            index: { type: "integer" },
            claims: { type: "array", items: CLAIM_SCHEMA },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT =
  "You extract rumor facts about UNRELEASED AI model versions from social posts.\n" +
  `RELEASED SET (already out — NOT rumors): ${RELEASED_SET}\n\n` +
  "For each numbered post, return an entry in `posts` with its `index` and a `claims` array.\n" +
  "A single post may contain MULTIPLE claims about different models/versions — emit one claim per (model, version).\n" +
  "If a post is not about an unreleased model, return its index with an empty claims array.\n\n" +
  "Per claim:\n" +
  "- is_rumor: true only if it references an unreleased version/codename.\n" +
  "- target_family: claude | chatgpt | gemini | grok (use 'unknown' if unclear).\n" +
  "- version_label: copy the version token VERBATIM from the post (e.g. 'Sonnet 5', 'GPT-5.6'). Null if only a codename.\n" +
  "- codename: arena/internal codename if present (e.g. 'Fennec', 'Orionmist'). Null otherwise.\n" +
  "- is_unreleased: judge against the RELEASED SET above.\n" +
  "- claim_type: in_testing (EAP / spotted in API / canary / arena), imminent (next week / any day), " +
  "delayed (pushed back / slipped / no longer this month), return (re-added / brought back / restored), " +
  "launch (a new version is coming), or other.\n" +
  "- claim_summary: one concise sentence on what's claimed.\n" +
  "- rumored_benefit: what it's rumored to improve, if stated (else null). Do not invent benchmark numbers.\n" +
  "- signals: the evidence cited — API slug, codename, app-code/string leak, benchmark leak, staff/exec hint, prediction-market odds (else null).\n" +
  "- eta_text: the raw timeframe phrase if stated or directly implied (e.g. 'next week', 'mid-July', 'Q3'); NEVER invent one — null if absent.\n" +
  "- eta_date: a single best-effort ISO date (YYYY-MM-DD) only if clearly resolvable; else null.\n" +
  "- confidence: 0..1 that this is a genuine rumor signal (down-weight wishful/speculative posts).";

interface CandidateRow {
  id: string;
  source: string;
  source_url: string | null;
  title: string | null;
  content: string | null;
  posted_at: string | null;
  score: number | null;
  author_handle: string | null;
  author_verified: boolean | null;
  author_followers: number | null;
}

interface Candidate {
  row: CandidateRow;
  postText: string;
  source: SourceRef;
}

function retryDelayMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

async function callAnthropic(
  apiKey: string,
  model: string,
  userBlock: string,
): Promise<unknown | null> {
  const body = JSON.stringify({
    model,
    max_tokens: EXTRACT_MAX_TOKENS,
    // No temperature: current Claude models reject it. Forced tool_choice shapes output.
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userBlock }],
    tools: [RECORD_RUMORS_TOOL],
    tool_choice: { type: "tool", name: RECORD_RUMORS_TOOL_NAME },
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (_e) {
      if (attempt === 2) return null;
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      const content = Array.isArray(data?.content) ? data.content : [];
      const toolUse = content.find(
        (b: unknown) =>
          typeof b === "object" && b !== null &&
          (b as { type?: unknown }).type === "tool_use" &&
          typeof (b as { input?: unknown }).input === "object",
      );
      return toolUse ? (toolUse as { input: unknown }).input : null;
    }

    if (!TRANSIENT_STATUSES.has(res.status) || attempt === 2) return null;
    await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
  }
  return null;
}

// Run extraction over batches with bounded concurrency; each batch's claims are
// written into the candidate's positional slot.
async function extractAll(
  candidates: Candidate[],
  apiKey: string,
  model: string,
  logError: (msg: string, ctx: string) => Promise<void>,
): Promise<RawClaim[][]> {
  const batches: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += EXTRACT_BATCH_SIZE) {
    batches.push(candidates.slice(i, i + EXTRACT_BATCH_SIZE));
  }

  const out: RawClaim[][][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const bIdx = next++;
      if (bIdx >= batches.length) return;
      const batch = batches[bIdx];
      const userBlock = batch
        .map((c, i) => `POST ${i} [${c.row.source}, ${c.row.posted_at ?? "unknown date"}]: ${c.postText}`)
        .join("\n\n");
      try {
        const input = await callAnthropic(apiKey, model, userBlock);
        out[bIdx] = input ? parseRecordRumors(input, batch.length) : batch.map(() => []);
      } catch (e) {
        await logError(`extract batch failed: ${e instanceof Error ? e.message : String(e)}`, "extract-batch");
        out[bIdx] = batch.map(() => []);
      }
    }
  };
  const lanes = Math.min(EXTRACT_CONCURRENCY, batches.length);
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return out.flat();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req) &&
    !isRunPipelineTriggerRequest(req) &&
    !isSchedulerRequest(body, SOURCE)
  ) {
    return internalOnlyResponse(corsHeaders);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const logError = async (msg: string, ctx: string) => {
    try {
      await supabase.from("error_log").insert({ function_name: SOURCE, error_message: msg, context: ctx });
    } catch (_e) { /* best-effort */ }
  };

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    await logError("ANTHROPIC_API_KEY missing", "config");
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let lockOwner: string | null = null;
  try {
    const lock = await claimServiceLock(supabase, LOCK_KEY, 300);
    lockOwner = lock.owner;
    if (!lock.claimed) {
      return new Response(JSON.stringify({ status: "skipped", reason: "already_running" }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase 1 — pull distinct-source_url rumor candidates (leak-lexicon SQL gate),
    // extract once per post via Haiku, write rumor_data + mark all sibling rows.
    const { data: rows, error: candErr } = await supabase.rpc("get_rumor_candidates", { p_limit: CANDIDATE_LIMIT });
    if (candErr) throw new Error(`get_rumor_candidates failed: ${candErr.message}`);

    const candidates: Candidate[] = (rows ?? [])
      .filter((r: CandidateRow) => r.source_url)
      .map((r: CandidateRow) => {
        const title = r.title ?? "";
        const content = r.content ?? "";
        return {
          row: r,
          postText: `${title} ${content}`.trim().slice(0, 2000),
          source: {
            url: r.source_url!,
            platform: r.source,
            handle: r.author_handle, // Twitter author; null on platforms without author capture
            verified: r.author_verified,
            followers: r.author_followers,
            snippet: (title || content).slice(0, 280),
            posted_at: r.posted_at,
            score: r.score,
          },
        };
      });

    const contributions: RumorContribution[] = [];
    let checkedPosts = 0;

    if (candidates.length > 0) {
      const claimsByCandidate = await extractAll(candidates, apiKey, rumorModel(), logError);
      const nowIso = new Date().toISOString();

      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        const claims = claimsByCandidate[i] ?? [];

        // Mark every row sharing this source_url as checked (the scraper inserts
        // one row per matched model), storing the raw claims for audit.
        const { error: updErr } = await supabase
          .from("scraped_posts")
          .update({ rumor_checked_at: nowIso, rumor_data: claims })
          .eq("source_url", cand.row.source_url)
          .is("rumor_checked_at", null);
        if (updErr) await logError(`mark checked failed (${cand.row.source_url}): ${updErr.message}`, "mark-checked");
        else checkedPosts++;

        for (const raw of claims) {
          const contribution = buildContribution(raw as RawClaim, cand.source, cand.postText);
          if (contribution) contributions.push(contribution);
        }
      }
    }

    // Phase 2 — incremental accumulator upsert into model_rumors (one row per cluster).
    const clusters = groupByCluster(contributions);
    let upserts = 0;
    for (const group of clusters.values()) {
      const modelSlug = group[0].modelSlug;
      const versionKey = group[0].versionKey;

      const { data: existingRows, error: readErr } = await supabase
        .from("model_rumors")
        .select("*")
        .eq("model_slug", modelSlug)
        .eq("version_key", versionKey)
        .limit(1);
      if (readErr) {
        await logError(`read cluster failed (${modelSlug}/${versionKey}): ${readErr.message}`, "read-cluster");
        continue;
      }

      const existing = (existingRows?.[0] as RumorRow | undefined) ?? null;
      const merged = mergeCluster(existing, group, MAX_REPRESENTATIVE);

      const { error: upErr } = await supabase
        .from("model_rumors")
        .upsert({ ...merged, updated_at: new Date().toISOString() }, { onConflict: "model_slug,version_key" });
      if (upErr) await logError(`upsert cluster failed (${modelSlug}/${versionKey}): ${upErr.message}`, "upsert-cluster");
      else upserts++;
    }

    const summary = {
      status: "complete",
      candidates: candidates.length,
      checked_posts: checkedPosts,
      contributions: contributions.length,
      clusters_upserted: upserts,
    };
    await supabase.from("error_log").insert({
      function_name: SOURCE,
      error_message: `Rumor aggregate complete: candidates=${candidates.length} contributions=${contributions.length} clusters=${upserts}`,
      context: JSON.stringify(summary),
    });

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown";
    await logError(message, "top-level error");
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (lockOwner) {
      try {
        await releaseServiceLock(supabase, LOCK_KEY, lockOwner);
      } catch (e) {
        console.error("Failed to release rumor lock", e);
      }
    }
  }
});
