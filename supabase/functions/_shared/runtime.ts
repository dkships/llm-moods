import {
  PACIFIC_TIMEZONE,
  type CoordinatedWindow,
  normalizeWindowTimes,
} from "./vibes-scoring.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

export interface ScraperConfigMap {
  [key: string]: string[];
}

export interface RunRecordInput {
  source: string;
  run_kind?: string;
  status?: string;
  parent_run_id?: string | null;
  triggered_by?: string | null;
  window_label?: string | null;
  window_local_date?: string | null;
  timezone?: string | null;
  posts_found?: number;
  posts_classified?: number;
  apify_items_fetched?: number;
  filtered_candidates?: number;
  net_new_rows?: number;
  duplicate_conflicts?: number;
  errors?: string[];
  metadata?: Record<string, unknown>;
  started_at?: string;
  completed_at?: string | null;
}

export interface RunRecordRow {
  id: string;
  source: string;
  status: string;
  run_kind: string;
  window_label: string | null;
  window_local_date: string | null;
}

export interface DerivedRunMetrics {
  status: string;
  posts_found: number;
  posts_classified: number;
  apify_items_fetched: number;
  filtered_candidates: number;
  net_new_rows: number;
  duplicate_conflicts: number;
  errors: string[];
}

function toInt(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function readJsonBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export function getAuthorizationHeader(req: Request): string {
  return req.headers.get("authorization") ?? "";
}

export function isInternalServiceRequest(req: Request): boolean {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) return false;
  return getAuthorizationHeader(req) === `Bearer ${serviceRoleKey}`;
}

export const RUN_PIPELINE_TRIGGER_HEADER = "x-run-pipeline-trigger-secret";

export function isRunPipelineTriggerRequest(req: Request): boolean {
  const triggerSecret = Deno.env.get("RUN_PIPELINE_TRIGGER_SECRET");
  return Boolean(triggerSecret && req.headers.get(RUN_PIPELINE_TRIGGER_HEADER) === triggerSecret);
}

// pg_cron invokes edge functions with the public anon JWT (the only key safe to
// embed in a public-repo migration), and these functions run with
// verify_jwt = false. The body shape is documented in this public repo, so it
// authenticates nothing on its own — scheduler calls must ALSO carry a secret
// token that only the database and the service role can read. The token lives
// in public.scheduler_tokens (RLS on, zero policies) and is injected into every
// cron body by migration 20260805130000_scheduler_token_auth.sql.
export function hasSchedulerBodyShape(body: unknown, expectedPipelinePrefix: string): boolean {
  if (!body || typeof body !== "object") return false;
  const candidate = body as { scheduler?: unknown; pipeline?: unknown };
  return candidate.scheduler === "pg_cron"
    && typeof candidate.pipeline === "string"
    && candidate.pipeline.startsWith(expectedPipelinePrefix);
}

let cachedSchedulerToken: string | null = null;

async function loadSchedulerToken(): Promise<string | null> {
  if (cachedSchedulerToken) return cachedSchedulerToken;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    console.error("scheduler token: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    return null;
  }
  try {
    const response = await fetch(`${url}/rest/v1/scheduler_tokens?id=eq.1&select=token`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    if (!response.ok) {
      // Fails closed. A 404 here means the migration has not been applied (or
      // PostgREST has not reloaded its schema cache) — every scheduled job will
      // 403 until it is, so this needs to be loud.
      console.error(`scheduler token: lookup failed with ${response.status}`);
      return null;
    }
    const rows = await response.json();
    const token = Array.isArray(rows) && typeof rows[0]?.token === "string" ? rows[0].token : null;
    if (!token) {
      console.error("scheduler token: public.scheduler_tokens has no row id=1");
      return null;
    }
    cachedSchedulerToken = token;
    return token;
  } catch (error) {
    console.error(`scheduler token: lookup threw ${String(error)}`);
    return null;
  }
}

// Length-independent comparison so a mismatch costs the same time regardless of
// where it diverges.
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function isSchedulerRequest(
  body: unknown,
  expectedPipelinePrefix: string,
): Promise<boolean> {
  if (!hasSchedulerBodyShape(body, expectedPipelinePrefix)) return false;
  const provided = (body as { token?: unknown }).token;
  if (typeof provided !== "string" || provided.length < 16) return false;
  const expected = await loadSchedulerToken();
  return Boolean(expected) && secretsMatch(provided, expected!);
}

export function internalOnlyResponse(corsHeaders: HeadersInit): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isMaintenanceRequestAllowed(maintenance: unknown, isInternal: boolean): boolean {
  return maintenance !== "reaggregate-vibes" || isInternal;
}

export async function loadScraperConfig(
  supabase: any,
  scraper: string,
): Promise<ScraperConfigMap> {
  const { data, error } = await supabase
    .from("scraper_config")
    .select("key, value")
    .eq("scraper", scraper)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load scraper config for ${scraper}: ${error.message}`);
  if (!data) return {};

  const config: ScraperConfigMap = {};
  for (const row of data) {
    if (!config[row.key]) config[row.key] = [];
    config[row.key].push(row.value);
  }
  return config;
}

export function getConfigValues(config: ScraperConfigMap, key: string): string[] {
  return config[key] ?? [];
}

export function getConfigValue(
  config: ScraperConfigMap,
  key: string,
  fallback?: string,
): string | undefined {
  return getConfigValues(config, key)[0] ?? fallback;
}

export function getConfigNumber(
  config: ScraperConfigMap,
  key: string,
  fallback: number,
): number {
  const raw = getConfigValue(config, key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getConfigBoolean(
  config: ScraperConfigMap,
  key: string,
  fallback: boolean,
): boolean {
  const raw = getConfigValue(config, key);
  if (!raw) return fallback;
  if (["true", "1", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(raw.toLowerCase())) return false;
  return fallback;
}

export function getConfiguredWindows(config: ScraperConfigMap): {
  timeZone: string;
  windows: CoordinatedWindow[];
} {
  const configuredTimes = getConfigValues(config, "window_time");
  const windows = normalizeWindowTimes(
    configuredTimes.length > 0 ? configuredTimes : ["05:00", "14:00", "21:00"],
  );

  return {
    timeZone: getConfigValue(config, "timezone", PACIFIC_TIMEZONE)!,
    windows,
  };
}

export function deriveRunMetrics(summary: Record<string, unknown>): DerivedRunMetrics {
  const errors = Array.isArray(summary.errors)
    ? summary.errors.map((entry) => String(entry))
    : [];

  const postsFound = toInt(summary.posts_found ?? summary.fetched ?? summary.total, 0);
  const postsClassified = toInt(
    summary.classification_success ?? summary.classificationSuccess ?? summary.posts_classified ?? summary.classified ?? summary.inserted,
    0,
  );
  const filteredCandidates = toInt(summary.filtered_candidates ?? summary.filtered, 0);
  const netNewRows = toInt(summary.net_new_rows ?? summary.inserted, 0);
  const classificationQueued = toInt(summary.classification_queued ?? summary.classificationQueued ?? summary.queued_classifications, 0);

  let status = typeof summary.status === "string" ? summary.status : "success";
  if (summary.skipped === true) {
    status = "skipped";
  } else if (
    status === "success"
    && filteredCandidates > 0
    && postsClassified === 0
    && errors.some((error) => /classif|quota/i.test(error))
  ) {
    status = classificationQueued > 0 ? "partial" : "failed";
  } else if (errors.length > 0 && status === "success") {
    status = (postsFound > 0 || postsClassified > 0 || netNewRows > 0) ? "partial" : "failed";
  }

  return {
    status,
    posts_found: postsFound,
    posts_classified: postsClassified,
    apify_items_fetched: toInt(summary.apify_items_fetched ?? summary.apifyItems ?? summary.raw_items, 0),
    filtered_candidates: filteredCandidates,
    net_new_rows: netNewRows,
    duplicate_conflicts: toInt(summary.duplicate_conflicts, 0),
    errors,
  };
}

export async function createRunRecord(
  supabase: any,
  input: RunRecordInput,
): Promise<{ data: RunRecordRow | null; error: any }> {
  const result = await supabase
    .from("scraper_runs")
    .insert({
      source: input.source,
      run_kind: input.run_kind ?? "scraper",
      status: input.status ?? "running",
      parent_run_id: input.parent_run_id ?? null,
      triggered_by: input.triggered_by ?? null,
      window_label: input.window_label ?? null,
      window_local_date: input.window_local_date ?? null,
      timezone: input.timezone ?? null,
      posts_found: input.posts_found ?? 0,
      posts_classified: input.posts_classified ?? 0,
      apify_items_fetched: input.apify_items_fetched ?? 0,
      filtered_candidates: input.filtered_candidates ?? 0,
      net_new_rows: input.net_new_rows ?? 0,
      duplicate_conflicts: input.duplicate_conflicts ?? 0,
      errors: input.errors ?? [],
      metadata: input.metadata ?? {},
      started_at: input.started_at ?? new Date().toISOString(),
      completed_at: input.completed_at ?? null,
    })
    .select("id, source, status, run_kind, window_label, window_local_date")
    .maybeSingle();
  return result as { data: RunRecordRow | null; error: any };
}

// Helper used by callers that have already verified `error` is null —
// asserts that data is present and returns a non-null row.
export function assertRunRecord(record: RunRecordRow | null): RunRecordRow {
  if (!record) {
    throw new Error("createRunRecord returned no row");
  }
  return record;
}

export async function updateRunRecord(
  supabase: any,
  runId: string,
  input: Partial<RunRecordInput>,
): Promise<void> {
  const payload: Record<string, unknown> = {};

  if (input.status !== undefined) payload.status = input.status;
  if (input.completed_at !== undefined) payload.completed_at = input.completed_at;
  if (input.posts_found !== undefined) payload.posts_found = input.posts_found;
  if (input.posts_classified !== undefined) payload.posts_classified = input.posts_classified;
  if (input.apify_items_fetched !== undefined) payload.apify_items_fetched = input.apify_items_fetched;
  if (input.filtered_candidates !== undefined) payload.filtered_candidates = input.filtered_candidates;
  if (input.net_new_rows !== undefined) payload.net_new_rows = input.net_new_rows;
  if (input.duplicate_conflicts !== undefined) payload.duplicate_conflicts = input.duplicate_conflicts;
  if (input.errors !== undefined) payload.errors = input.errors;
  if (input.metadata !== undefined) payload.metadata = input.metadata;

  const { error } = await supabase.from("scraper_runs").update(payload).eq("id", runId);
  if (error) throw new Error(`Failed to update scraper run ${runId}: ${error.message}`);
}

export function isUniqueViolation(error: any): boolean {
  return error?.code === "23505";
}
