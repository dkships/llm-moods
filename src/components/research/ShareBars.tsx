import Surface from "@/components/Surface";

/**
 * Static 100%-stacked horizontal bars for research articles: one row per
 * cohort (a launch window, a complaint group), one segment per category.
 * Data is a frozen snapshot baked into the article body, like
 * ArticleSeriesChart. Plain divs, no recharts, so it adds nothing to the
 * article chunk.
 */

export interface ShareLegendItem {
  key: string;
  label: string;
  color: string;
}

export interface ShareRow {
  label: string;
  /** Right-aligned context, e.g. "n = 122 posts". */
  detail?: string;
  /** Raw counts keyed by legend key; shares are computed per row. */
  counts: Record<string, number>;
}

interface ShareBarsProps {
  title: string;
  legend: ShareLegendItem[];
  rows: ShareRow[];
  /** Accessible one-sentence description of what the chart shows. */
  ariaLabel: string;
}

function toShares(row: ShareRow, legend: ShareLegendItem[]) {
  const total = legend.reduce((sum, item) => sum + (row.counts[item.key] ?? 0), 0);
  return legend.map((item) => {
    const count = row.counts[item.key] ?? 0;
    const pct = total > 0 ? (count / total) * 100 : 0;
    return { ...item, pct };
  });
}

const ShareBars = ({ title, legend, rows, ariaLabel }: ShareBarsProps) => (
  <Surface className="my-6">
    <figure role="img" aria-label={ariaLabel} className="m-0">
      <figcaption className="mt-0 text-mono-cap text-text-tertiary">{title}</figcaption>

      <ul className="mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-meta text-text-secondary" aria-hidden="true">
        {legend.map((item) => (
          <li key={item.key} className="m-0 flex items-center gap-1.5 p-0">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />
            {item.label}
          </li>
        ))}
      </ul>

      <div className="mt-5 space-y-5" aria-hidden="true">
        {rows.map((row) => {
          const shares = toShares(row, legend);
          return (
            <div key={row.label}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-meta">
                <span className="text-foreground">{row.label}</span>
                {row.detail ? <span className="text-text-tertiary">{row.detail}</span> : null}
              </div>

              <div className="flex h-3 w-full overflow-hidden rounded-full bg-track">
                {shares.map((segment) => (
                  <div
                    key={segment.key}
                    className="h-full"
                    style={{ width: `${segment.pct}%`, background: segment.color }}
                  />
                ))}
              </div>

              <div className="mt-1.5 flex flex-wrap gap-x-4 text-meta text-text-tertiary">
                {shares.map((segment) => (
                  <span key={segment.key}>
                    <span className="text-foreground">{Math.round(segment.pct)}%</span> {segment.label.toLowerCase()}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </figure>
  </Surface>
);

export default ShareBars;
