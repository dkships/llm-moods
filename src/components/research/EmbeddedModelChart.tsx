import { lazy, Suspense } from "react";
import Surface from "@/components/Surface";
import { useModelDetail, useVibesHistory } from "@/hooks/useVibesData";
import { useDailyChartData, useChartEvents } from "@/lib/use-chart-data";
import { getUtcInstantForPacificMidnight } from "@/lib/pacific-day";

const LazyVibesChart = lazy(() => import("@/components/VibesChart"));

interface EmbeddedModelChartProps {
  modelSlug: string;
  /** Number of inclusive days to render. Defaults to 30. Ignored when both
   * startDate and endDate are provided. */
  daysBack?: number;
  /** Pin the chart to a fixed historical window (YYYY-MM-DD, inclusive on both
   * sides, Pacific-day boundaries). Use together with `endDate` so the chart
   * stays aligned with article prose even after months have passed. */
  startDate?: string;
  /** End of the pinned window (YYYY-MM-DD, inclusive). */
  endDate?: string;
  /** Optional caption rendered above the chart, replacing the default
   * "last N days" label. Useful for articles that want "March 10 – April 25". */
  caption?: string;
}

function daysBetweenInclusive(startLabel: string, endLabel: string): number {
  const [sy, sm, sd] = startLabel.split("-").map(Number);
  const [ey, em, ed] = endLabel.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Live model chart embedded inside research articles. Uses the same
 * vibes_scores fetch path as ModelDetail and renders the vendor-events
 * overlay so an article's hero chart stays current.
 *
 * Pass startDate + endDate to pin the window to a specific historical period.
 * Otherwise the chart shows the trailing `daysBack` days from today.
 */
const EmbeddedModelChart = ({ modelSlug, daysBack, startDate, endDate, caption }: EmbeddedModelChartProps) => {
  const isPinned = Boolean(startDate && endDate);
  const days = isPinned ? daysBetweenInclusive(startDate!, endDate!) : (daysBack ?? 30);
  const sinceISO = isPinned ? getUtcInstantForPacificMidnight(startDate!).toISOString() : undefined;
  const untilISO = isPinned ? getUtcInstantForPacificMidnight(endDate!).toISOString() : undefined;
  const anchorDate = isPinned ? getUtcInstantForPacificMidnight(endDate!) : undefined;

  const { data: model } = useModelDetail(modelSlug);
  const { data: vibesHistory, isLoading, isError } = useVibesHistory(
    model?.id,
    "daily",
    `${days}d`,
    isPinned ? { sinceISO, untilISO } : undefined,
  );

  const accent = model?.accent_color || "#888";

  const { chartData, dateLabels } = useDailyChartData(vibesHistory, days, anchorDate);
  const chartEvents = useChartEvents(modelSlug, dateLabels);

  if (isError) {
    return (
      <Surface className="my-6 text-center text-sm text-text-tertiary">
        Failed to load chart data.
      </Surface>
    );
  }

  const headerLabel = caption
    ? caption
    : isPinned
      ? `${model?.name ?? modelSlug} · daily score · ${startDate} → ${endDate}`
      : `${model?.name ?? modelSlug} · daily score · last ${days} days`;

  return (
    <Surface className="my-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-mono-cap text-text-tertiary">
          {headerLabel}
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
