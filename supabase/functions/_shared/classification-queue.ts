import { isClassifierFailure, type ClassifyResult } from "./classifier.ts";

export interface ClassificationQueueCandidate {
  source: string;
  scraper_source: string;
  model_id: string;
  model_slug: string;
  source_url: string;
  title: string;
  content: string;
  full_text: string;
  content_type: string;
  score: number;
  posted_at: string;
  metadata?: Record<string, unknown>;
}

interface QueueSupabaseClient {
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
}

export async function enqueueClassificationCandidate(
  supabase: QueueSupabaseClient,
  candidate: ClassificationQueueCandidate,
  classification?: ClassifyResult | null,
): Promise<{ queued: boolean; error: string | null }> {
  const retryAfterMs = classification?.retry_after_ms ?? null;
  const nextAttemptAt = retryAfterMs && retryAfterMs > 0
    ? new Date(Date.now() + retryAfterMs).toISOString()
    : new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("classification_queue")
    .upsert({
      source: candidate.source,
      scraper_source: candidate.scraper_source,
      model_id: candidate.model_id,
      model_slug: candidate.model_slug,
      source_url: candidate.source_url,
      title: candidate.title.slice(0, 500),
      content: candidate.content.slice(0, 4000),
      full_text: candidate.full_text.slice(0, 4000),
      content_type: candidate.content_type,
      score: candidate.score,
      posted_at: candidate.posted_at,
      status: "queued",
      last_error: classification?.error ?? null,
      last_error_type: classification?.error_type ?? classification?.status ?? null,
      request_error_id: classification?.request_error_id ?? null,
      next_attempt_at: nextAttemptAt,
      metadata: candidate.metadata ?? {},
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_url,model_id" });

  return { queued: !error, error: error?.message ?? null };
}

export async function enqueueFailedClassificationCandidates(
  supabase: QueueSupabaseClient,
  candidates: ClassificationQueueCandidate[],
  classifications: Array<ClassifyResult | undefined>,
): Promise<{ queued: number; errors: string[] }> {
  let queued = 0;
  const errors: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const classification = classifications[i] ?? null;
    if (classification && !isClassifierFailure(classification)) continue;
    const result = await enqueueClassificationCandidate(supabase, candidates[i], classification);
    if (result.queued) {
      queued++;
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  return { queued, errors };
}
