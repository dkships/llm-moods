import { useMemo } from "react";
import { getPacificDateLabel } from "@/lib/vibes";
import { getEventColor, getEventsForModel } from "@/data/vendor-events";
import type { ChartEventMarker } from "@/components/VibesChart";

export interface VibesHistoryRow {
  period_start: string;
  score: number;
  total_posts?: number | null;
}

export interface DailyChartPoint {
  day: string;
  score: number | null;
  /** Marks days where the aggregator carried yesterday's score forward
   * because zero posts were scraped. Renders distinctly so a stale point
   * isn't read as a real measurement. */
  isCarryForward?: boolean;
}

export interface DailyChartData {
  chartData: DailyChartPoint[];
  dateLabels: Record<string, string>;
}

/**
 * Build a complete N-day daily chart from a sparse vibes_scores history.
 * Missing days render as null gaps. The most recent Pacific day is labeled "Today".
 *
 * Used by both /model/:slug (7d/30d ranges) and the embedded chart on
 * research articles. The 24h hourly view computes its own data inline since
 * it has different label semantics.
 */
export function useDailyChartData(
  history: VibesHistoryRow[] | undefined,
  days: number,
): DailyChartData {
  return useMemo(() => {
    const rows = history ?? [];
    const emptyLabels: Record<string, string> = {};
    if (rows.length === 0) return { chartData: [], dateLabels: emptyLabels };

    const rowByDate = new Map<string, VibesHistoryRow>();
    for (const v of rows) {
      const key = new Date(v.period_start).toISOString().slice(0, 10);
      rowByDate.set(key, v);
    }

    const now = new Date();
    const todayPacific = getPacificDateLabel(now);
    const result: DailyChartPoint[] = [];
    const labels: Record<string, string> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      const key = d.toISOString().slice(0, 10);
      const label =
        key === todayPacific
          ? "Today"
          : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      const row = rowByDate.get(key);
      result.push({
        day: label,
        score: row?.score ?? null,
        isCarryForward: row != null && row.total_posts === 0,
      });
      labels[key] = label;
    }
    return { chartData: result, dateLabels: labels };
  }, [history, days]);
}

/**
 * Map vendor events to the chart's date-label space, clamping to visible
 * range and snapping to the nearest day on missing-data gaps.
 */
export function useChartEvents(
  modelSlug: string,
  dateLabels: Record<string, string>,
): ChartEventMarker[] {
  return useMemo(() => {
    const visibleKeys = Object.keys(dateLabels);
    if (visibleKeys.length === 0) return [];
    const minKey = visibleKeys[0];
    const maxKey = visibleKeys[visibleKeys.length - 1];

    const findLabelOnOrAfter = (iso: string): string | null => {
      if (iso < minKey) return dateLabels[minKey];
      if (iso > maxKey) return null;
      if (dateLabels[iso]) return dateLabels[iso];
      for (const k of visibleKeys) {
        if (k >= iso) return dateLabels[k];
      }
      return null;
    };
    const findLabelOnOrBefore = (iso: string): string | null => {
      if (iso > maxKey) return dateLabels[maxKey];
      if (iso < minKey) return null;
      if (dateLabels[iso]) return dateLabels[iso];
      for (let i = visibleKeys.length - 1; i >= 0; i--) {
        if (visibleKeys[i] <= iso) return dateLabels[visibleKeys[i]];
      }
      return null;
    };

    const markers: ChartEventMarker[] = [];
    for (const event of getEventsForModel(modelSlug)) {
      const startIso = event.eventDate;
      const endIso = event.eventEndDate ?? event.eventDate;
      if (endIso < minKey || startIso > maxKey) continue;

      const startLabel = findLabelOnOrAfter(startIso);
      const endLabel = findLabelOnOrBefore(endIso);
      if (!startLabel || !endLabel) continue;

      markers.push({
        startLabel,
        endLabel: startLabel === endLabel ? undefined : endLabel,
        color: getEventColor(event.eventType),
        title: event.title,
      });
    }
    return markers;
  }, [modelSlug, dateLabels]);
}
