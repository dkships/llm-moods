import type { VendorStatusEvent } from "@/hooks/useVendorStatus";
import type { ScoreAnomaly } from "@/hooks/useScoreAnomalies";

export interface CorrelatedStatusEvent extends VendorStatusEvent {
  correlatedAnomalies: ScoreAnomaly[];
}

/**
 * Convert a date-like string into UTC day-resolution milliseconds. Strips
 * intra-day variation so correlations don't oscillate by timezone.
 */
function startOfUtcDay(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NaN;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Pair vendor status events with score anomalies that occurred within a
 * ±windowDays window of the event date, restricted to a single model and
 * to non-normal anomalies. Returned matches are sorted by absolute z
 * descending so the strongest signal renders first.
 *
 * Pure function — no fetching, no React. Both inputs are small (~30
 * events, ~30 anomalies), so the nested loop is fine.
 */
export function correlateStatusWithAnomalies(
  events: VendorStatusEvent[],
  anomalies: ScoreAnomaly[],
  modelSlug: string,
  windowDays = 2,
): CorrelatedStatusEvent[] {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const eligibleAnomalies = anomalies.filter(
    (a) => a.modelSlug === modelSlug && a.severity !== "normal",
  );

  return events.map((event) => {
    const eventDay = startOfUtcDay(event.updatedAt);
    if (Number.isNaN(eventDay)) {
      return { ...event, correlatedAnomalies: [] };
    }

    const matches = eligibleAnomalies
      .filter((a) => {
        const anomalyDay = startOfUtcDay(a.periodStart);
        if (Number.isNaN(anomalyDay)) return false;
        return Math.abs(eventDay - anomalyDay) <= windowMs;
      })
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

    return { ...event, correlatedAnomalies: matches };
  });
}
