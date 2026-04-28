import { lazy, Suspense } from "react";
import Surface from "@/components/Surface";
import { useModelDetail, useVibesHistory } from "@/hooks/useVibesData";
import { useDailyChartData, useChartEvents } from "@/lib/use-chart-data";

const LazyVibesChart = lazy(() => import("@/components/VibesChart"));

interface EmbeddedModelChartProps {
  modelSlug: string;
  /** Number of inclusive days to render. Defaults to 30. */
  daysBack?: number;
}

/**
 * A live model chart embedded inside research articles.
 *
 * Uses the same vibes_scores fetch path as ModelDetail and renders the
 * vendor-events overlay so an article's hero chart stays current with the
 * underlying data instead of relying on a screenshot.
 */
const EmbeddedModelChart = ({ modelSlug, daysBack }: EmbeddedModelChartProps) => {
  const days = daysBack ?? 30;
  const { data: model } = useModelDetail(modelSlug);
  const { data: vibesHistory, isLoading, isError } = useVibesHistory(model?.id, "daily", `${days}d`);

  const accent = model?.accent_color || "#888";

  const { chartData, dateLabels } = useDailyChartData(vibesHistory, days);
  const chartEvents = useChartEvents(modelSlug, dateLabels);

  if (isError) {
    return (
      <Surface className="my-6 text-center text-sm text-text-tertiary">
        Failed to load chart data.
      </Surface>
    );
  }

  return (
    <Surface className="my-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-sm uppercase tracking-wide text-text-tertiary">
          {model?.name ?? modelSlug} · daily score · last {days} days
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
              <span className="text-text-secondary">{evt.title}</span>
              <span className="font-mono text-text-tertiary">
                {evt.startLabel}
                {evt.endLabel ? ` → ${evt.endLabel}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
};

export default EmbeddedModelChart;
