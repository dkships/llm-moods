import {
  classifyBatchTargeted,
  isClassifierFailure,
  type ClassifyResult,
} from "./classifier.ts";

export const CURRENT_CLASSIFIER_VERSION = "targeted-gemini-2026-05-08";

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
  const classifierVersion = options.classifierVersion ?? CURRENT_CLASSIFIER_VERSION;
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

  const results = await classifyBatchTargeted(
    rows.map((row) => ({ text: modelMentionText(row), targetModel: targetModelLabel(row) })),
    apiKey,
    batchSize,
    options.logError,
  );

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = results[i];
    if (!result) continue;

    const update = buildClassificationStateUpdate(row, result, {
      now,
      classifierVersion: options.classifierVersion ?? CURRENT_CLASSIFIER_VERSION,
    });
    const status = statusFromUpdate(update);
    summary[status === "classified" ? "classified" : status === "irrelevant" ? "irrelevant" : status === "failed" ? "failed" : "retry"]++;

    const { error: updateError } = await supabase
      .from("scraped_posts")
      .update(update)
      .eq("id", row.id);

    if (updateError) {
      summary.errors.push(`${row.id}: ${updateError.message}`);
      continue;
    }
    summary.processed++;
  }

  return summary;
}
