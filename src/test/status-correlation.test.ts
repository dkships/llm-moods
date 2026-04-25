import { describe, expect, it } from "vitest";

import { correlateStatusWithAnomalies } from "@/lib/status-correlation";
import type { VendorStatusEvent } from "@/hooks/useVendorStatus";
import type { ScoreAnomaly } from "@/hooks/useScoreAnomalies";

const event = (overrides: Partial<VendorStatusEvent> = {}): VendorStatusEvent => ({
  id: "evt-1",
  title: "Elevated errors on Claude Opus 4.7",
  updatedAt: "2026-04-15T12:00:00.000Z",
  summary: null,
  url: null,
  severity: "minor",
  ...overrides,
});

const anomaly = (overrides: Partial<ScoreAnomaly> = {}): ScoreAnomaly => ({
  modelId: "claude-id",
  modelSlug: "claude",
  modelName: "Claude",
  accentColor: null,
  periodStart: "2026-04-14T00:00:00.000Z",
  score: 26,
  baselineMean: 44.6,
  baselineStddev: 8.4,
  z: -2.22,
  severity: "watch",
  sampleSize: 14,
  totalPosts: 14,
  topComplaint: "lazy_responses",
  ...overrides,
});

describe("correlateStatusWithAnomalies", () => {
  it("matches anomalies within the default 2-day window", () => {
    const result = correlateStatusWithAnomalies(
      [event({ updatedAt: "2026-04-14T22:00:00.000Z" })],
      [anomaly({ periodStart: "2026-04-13T00:00:00.000Z" })],
      "claude",
    );
    expect(result[0].correlatedAnomalies).toHaveLength(1);
    expect(result[0].correlatedAnomalies[0].periodStart).toBe("2026-04-13T00:00:00.000Z");
  });

  it("matches across a same-day boundary regardless of intra-day timestamps", () => {
    const result = correlateStatusWithAnomalies(
      [event({ updatedAt: "2026-04-14T23:59:00.000Z" })],
      [anomaly({ periodStart: "2026-04-14T00:00:00.000Z" })],
      "claude",
    );
    expect(result[0].correlatedAnomalies).toHaveLength(1);
  });

  it("excludes anomalies outside the window", () => {
    const result = correlateStatusWithAnomalies(
      [event({ updatedAt: "2026-04-20T12:00:00.000Z" })],
      [anomaly({ periodStart: "2026-04-10T00:00:00.000Z" })],
      "claude",
    );
    expect(result[0].correlatedAnomalies).toHaveLength(0);
  });

  it("filters out normal anomalies even within the window", () => {
    const result = correlateStatusWithAnomalies(
      [event({ updatedAt: "2026-04-15T00:00:00.000Z" })],
      [anomaly({ periodStart: "2026-04-15T00:00:00.000Z", severity: "normal", z: 0.4 })],
      "claude",
    );
    expect(result[0].correlatedAnomalies).toHaveLength(0);
  });

  it("filters out anomalies for a different model", () => {
    const result = correlateStatusWithAnomalies(
      [event({ updatedAt: "2026-04-15T00:00:00.000Z" })],
      [anomaly({ periodStart: "2026-04-15T00:00:00.000Z", modelSlug: "chatgpt" })],
      "claude",
    );
    expect(result[0].correlatedAnomalies).toHaveLength(0);
  });

  it("sorts matched anomalies by absolute z descending", () => {
    const result = correlateStatusWithAnomalies(
      [event({ updatedAt: "2026-04-15T00:00:00.000Z" })],
      [
        anomaly({ periodStart: "2026-04-14T00:00:00.000Z", z: -2.1, severity: "watch" }),
        anomaly({ periodStart: "2026-04-15T00:00:00.000Z", z: -3.4, severity: "breach" }),
        anomaly({ periodStart: "2026-04-16T00:00:00.000Z", z: 2.5, severity: "watch" }),
      ],
      "claude",
    );
    expect(result[0].correlatedAnomalies.map((a) => a.z)).toEqual([-3.4, 2.5, -2.1]);
  });

  it("respects a custom windowDays argument", () => {
    const events = [event({ updatedAt: "2026-04-20T12:00:00.000Z" })];
    const anomalies = [anomaly({ periodStart: "2026-04-15T00:00:00.000Z", severity: "breach", z: -3.5 })];
    const tight = correlateStatusWithAnomalies(events, anomalies, "claude", 2);
    const loose = correlateStatusWithAnomalies(events, anomalies, "claude", 7);
    expect(tight[0].correlatedAnomalies).toHaveLength(0);
    expect(loose[0].correlatedAnomalies).toHaveLength(1);
  });

  it("returns events untouched when there are no anomalies", () => {
    const result = correlateStatusWithAnomalies([event(), event({ id: "evt-2" })], [], "claude");
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.correlatedAnomalies).toEqual([]);
    }
  });

  it("handles malformed dates gracefully", () => {
    const result = correlateStatusWithAnomalies(
      [event({ updatedAt: "not-a-date" })],
      [anomaly()],
      "claude",
    );
    expect(result[0].correlatedAnomalies).toEqual([]);
  });
});
