import { describe, expect, it } from "vitest";

import { estimateRunCost, sumLedgerSpend, withLedgerCost } from "../../supabase/functions/_shared/apify-budget";

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

  it("prefers the corrected ledger_usd over the raw Apify figure", () => {
    const rows = [
      { started_at: hoursAgo(1), metadata: { apify_usage: { total_usage_usd: 0.04, ledger_usd: 0.266 } } },
      { started_at: hoursAgo(2), metadata: { apify_usage: { usageTotalUsd: 0.0008, ledger_usd: 0.0375 } } },
    ];

    expect(sumLedgerSpend(rows, now).dailyUsd).toBeCloseTo(0.3035, 6);
  });
});

describe("Apify run cost estimate", () => {
  // 2026-11-12 04:00 UTC: 7 subs x 20 posts recorded $0.04 while Apify's
  // event prices put the run at 7 x $0.01 + 140 x $0.0014 = $0.266.
  it("prices a Reddit fan-out from run starts and returned items", () => {
    const cost = estimateRunCost({
      actorId: "harshmaur~reddit-scraper-pro",
      actorRuns: 7,
      items: 140,
      reportedUsd: 0.04,
      chargeCapUsd: 0.25,
    });

    expect(cost.cost_basis).toBe("event_prices");
    expect(cost.estimated_usd).toBeCloseTo(0.266, 6);
    expect(cost.ledger_usd).toBeCloseTo(0.266, 6);
    expect(cost.apify_reported_usd).toBe(0.04);
  });

  it("keeps the Apify figure when it is higher than the estimate", () => {
    const cost = estimateRunCost({
      actorId: "xquik/x-tweet-scraper",
      actorRuns: 1,
      items: 100,
      reportedUsd: 0.05,
      chargeCapUsd: 0.15,
    });

    expect(cost.estimated_usd).toBeCloseTo(0.015, 6);
    expect(cost.ledger_usd).toBe(0.05);
  });

  it("charges an unpriced actor at its per-run cap so the guard fails closed", () => {
    const cost = estimateRunCost({
      actorId: "someone/new-actor",
      actorRuns: 2,
      items: 40,
      reportedUsd: 0.01,
      chargeCapUsd: 0.25,
    });

    expect(cost.cost_basis).toBe("charge_cap");
    expect(cost.ledger_usd).toBeCloseTo(0.5, 6);
  });

  // 2026-11-11 04:06 UTC: 250 tweets returned, chargedEventCounts 0,
  // usageTotalUsd $0.0008 at the first terminal poll.
  it("corrects a Twitter run read before Apify settled its charges", () => {
    const usage = withLedgerCost(
      { id: "run1", usageTotalUsd: 0.0007902822751551868, chargedEventCounts: { "apify-default-dataset-item": 0 } },
      "xquik/x-tweet-scraper",
      250,
      0.15,
    );

    expect(usage?.ledger_usd).toBeCloseTo(0.0375, 6);
    expect(usage?.usageTotalUsd).toBeCloseTo(0.00079, 6);
  });

  it("leaves a run that never started unpriced", () => {
    expect(withLedgerCost(null, "xquik/x-tweet-scraper", 0, 0.15)).toBeNull();
    expect(withLedgerCost({ id: null, usageTotalUsd: null }, "xquik/x-tweet-scraper", 0, 0.15))
      .toEqual({ id: null, usageTotalUsd: null });
  });
});
