import { describe, expect, it } from "vitest";

import { sumLedgerSpend } from "../../supabase/functions/_shared/apify-budget";

describe("Apify budget ledger", () => {
  const now = new Date("2026-09-02T04:00:00.000Z");
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600000).toISOString();

  it("sums only LLM Vibes' own actor runs, reading both usage shapes", () => {
    const rows = [
      { started_at: hoursAgo(2), metadata: { apify_usage: { total_usage_usd: 0.448 } } },
      { started_at: hoursAgo(6), metadata: { apify_usage: { usageTotalUsd: 0.1 } } },
      { started_at: hoursAgo(30), metadata: { apify_usage: { usageTotalUsd: "0.1" } } },
      { started_at: hoursAgo(40), metadata: { reason: "apify_monthly_budget_exceeded" } },
      { started_at: hoursAgo(50), metadata: null },
    ];

    const spend = sumLedgerSpend(rows, now);

    expect(spend.dailyUsd).toBeCloseTo(0.548, 6);
    expect(spend.monthlyUsd).toBeCloseTo(0.648, 6);
  });

  it("ignores runs older than the rolling window", () => {
    const rows = [
      { started_at: hoursAgo(31 * 24), metadata: { apify_usage: { usageTotalUsd: 5 } } },
    ];

    expect(sumLedgerSpend(rows, now).monthlyUsd).toBe(0);
  });
});
