import {
  PACIFIC_TIMEZONE,
  type CoordinatedWindow,
  normalizeWindowTimes,
} from "./vibes-scoring.ts";

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

export function internalOnlyResponse(corsHeaders: HeadersInit): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  let status = typeof summary.status === "string" ? summary.status : "success";
  if (summary.skipped === true) {
    status = "skipped";
  } else if (
    status === "success"
    && filteredCandidates > 0
    && postsClassified === 0
    && errors.some((error) => /classif|quota/i.test(error))
  ) {
    status = "failed";
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
