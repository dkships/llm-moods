import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
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
const EmbeddedModelChartContent = ({ modelSlug, daysBack, startDate, endDate, caption }: EmbeddedModelChartProps) => {
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
      <Surface className="my-6 text-center text-body text-text-tertiary">
        Failed to load chart data.
      </Surface>
    );
  }

  // A pinned window that predates data collection resolves successfully with an
  // all-null grid; without this branch the article shows a silent empty axis box.
  if (!isLoading && chartData.every((d) => d.score == null)) {
    return (
      <Surface className="my-6 text-center text-body text-text-tertiary">
        No score data for this window.
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
        <h3 className="text-mono-cap leading-relaxed text-text-tertiary">
          {headerLabel}
        </h3>
      </div>
      <div className="h-56 sm:h-64">
        {isLoading ? (
          <div className="h-full" role="status" aria-live="polite">
            <span className="sr-only">Loading chart data</span>
            <div className="h-full animate-pulse rounded bg-secondary/35" aria-hidden="true" />
          </div>
        ) : (
          <ErrorBoundary
            fallback={
              <p className="py-8 text-center text-body text-text-tertiary" role="status" aria-live="polite">
                Chart failed to render.
              </p>
            }
          >
            <Suspense fallback={<div className="h-full animate-pulse rounded bg-secondary/35" aria-hidden="true" />}>
              <LazyVibesChart chartData={chartData} accent={accent} timeRange="30d" events={chartEvents} />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
      {chartEvents.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {chartEvents.map((evt, i) => (
            <li key={`evt-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
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

const EmbeddedModelChart = (props: EmbeddedModelChartProps) => {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [shouldMount, setShouldMount] = useState(false);

  useEffect(() => {
    const element = placeholderRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setShouldMount(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldMount(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (shouldMount) return <EmbeddedModelChartContent {...props} />;

  return (
    <div ref={placeholderRef} className="my-6" role="status">
      {/* Matches mounted height: Surface p-4/sm:p-6 + mono-cap header row (line-height
          ~18px) + mb-3 + h-56/sm:h-64 chart, so stacked charts don't jump on mount. */}
      <Surface className="flex min-h-[18rem] items-center justify-center sm:min-h-[21rem]">
        <div className="h-40 w-full animate-pulse rounded-lg bg-secondary/35" aria-hidden="true" />
        <span className="sr-only">Chart loads when it nears the viewport.</span>
      </Surface>
    </div>
  );
};

export default EmbeddedModelChart;
