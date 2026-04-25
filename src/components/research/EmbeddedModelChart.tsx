import { lazy, Suspense, useMemo } from "react";
import { useModelDetail, useVibesHistory } from "@/hooks/useVibesData";
import { getEventsForModel, getEventColor } from "@/data/vendor-events";
import { getPacificDateLabel } from "@/lib/vibes";
import type { ChartEventMarker } from "@/components/VibesChart";

const LazyVibesChart = lazy(() => import("@/components/VibesChart"));

interface EmbeddedModelChartProps {
  modelSlug: string;
}

/**
 * A live model chart embedded inside research articles.
 *
 * Uses the same vibes_scores fetch path as ModelDetail and renders the
 * vendor-events overlay so an article's hero chart stays current with the
 * underlying data instead of relying on a screenshot.
 */
const EmbeddedModelChart = ({ modelSlug }: EmbeddedModelChartProps) => {
  const { data: model } = useModelDetail(modelSlug);
  const { data: vibesHistory, isLoading, isError } = useVibesHistory(model?.id, "daily", "30d");

  const accent = model?.accent_color || "#888";

  const { chartData, dateLabels } = useMemo(() => {
    const history = vibesHistory || [];
    const emptyLabels: Record<string, string> = {};
    if (history.length === 0) {
      return { chartData: [] as { day: string; score: number | null }[], dateLabels: emptyLabels };
    }

    const scoresByDate = new Map<string, number>();
    for (const v of history) {
      const key = new Date(v.period_start).toISOString().slice(0, 10);
      scoresByDate.set(key, v.score);
    }

    const days = 30;
    const now = new Date();
    const todayPacific = getPacificDateLabel(now);
    const result: { day: string; score: number | null }[] = [];
    const labels: Record<string, string> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      const key = d.toISOString().slice(0, 10);
      const label =
        key === todayPacific
          ? "Today"
          : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      result.push({ day: label, score: scoresByDate.get(key) ?? null });
      labels[key] = label;
    }
    return { chartData: result, dateLabels: labels };
  }, [vibesHistory]);

  const chartEvents: ChartEventMarker[] = useMemo(() => {
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
  }, [dateLabels, modelSlug]);

  if (isError) {
    return (
      <div className="my-6 rounded-xl border border-border bg-secondary/20 p-6 text-center text-sm text-muted-foreground">
        Failed to load chart data.
      </div>
    );
  }

  return (
    <div className="my-6 rounded-xl border border-border bg-card/40 p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-mono uppercase tracking-wide text-muted-foreground">
          {model?.name ?? modelSlug} · daily score · last 30 days
        </h3>
      </div>
      <div className="h-56 sm:h-64">
        {isLoading ? (
          <div className="h-full animate-pulse rounded bg-secondary/40" aria-hidden="true" />
        ) : (
          <Suspense fallback={<div className="h-full animate-pulse rounded bg-secondary/40" aria-hidden="true" />}>
            <LazyVibesChart chartData={chartData} accent={accent} timeRange="30d" events={chartEvents} />
          </Suspense>
        )}
      </div>
      {chartEvents.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border/40 pt-3">
          {chartEvents.map((evt, i) => (
            <li key={`evt-${i}`} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block h-2 w-3 shrink-0 rounded-sm"
                style={{ background: evt.color, opacity: 0.7 }}
                aria-hidden="true"
              />
              <span className="text-foreground/80">{evt.title}</span>
              <span className="font-mono text-foreground/50">
                {evt.startLabel}
                {evt.endLabel ? ` → ${evt.endLabel}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default EmbeddedModelChart;
