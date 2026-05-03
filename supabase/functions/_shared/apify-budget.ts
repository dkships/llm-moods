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
  const parsed = Number((globalThis as any).Deno?.env.get(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DAILY_SPEND_LIMIT_USD = envNumber("APIFY_DAILY_SPEND_LIMIT_USD", 0.80);
const MONTHLY_SPEND_LIMIT_USD = envNumber("APIFY_MONTHLY_SPEND_LIMIT_USD", 24);

function numericFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function findUsageUsd(payload: any): number | null {
  const candidates = [
    payload?.data?.totalUsageCreditsUsdAfterVolumeDiscount,
    payload?.data?.totalUsageCreditsUsdBeforeVolumeDiscount,
    payload?.data?.current?.monthlyUsageUsd,
    payload?.data?.usageTotalUsd,
    payload?.data?.totalUsd,
    payload?.data?.totalUsageUsd,
    payload?.data?.currentUsageUsd,
    payload?.current?.monthlyUsageUsd,
    payload?.usageTotalUsd,
    payload?.totalUsd,
  ];
  for (const candidate of candidates) {
    const parsed = numericFrom(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function findTodayUsageUsd(monthly: any): number | null {
  const daily = monthly?.data?.dailyServiceUsages;
  if (!Array.isArray(daily) || daily.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const exact = daily.find((entry: any) => typeof entry?.date === "string" && entry.date.slice(0, 10) === today);
  const latest = exact ?? daily[daily.length - 1];
  return numericFrom(latest?.totalUsageCreditsUsd);
}

async function fetchJson(url: string): Promise<any | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

export async function checkApifyBudget(token: string, plannedMaxChargeUsd = 0): Promise<ApifyBudgetResult> {
  const planned = Math.max(0, plannedMaxChargeUsd);
  const encodedToken = encodeURIComponent(token);
  const monthly = await fetchJson(`https://api.apify.com/v2/users/me/usage/monthly?token=${encodedToken}`);
  const limits = await fetchJson(`https://api.apify.com/v2/users/me/limits?token=${encodedToken}`);
  if (!monthly && !limits) {
    return {
      allowed: false,
      reason: "apify_budget_unknown",
      usage: { monthly_limit_usd: MONTHLY_SPEND_LIMIT_USD, daily_limit_usd: DAILY_SPEND_LIMIT_USD },
    };
  }

  const monthlyUsageUsd = findUsageUsd(monthly) ?? findUsageUsd(limits);
  if (monthlyUsageUsd === null) {
    return {
      allowed: false,
      reason: "apify_budget_unreadable",
      usage: {
        monthly_limit_usd: MONTHLY_SPEND_LIMIT_USD,
        daily_limit_usd: DAILY_SPEND_LIMIT_USD,
        monthly_available: Boolean(monthly),
        limits_available: Boolean(limits),
      },
    };
  }

  if (monthlyUsageUsd !== null && monthlyUsageUsd + planned > MONTHLY_SPEND_LIMIT_USD) {
    return {
      allowed: false,
      reason: "apify_monthly_budget_exceeded",
      usage: {
        monthly_usage_usd: monthlyUsageUsd,
        planned_max_charge_usd: planned,
        projected_monthly_usage_usd: monthlyUsageUsd + planned,
        monthly_limit_usd: MONTHLY_SPEND_LIMIT_USD,
      },
    };
  }

  const todayUsageUsd = findTodayUsageUsd(monthly);
  if (todayUsageUsd !== null && todayUsageUsd + planned > DAILY_SPEND_LIMIT_USD) {
    return {
      allowed: false,
      reason: "apify_daily_budget_exceeded",
      usage: {
        daily_usage_usd: todayUsageUsd,
        planned_max_charge_usd: planned,
        projected_daily_usage_usd: todayUsageUsd + planned,
        daily_limit_usd: DAILY_SPEND_LIMIT_USD,
      },
    };
  }

  return {
    allowed: true,
    usage: {
      monthly_usage_usd: monthlyUsageUsd,
      monthly_limit_usd: MONTHLY_SPEND_LIMIT_USD,
      daily_usage_usd: todayUsageUsd,
      daily_limit_usd: DAILY_SPEND_LIMIT_USD,
      planned_max_charge_usd: planned,
      projected_monthly_usage_usd: monthlyUsageUsd + planned,
      projected_daily_usage_usd: todayUsageUsd === null ? null : todayUsageUsd + planned,
      limits_available: Boolean(limits),
    },
  };
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

export async function abortApifyRun(token: string, runId: string): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({ token });
  const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/abort?${params.toString()}`, {
    method: "POST",
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return scrubApifyRun(data?.data);
}

export function scrubApifyRun(run: any): Record<string, unknown> {
  return {
    id: run?.id ?? null,
    status: run?.status ?? null,
    statusMessage: run?.statusMessage ?? null,
    defaultDatasetId: run?.defaultDatasetId ?? null,
    usageTotalUsd: run?.usageTotalUsd ?? null,
    usage: run?.usage ?? null,
    usageUsd: run?.usageUsd ?? null,
    stats: run?.stats ? { computeUnits: run.stats.computeUnits, runTimeSecs: run.stats.runTimeSecs } : null,
    pricingModel: run?.pricingInfo?.pricingModel ?? null,
    chargedEventCounts: run?.chargedEventCounts ?? null,
    options: run?.options
      ? {
        maxItems: run.options.maxItems ?? null,
        maxTotalChargeUsd: run.options.maxTotalChargeUsd ?? null,
        timeoutSecs: run.options.timeoutSecs ?? null,
        memoryMbytes: run.options.memoryMbytes ?? null,
      }
      : null,
  };
}
