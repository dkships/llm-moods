import {
  classifyBatchTargeted,
  isClassifierFailure,
  providerForModel,
  resolveClassifierModel,
  type ClassifyResult,
} from "./classifier.ts";

type DenoGlobal = typeof globalThis & {
  Deno?: { env: { get(name: string): string | undefined } };
};

const CLASSIFIER_VERSION_DATE = "2026-06-01";

// Provenance tag stored on each row. Derived from the active model so it tracks
// the Gemini→Claude cutover automatically — setting CLASSIFIER_MODEL flips both
// the model and this tag. Nothing reads it for scoring; it's an audit trail that
// locates the model boundary in the data.
export function currentClassifierVersion(model?: string): string {
  return `targeted-${model ?? resolveClassifierModel()}-${CLASSIFIER_VERSION_DATE}`;
}

// Back-compat export; equals the env-resolved version at module load.
export const CURRENT_CLASSIFIER_VERSION = currentClassifierVersion();

// Free-tier Gemini spillover: when Claude is the active classifier, posts that
// hit a transient classifier_error are retried through Gemini so a Claude blip
// doesn't stall the queue. Uses GEMINI_FREE_API_KEY if set, else GEMINI_API_KEY
// (intended to be a free-tier, non-billing key once production runs on Claude).
// Paced to free-tier limits via its own quota bucket so it never bills.
const FREE_GEMINI_MODEL = "gemini-2.5-flash";
const FREE_GEMINI_QUOTA_KEY = "gemini-free";
const FREE_GEMINI_MINUTE_LIMIT = Number(
  (globalThis as DenoGlobal).Deno?.env.get("GEMINI_FREE_MINUTE_REQUEST_LIMIT") ?? "8",
);
const FREE_GEMINI_DAILY_LIMIT = Number(
  (globalThis as DenoGlobal).Deno?.env.get("GEMINI_FREE_DAILY_REQUEST_LIMIT") ?? "200",
);

export type ModelMentionClassificationStatus = "pending" | "retry" | "classified" | "irrelevant" | "failed";

export interface PendingModelMentionRow {
  id: string;
  model_id: string;
  title: string | null;
  content: string | null;
  source_url: string | null;
  classification_attempts: number | null;
  models?: { name?: string | null; slug?: string | null } | { name?: string | null; slug?: string | null }[] | null;
}

export interface ClassificationStateOptions {
  classifierVersion?: string;
  maxAttempts?: number;
  now?: Date;
}

export interface PendingClassificationSummary {
  selected: number;
  processed: number;
  classified: number;
  irrelevant: number;
  retry: number;
  failed: number;
  dry_run: boolean;
  errors: string[];
}

interface PendingClassificationQueryBuilder {
  select: (columns: string) => PendingClassificationQueryBuilder;
  in: (column: string, values: string[]) => PendingClassificationQueryBuilder;
  or: (query: string) => PendingClassificationQueryBuilder;
  order: (
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ) => PendingClassificationQueryBuilder;
  limit: (count: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
  };
}

interface PendingClassificationClient {
  from: (table: "scraped_posts") => PendingClassificationQueryBuilder;
}

function clippedText(value: string | null | undefined, maxLength: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function modelMentionText(row: PendingModelMentionRow): string {
  const title = clippedText(row.title, 500);
  const content = clippedText(row.content, 3500);
  return `${title} ${content}`.replace(/\s+/g, " ").trim();
}

export function targetModelLabel(row: PendingModelMentionRow): string {
  const relatedModel = Array.isArray(row.models) ? row.models[0] : row.models;
  return relatedModel?.slug || relatedModel?.name || row.model_id;
}

function retryAt(result: ClassifyResult, attempts: number, now: Date): string {
  const retryAfterMs = result.retry_after_ms && result.retry_after_ms > 0
    ? result.retry_after_ms
    : Math.min(24 * 60 * 60 * 1000, 15 * 60 * 1000 * (2 ** Math.max(0, attempts - 1)));
  return new Date(now.getTime() + retryAfterMs).toISOString();
}

export function buildClassificationStateUpdate(
  row: Pick<PendingModelMentionRow, "classification_attempts">,
  result: ClassifyResult,
  options: ClassificationStateOptions = {},
): Record<string, unknown> {
  const now = options.now ?? new Date();
  const nextAttempts = (row.classification_attempts ?? 0) + 1;
  const classifierVersion = options.classifierVersion ?? currentClassifierVersion();
  const maxAttempts = options.maxAttempts ?? 5;

  if (isClassifierFailure(result)) {
    const finalFailure = nextAttempts >= maxAttempts && result.status !== "quota_deferred";
    return {
      classification_status: finalFailure ? "failed" : "retry",
      classification_attempts: nextAttempts,
      next_classification_at: finalFailure ? null : retryAt(result, nextAttempts, now),
      classified_at: null,
      classifier_version: classifierVersion,
      last_classification_error: result.error ?? result.status ?? "classifier_error",
    };
  }

  if (!result.relevant) {
    return {
      classification_status: "irrelevant",
      classification_attempts: nextAttempts,
      next_classification_at: null,
      classified_at: now.toISOString(),
      classifier_version: classifierVersion,
      last_classification_error: null,
      sentiment: null,
      complaint_category: null,
      praise_category: null,
      confidence: 0,
      original_language: result.language ?? null,
      translated_content: result.english_translation ?? null,
    };
  }

  return {
    classification_status: "classified",
    classification_attempts: nextAttempts,
    next_classification_at: null,
    classified_at: now.toISOString(),
    classifier_version: classifierVersion,
    last_classification_error: null,
    sentiment: result.sentiment,
    complaint_category: result.complaint_category,
    praise_category: result.praise_category,
    confidence: result.confidence,
    original_language: result.language ?? null,
    translated_content: result.english_translation ?? null,
  };
}

function statusFromUpdate(payload: Record<string, unknown>): ModelMentionClassificationStatus {
  return payload.classification_status as ModelMentionClassificationStatus;
}

// Mutates `results` in place: retries only the rows that came back as a transient
// classifier_error through the free-tier Gemini key and merges any positive
// recoveries. Returns the count recovered. No-op unless Claude is the active
// classifier and GEMINI_FREE_API_KEY is set.
//
// Correctness guards (so a spillover blip can never corrupt good data):
//   - Only classifier_error indices are retried. quota_deferred is left alone —
//     it's a pacing signal, not a failure, and re-running it wastes free quota.
//   - Only a `classified` spillover result replaces the original. A still-failing
//     or (possibly truncation-padded) irrelevant result leaves Claude's error in
//     place, so the row stays retry/failed and self-heals on the next drain —
//     never silently overwritten with a padding sentinel.
//   - Only the failed rows are re-sent, so Claude successes are never reprocessed
//     or double-charged.
async function applyFreeGeminiSpillover(
  items: { text: string; targetModel: string }[],
  results: ClassifyResult[],
  batchSize: number,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<number> {
  if (providerForModel(resolveClassifierModel()) !== "anthropic") return 0;
  const env = (globalThis as DenoGlobal).Deno?.env;
  const freeKey = env?.get("GEMINI_FREE_API_KEY") ?? env?.get("GEMINI_API_KEY");
  if (!freeKey) return 0;

  const failedIdx: number[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i]?.status === "classifier_error") failedIdx.push(i);
  }
  if (failedIdx.length === 0) return 0;

  const spill = await classifyBatchTargeted(
    failedIdx.map((idx) => items[idx]),
    freeKey,
    batchSize,
    logError,
    {
      model: FREE_GEMINI_MODEL,
      quotaKey: FREE_GEMINI_QUOTA_KEY,
      minuteLimit: FREE_GEMINI_MINUTE_LIMIT,
      dailyLimit: FREE_GEMINI_DAILY_LIMIT,
    },
  );

  let recovered = 0;
  for (let k = 0; k < failedIdx.length; k++) {
    const candidate = spill[k];
    if (candidate && candidate.status === "classified") {
      results[failedIdx[k]] = candidate;
      recovered++;
    }
  }
  if (recovered > 0 && logError) {
    await logError(
      `Free-Gemini spillover recovered ${recovered}/${failedIdx.length} Claude classifier errors`,
      "spillover-recovered",
    );
  }
  return recovered;
}

export async function processPendingClassifications(
  supabase: PendingClassificationClient,
  apiKey: string,
  options: {
    limit?: number;
    batchSize?: number;
    dryRun?: boolean;
    now?: Date;
    logError?: (msg: string, ctx?: string) => Promise<void>;
    classifierVersion?: string;
  } = {},
): Promise<PendingClassificationSummary> {
  const limit = Math.max(1, Math.min(options.limit ?? 40, 200));
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 20, 50));
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const summary: PendingClassificationSummary = {
    selected: 0,
    processed: 0,
    classified: 0,
    irrelevant: 0,
    retry: 0,
    failed: 0,
    dry_run: dryRun,
    errors: [],
  };

  const { data, error } = await supabase
    .from("scraped_posts")
    .select("id, model_id, title, content, source_url, classification_attempts, models(name, slug)")
    .in("classification_status", ["pending", "retry"])
    .or(`next_classification_at.is.null,next_classification_at.lte.${now.toISOString()}`)
    .order("next_classification_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to load pending classifications: ${error.message}`);

  const rows = ((data ?? []) as PendingModelMentionRow[]).filter((row) => modelMentionText(row).length > 0);
  summary.selected = rows.length;
  if (rows.length === 0 || dryRun) return summary;

  const items = rows.map((row) => ({ text: modelMentionText(row), targetModel: targetModelLabel(row) }));
  const results = await classifyBatchTargeted(items, apiKey, batchSize, options.logError);

  // Recover transient Claude errors via free-tier Gemini before writing, so each
  // row is written exactly once with its final (possibly recovered) result.
  await applyFreeGeminiSpillover(items, results, batchSize, options.logError);

  // Constant for the pass — hoisted out of the per-row loop.
  const classifierVersion = options.classifierVersion ?? currentClassifierVersion();

  // Build the updates sequentially (cheap; keeps the status-counter tallies
  // deterministic), then fan the writes out with bounded concurrency. One
  // sequential .update().eq() per row was up to 200 serialized PostgREST round
  // trips (~5-10s) per pass; a bulk RPC is cleaner but needs a migration and the
  // payloads aren't column-uniform across statuses, so concurrent single-row
  // updates are the no-migration win that preserves exact per-row semantics.
  const writes: { id: string; update: Record<string, unknown> }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = results[i];
    if (!result) continue;

    const update = buildClassificationStateUpdate(row, result, { now, classifierVersion });
    const status = statusFromUpdate(update);
    summary[status === "classified" ? "classified" : status === "irrelevant" ? "irrelevant" : status === "failed" ? "failed" : "retry"]++;
    writes.push({ id: row.id, update });
  }

  const WRITE_CONCURRENCY = 12;
  let nextWrite = 0;
  const writer = async () => {
    while (true) {
      const idx = nextWrite++;
      if (idx >= writes.length) return;
      const w = writes[idx];
      const { error: updateError } = await supabase
        .from("scraped_posts")
        .update(w.update)
        .eq("id", w.id);
      if (updateError) {
        summary.errors.push(`${w.id}: ${updateError.message}`);
      } else {
        summary.processed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, writes.length) }, () => writer()));

  return summary;
}
