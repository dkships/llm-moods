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
  collapseQuoteEchoes,
  groupByCluster,
  mergeCluster,
  parseRecordRumors,
  recoverDeterministicClaims,
  referencedStatusIdFromText,
  type RawClaim,
  type RumorContribution,
  type RumorRow,
  type SourceRef,
} from "../_shared/rumor-rollup.ts";
import {
  canonicalVersionKey,
  isReleasedVersion,
  versionKeysFromReleaseText,
} from "../_shared/rumor-canon.ts";
import { deriveReleasedTokens, openAiReleasedTokensFromRss } from "../_shared/released-models.ts";
import { isCredibleReleaseSource, isReleaseAnnouncement } from "../_shared/release-detect.ts";
import { readToolInput } from "../_shared/claude-request.ts";
import {
  RECORD_RUMORS_TOOL_NAME,
  RUMOR_DEFAULT_MODEL,
  rumorRequestBody,
} from "../_shared/rumor-extract.ts";

// Bump CODE_VERSION whenever this file or the rumor-canon catalog it bundles
// changes — Lovable deploys can silently ship stale code, and this field in
// the run summary (response body + error_log context) is the only external
// deploy check.
const CODE_VERSION = "2026-10-07.1";
const SOURCE = "aggregate-rumors";
const LOCK_KEY = "rumor-aggregate";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_NEWS_RSS_URL = "https://openai.com/news/rss.xml";

// Tuning. The candidate set is bounded by the leak-lexicon SQL pre-filter; batch
// stays small (~10) because the per-post `claims[]` output is larger than the
// sentiment classifier's one-result-per-post, so a big batch risks max_tokens
// truncation of the array (the token cap lives in _shared/rumor-extract.ts).
const CANDIDATE_LIMIT = 200;
const EXTRACT_BATCH_SIZE = 10;
const EXTRACT_CONCURRENCY = 4;
// A hung Anthropic request must not eat the edge function's 400 s budget.
const EXTRACT_TIMEOUT_MS = 60_000;
const MAX_REPRESENTATIVE = 12;
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

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
    : RUMOR_DEFAULT_MODEL;
}

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
  quoted_status_id: string | null;
}

interface Candidate {
  row: CandidateRow;
  postText: string;
  source: SourceRef;
}

function retryDelayMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

// A failed call is reported distinctly from "the model found no rumors" so the
// caller can leave the batch unchecked and retry it next run.
type ExtractCall = { input: unknown } | { failure: string };

async function callAnthropic(
  apiKey: string,
  model: string,
  userBlock: string,
): Promise<ExtractCall> {
  const body = JSON.stringify(rumorRequestBody(model, userBlock));

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
        signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt === 2) {
        return { failure: `request failed: ${e instanceof Error ? e.message : String(e)}` };
      }
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
      continue;
    }

    if (res.ok) {
      const read = readToolInput(await res.json(), RECORD_RUMORS_TOOL_NAME);
      // tool_choice auto does not guarantee the call; ask again. A refusal or
      // truncation is reported so the batch stays unchecked for the next run.
      if ("failure" in read && read.kind === "no_tool_call" && attempt < 2) {
        continue;
      }
      return "input" in read ? { input: read.input } : { failure: read.failure };
    }

    if (!TRANSIENT_STATUSES.has(res.status) || attempt === 2) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { failure: `Anthropic ${res.status}: ${detail}` };
    }
    await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
  }
  return { failure: "retries exhausted" };
}

// Run extraction over batches with bounded concurrency; each batch's claims are
// written into the candidate's positional slot. A failed batch yields null for
// each of its candidates (distinct from [] = no rumors found).
async function extractAll(
  candidates: Candidate[],
  apiKey: string,
  model: string,
  logError: (msg: string, ctx: string) => Promise<void>,
): Promise<(RawClaim[] | null)[]> {
  const batches: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += EXTRACT_BATCH_SIZE) {
    batches.push(candidates.slice(i, i + EXTRACT_BATCH_SIZE));
  }

  const out: (RawClaim[] | null)[][] = new Array(batches.length);
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
        const call = await callAnthropic(apiKey, model, userBlock);
        if ("failure" in call) {
          await logError(`extract batch failed: ${call.failure}`, "extract-batch");
          out[bIdx] = batch.map(() => null);
          continue;
        }
        out[bIdx] = parseRecordRumors(call.input, batch.length);
      } catch (e) {
        await logError(`extract batch failed: ${e instanceof Error ? e.message : String(e)}`, "extract-batch");
        out[bIdx] = batch.map(() => null);
      }
    }
  };
  const lanes = Math.min(EXTRACT_CONCURRENCY, batches.length);
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return out.flat();
}

// Released-model auto-detection (API layer). Best-effort — a failed fetch never
// breaks the rumor run; it just skips that family's auto-retire this cycle.
async function fetchAnthropicModelIds(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data?.data) ? data.data : [])
      .map((m: { id?: unknown }) => (typeof m?.id === "string" ? m.id : null))
      .filter((x: string | null): x is string => x !== null);
  } catch {
    return [];
  }
}

async function fetchGeminiModelIds(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${apiKey}`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data?.models) ? data.models : [])
      .map((m: { name?: unknown }) => (typeof m?.name === "string" ? m.name : null))
      .filter((x: string | null): x is string => x !== null);
  } catch {
    return [];
  }
}

// OpenAI has no API key in this project, but its official news RSS is public and
// includes Product launch items. Parsing is conservative: only explicit GA
// wording contributes tokens, so a limited preview cannot retire a rumor.
async function fetchOpenAiReleaseRss(): Promise<string> {
  try {
    const res = await fetch(OPENAI_NEWS_RSS_URL, {
      headers: { "User-Agent": "LLMVibes-RumorRadar/1.0" },
    });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req) &&
    !isRunPipelineTriggerRequest(req) &&
    !await isSchedulerRequest(body, SOURCE)
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
        const postText = `${title} ${content}`.trim().slice(0, 2000);
        const quotedStatusId = r.quoted_status_id ?? referencedStatusIdFromText(postText, r.source_url);
        return {
          row: r,
          postText,
          source: {
            url: r.source_url!,
            platform: r.source,
            handle: r.author_handle, // Twitter author; null on platforms without author capture
            verified: r.author_verified,
            followers: r.author_followers,
            quotedStatusId,
            snippet: (title || content).slice(0, 280),
            posted_at: r.posted_at,
            score: r.score,
          },
        };
      });

    const contributions: RumorContribution[] = [];
    let checkedPosts = 0;
    let failedCandidates = 0;

    // Released-model auto-detection. API layer (authoritative for Claude + Gemini):
    // the Models APIs only list shipped ids, so a match can't be a false positive.
    const releasedTokens = new Set<string>();
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const [anthropicIds, geminiIds, openAiRss] = await Promise.all([
      fetchAnthropicModelIds(apiKey),
      geminiKey ? fetchGeminiModelIds(geminiKey) : Promise.resolve([]),
      fetchOpenAiReleaseRss(),
    ]);
    const apiTokens = deriveReleasedTokens(anthropicIds, geminiIds);
    for (const token of apiTokens) releasedTokens.add(token);
    const officialFeedTokens = openAiReleasedTokensFromRss(openAiRss);
    for (const token of officialFeedTokens) releasedTokens.add(token);
    const apiTokenCount = apiTokens.length;

    if (candidates.length > 0) {
      const claimsByCandidate = await extractAll(candidates, apiKey, rumorModel(), logError);
      const nowIso = new Date().toISOString();

      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        const claims = claimsByCandidate[i];

        // Extraction failed for this post's batch: leave rumor_checked_at null
        // so the next hourly run retries it instead of burning the candidate.
        if (claims === null) {
          failedCandidates++;
          continue;
        }

        const recoveredClaims = recoverDeterministicClaims(cand.source, cand.postText);
        const auditClaims = [...(claims ?? []), ...recoveredClaims];

        // Social layer: a GA announcement from a credible source retires whatever
        // version(s) it names — the backstop for ChatGPT/Grok (no Models API key)
        // and codename launches. Conservative gate; a limited/EAP release doesn't
        // count (isReleaseAnnouncement excludes it) so it stays on the board.
        if (
          isReleaseAnnouncement(cand.row.title, cand.row.content) &&
          isCredibleReleaseSource(cand.source)
        ) {
          // Extract the identity from the announcement text itself. Released
          // posts correctly produce no rumor claims, so auditClaims is often
          // empty and cannot be the source of the release token.
          for (const key of versionKeysFromReleaseText(cand.postText)) {
            releasedTokens.add(key);
          }
        }

        // Mark every row sharing this source_url as checked (the scraper inserts
        // one row per matched model), storing the raw claims for audit.
        const { error: updErr } = await supabase
          .from("scraped_posts")
          .update({ rumor_checked_at: nowIso, rumor_data: auditClaims })
          .eq("source_url", cand.row.source_url)
          .is("rumor_checked_at", null);
        if (updErr) await logError(`mark checked failed (${cand.row.source_url}): ${updErr.message}`, "mark-checked");
        else checkedPosts++;

        const seenContributionKeys = new Set<string>();
        for (const raw of auditClaims) {
          const contribution = buildContribution(raw as RawClaim, cand.source, cand.postText);
          if (!contribution) continue;
          const contributionKey = `${contribution.modelSlug}:${contribution.versionKey}:${contribution.source.url}`;
          if (seenContributionKeys.has(contributionKey)) continue;
          seenContributionKeys.add(contributionKey);
          contributions.push(contribution);
        }
      }
    }

    // Phase 2 — incremental accumulator upsert into model_rumors (one row per
    // product). Existing rows teach the run identity links discovered earlier,
    // so a codename-only claim joins a linked numbered-version cluster.
    const { data: identityRows, error: identityErr } = await supabase
      .from("model_rumors")
      .select("model_slug, version_key, version_label, codename")
      .eq("is_released", false);
    if (identityErr) {
      await logError(`identity bridge fetch failed: ${identityErr.message}`, "identity-bridge");
    }
    const clusters = groupByCluster(contributions, identityRows ?? []);
    let upserts = 0;
    for (const rawGroup of clusters.values()) {
      // Drop quote-tweet echoes so they can't self-corroborate a single leak.
      const group = collapseQuoteEchoes(rawGroup);
      if (group.length === 0) continue;
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

    // Retire launched versions. Match on CANONICAL identity (not raw version_key)
    // so legacy compound-key rows are caught too — e.g. a row stored under
    // "mythosfable5" whose label "Mythos/Fable 5" canonicalizes to fable5. A row
    // is released if its canonical key (or raw key) is a token detected this run
    // (API/social) OR its label/codename is in the static FAMILY_ALIASES released
    // set (isReleasedVersion — the same check the frontend display uses). The
    // model_rumors accumulator is small (frontier-only, 21-day decay), so scanning
    // the open rows each run is cheap.
    let releasedFlagged = 0;
    const releasedList = [...releasedTokens];
    const dynamicTokens = new Set(releasedList);
    const { data: openRows, error: fetchErr } = await supabase
      .from("model_rumors")
      .select("id, model_slug, version_key, version_label, codename")
      .eq("is_released", false);
    if (fetchErr) {
      await logError(`release-flag fetch failed: ${fetchErr.message}`, "release-flag");
    } else {
      const toFlag: string[] = [];
      for (const r of openRows ?? []) {
        const canon = canonicalVersionKey(r.model_slug, r.version_label, r.codename);
        const byDynamic =
          (canon.key != null && dynamicTokens.has(canon.key)) || dynamicTokens.has(r.version_key);
        if (byDynamic || isReleasedVersion(r.model_slug, r.version_label, r.codename)) {
          toFlag.push(r.id);
        }
      }
      if (toFlag.length > 0) {
        const { error: relErr } = await supabase
          .from("model_rumors")
          .update({ is_released: true, updated_at: new Date().toISOString() })
          .in("id", toFlag);
        if (relErr) await logError(`release-flag update failed: ${relErr.message}`, "release-flag");
        else releasedFlagged = toFlag.length;
      }
    }

    const summary = {
      status: "complete",
      code_version: CODE_VERSION,
      candidates: candidates.length,
      checked_posts: checkedPosts,
      failed_candidates: failedCandidates,
      contributions: contributions.length,
      clusters_upserted: upserts,
      released_tokens: releasedList.length,
      released_from_api: apiTokenCount,
      released_from_openai_feed: officialFeedTokens.length,
      released_rows_flagged: releasedFlagged,
    };
    await supabase.from("error_log").insert({
      function_name: SOURCE,
      error_message: `Rumor aggregate complete: candidates=${candidates.length} failed=${failedCandidates} contributions=${contributions.length} clusters=${upserts}`,
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
