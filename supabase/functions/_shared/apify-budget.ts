export interface ApifyBudgetResult {
  allowed: boolean;
  reason?: string;
  usage?: Record<string, unknown>;
}

export interface ApifyRunOptions {
  timeoutSecs?: number;
  maxTotalChargeUsd?: number;
  waitForFinishSecs?: number;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number((globalThis as { Deno?: { env: { get(name: string): string | undefined } } }).Deno?.env.get(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DAILY_SPEND_LIMIT_USD = envNumber("APIFY_DAILY_SPEND_LIMIT_USD", 0.80);
const MONTHLY_SPEND_LIMIT_USD = envNumber("APIFY_MONTHLY_SPEND_LIMIT_USD", 24);

// The Apify account is shared with unrelated actors, so account-wide usage
// (`/users/me/usage/monthly`) is the wrong thing to gate on: other work drove
// it to $111 in Aug 2026 and locked LLM Vibes out of Reddit and Twitter for a
// week while its own runs had cost $5. The guard now sums the per-run cost
// this pipeline records in `scraper_runs.metadata.apify_usage` over a rolling
// window, so the limits below describe LLM Vibes' spend and nothing else.
export const APIFY_LEDGER_SOURCES = ["scrape-reddit-apify", "scrape-twitter"];
const LEDGER_WINDOW_DAYS = 30;
const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

export interface LedgerRunRow {
  started_at: string;
  metadata: unknown;
}

export interface LedgerSpend {
  monthlyUsd: number;
  dailyUsd: number;
}

function numericFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pathValue(payload: unknown, path: string[]): unknown {
  let current: unknown = payload;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

// Pay-per-event prices (USD) of the actors this pipeline runs or can roll back
// to by config. Update this table on any actor swap or price change.
//
// Why the ledger does not trust Apify's own figure: the scrapers read a run's
// `usageTotalUsd` at the first poll that sees a terminal status, and Apify
// documents that "the first response after completion can still show
// preliminary stats, costs, and event counts" (docs.apify.com/api/v2/actor-run-get;
// stable after ~10 s). Measured 2026-10-30..11-12: Reddit recorded $1.94
// against ~$4.26 billed, and Twitter runs that returned 250 tweets recorded
// $0.0003-0.0016 with `chargedEventCounts` 0 against $0.0375 billed.
//
//   ledger_usd = max(Apify's figure, starts x runStartUsd + items x perItemUsd)
export interface ActorEventPrices {
  runStartUsd: number;
  perItemUsd: number;
}

export const ACTOR_EVENT_PRICES: Record<string, ActorEventPrices> = {
  "harshmaur/reddit-scraper-pro": { runStartUsd: 0.01, perItemUsd: 0.0014 },
  "harshmaur/reddit-scraper": { runStartUsd: 0.02, perItemUsd: 0.0018 },
  "xquik/x-tweet-scraper": { runStartUsd: 0, perItemUsd: 0.00015 },
  "apidojo/tweet-scraper": { runStartUsd: 0, perItemUsd: 0.0004 },
};

// "charge_cap": the actor is not in ACTOR_EVENT_PRICES, so each run counts at
// its maxTotalChargeUsd. Overstates spend rather than understating it.
export type CostBasis = "event_prices" | "charge_cap";

export interface RunCostInput {
  actorId: string;
  actorRuns: number;
  items: number;
  reportedUsd: number;
  chargeCapUsd: number;
}

export interface RunCost {
  apify_reported_usd: number;
  estimated_usd: number;
  ledger_usd: number;
  cost_basis: CostBasis;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

export function estimateRunCost(input: RunCostInput): RunCost {
  // Reddit passes the URL form of the id ("owner~name").
  const prices = ACTOR_EVENT_PRICES[input.actorId.replace("~", "/")];
  const runs = Math.max(0, input.actorRuns);
  const items = Math.max(0, input.items);
  const reported = Math.max(0, input.reportedUsd);

  const estimated = prices
    ? runs * prices.runStartUsd + items * prices.perItemUsd
    : runs * input.chargeCapUsd;

  return {
    apify_reported_usd: roundUsd(reported),
    estimated_usd: roundUsd(estimated),
    ledger_usd: roundUsd(Math.max(reported, estimated)),
    cost_basis: prices ? "event_prices" : "charge_cap",
  };
}

// Adds the ledger fields to a single run's scrubbed usage (Twitter). A run
// without an id never started, so there is nothing to price.
export function withLedgerCost(
  usage: unknown,
  actorId: string,
  items: number,
  chargeCapUsd: number,
): Record<string, unknown> | null {
  if (!isRecord(usage)) {
    return null;
  }
  if (!usage.id) {
    return usage;
  }

  const cost = estimateRunCost({
    actorId,
    actorRuns: 1,
    items,
    reportedUsd: numericFrom(usage.usageTotalUsd) ?? 0,
    chargeCapUsd,
  });
  return { ...usage, ...cost };
}

// `ledger_usd` is the corrected cost (since 2026-11-12). Older rows only have
// Apify's preliminary figure: Reddit's summed `total_usage_usd`, or Twitter's
// scrubbed `usageTotalUsd`.
function runUsageUsd(metadata: unknown): number {
  return numericFrom(pathValue(metadata, ["apify_usage", "ledger_usd"]))
    ?? numericFrom(pathValue(metadata, ["apify_usage", "total_usage_usd"]))
    ?? numericFrom(pathValue(metadata, ["apify_usage", "usageTotalUsd"]))
    ?? 0;
}

export function sumLedgerSpend(rows: LedgerRunRow[], now: Date = new Date()): LedgerSpend {
  const windowStart = now.getTime() - (LEDGER_WINDOW_DAYS * DAY_MS);
  const dayStart = now.getTime() - DAY_MS;
  let monthlyUsd = 0;
  let dailyUsd = 0;

  for (const row of rows) {
    const startedMs = new Date(row.started_at).getTime();
    if (!Number.isFinite(startedMs) || startedMs < windowStart) continue;

    const usd = runUsageUsd(row.metadata);
    monthlyUsd += usd;
    if (startedMs >= dayStart) dailyUsd += usd;
  }

  return { monthlyUsd, dailyUsd };
}

async function fetchLedgerRows(supabase: any): Promise<LedgerRunRow[] | null> {
  const since = new Date(Date.now() - (LEDGER_WINDOW_DAYS * DAY_MS)).toISOString();
  const { data, error } = await supabase
    .from("scraper_runs")
    .select("started_at, metadata")
    .in("source", APIFY_LEDGER_SOURCES)
    .gte("started_at", since);
  if (error) return null;
  return (data ?? []) as LedgerRunRow[];
}

export async function checkApifyBudget(supabase: any, plannedMaxChargeUsd = 0): Promise<ApifyBudgetResult> {
  const planned = Math.max(0, plannedMaxChargeUsd);
  const limits = {
    scope: "llm_vibes_runs",
    window_days: LEDGER_WINDOW_DAYS,
    monthly_limit_usd: MONTHLY_SPEND_LIMIT_USD,
    daily_limit_usd: DAILY_SPEND_LIMIT_USD,
    planned_max_charge_usd: planned,
  };

  const rows = await fetchLedgerRows(supabase);
  if (!rows) {
    return { allowed: false, reason: "apify_budget_unknown", usage: limits };
  }

  const spend = sumLedgerSpend(rows);
  const usage = {
    ...limits,
    monthly_usage_usd: spend.monthlyUsd,
    daily_usage_usd: spend.dailyUsd,
    projected_monthly_usage_usd: spend.monthlyUsd + planned,
    projected_daily_usage_usd: spend.dailyUsd + planned,
  };

  if (spend.monthlyUsd + planned > MONTHLY_SPEND_LIMIT_USD) {
    return { allowed: false, reason: "apify_monthly_budget_exceeded", usage };
  }
  if (spend.dailyUsd + planned > DAILY_SPEND_LIMIT_USD) {
    return { allowed: false, reason: "apify_daily_budget_exceeded", usage };
  }
  return { allowed: true, usage };
}

export function apifyRunUrl(actorId: string, token: string, maxItems: number, options: ApifyRunOptions = {}): string {
  const params = new URLSearchParams({
    token,
    maxItems: String(Math.max(1, maxItems)),
  });
  if (Number.isFinite(options.timeoutSecs)) {
    params.set("timeout", String(Math.max(30, Math.round(options.timeoutSecs!))));
  }
  if (Number.isFinite(options.maxTotalChargeUsd)) {
    params.set("maxTotalChargeUsd", String(Math.max(0.01, options.maxTotalChargeUsd!)));
  }
  if (Number.isFinite(options.waitForFinishSecs)) {
    params.set("waitForFinish", String(Math.max(0, Math.min(60, Math.round(options.waitForFinishSecs!)))));
  }
  return `https://api.apify.com/v2/acts/${actorId}/runs?${params.toString()}`;
}

export function apifyDatasetItemsUrl(
  datasetId: string,
  token: string,
  options: { limit?: number; clean?: boolean } = {},
): string {
  const params = new URLSearchParams({
    token,
    format: "json",
  });
  if (options.clean !== false) params.set("clean", "true");
  if (Number.isFinite(options.limit)) {
    params.set("limit", String(Math.max(1, Math.round(options.limit!))));
  }
  return `https://api.apify.com/v2/datasets/${datasetId}/items?${params.toString()}`;
}

export async function abortApifyRun(token: string, runId: string): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({ token });
  const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/abort?${params.toString()}`, {
    method: "POST",
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return scrubApifyRun(data?.data);
}

export function scrubApifyRun(run: unknown): Record<string, unknown> {
  const stats = pathValue(run, ["stats"]);
  const pricingInfo = pathValue(run, ["pricingInfo"]);
  const options = pathValue(run, ["options"]);
  return {
    id: pathValue(run, ["id"]) ?? null,
    status: pathValue(run, ["status"]) ?? null,
    statusMessage: pathValue(run, ["statusMessage"]) ?? null,
    defaultDatasetId: pathValue(run, ["defaultDatasetId"]) ?? null,
    usageTotalUsd: pathValue(run, ["usageTotalUsd"]) ?? null,
    usage: pathValue(run, ["usage"]) ?? null,
    usageUsd: pathValue(run, ["usageUsd"]) ?? null,
    stats: isRecord(stats) ? { computeUnits: stats.computeUnits, runTimeSecs: stats.runTimeSecs } : null,
    pricingModel: isRecord(pricingInfo) ? pricingInfo.pricingModel ?? null : null,
    chargedEventCounts: pathValue(run, ["chargedEventCounts"]) ?? null,
    options: isRecord(options)
      ? {
        maxItems: options.maxItems ?? null,
        maxTotalChargeUsd: options.maxTotalChargeUsd ?? null,
        timeoutSecs: options.timeoutSecs ?? null,
        memoryMbytes: options.memoryMbytes ?? null,
      }
      : null,
  };
}
