import { lazy, Suspense } from "react";
import { useModelDetail, useVibesHistory } from "@/hooks/useVibesData";
import { useDailyChartData, useChartEvents } from "@/lib/use-chart-data";

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

  const { chartData, dateLabels } = useDailyChartData(vibesHistory, 30);
  const chartEvents = useChartEvents(modelSlug, dateLabels);

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
