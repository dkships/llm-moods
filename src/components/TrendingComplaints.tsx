import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import Surface from "@/components/Surface";
import SectionHeader from "@/components/SectionHeader";
import { Shimmer } from "@/components/Skeletons";
import { formatComplaintLabel } from "@/lib/vibes";
import { normalizePublicComplaintCategory } from "@/shared/public-taxonomy";

interface TrendingItem {
  model_id: string;
  model_name: string;
  model_slug: string;
  accent_color: string;
  category: string;
  this_week: number;
  last_week: number;
  pct_change: number;
}

// The volume bar is hidden below `sm` — at 375px the four-column grid leaves
// the topic label only a few characters before truncation.
//
// Above `sm` the topic column is capped at 1fr against a 2fr volume column.
// It used to be 1.4fr against 1fr, which on a 1400px container gave the topic
// label ~640px to hold a ~130px string — a dead gap down the middle of the
// card. Letting the bar rail take the slack keeps the row visually connected.
const GRID_COLS =
  "grid grid-cols-[1.4fr_72px_56px] sm:grid-cols-[minmax(0,1fr)_88px_minmax(0,2fr)_64px] items-center gap-3 sm:gap-4";

function useTrendingComplaints() {
  return useQuery({
    queryKey: ["trending-complaints"],
    staleTime: 10 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_trending_complaints");
      if (error) throw error;
      return (data || []) as TrendingItem[];
    },
  });
}

function pickTopPerModel(items: TrendingItem[]): TrendingItem[] {
  const seen = new Map<string, TrendingItem>();
  for (const item of items) {
    if (!seen.has(item.model_id)) {
      seen.set(item.model_id, item);
    }
  }
  return Array.from(seen.values());
}

function changeToneClass(pct: number): string {
  // `-text` variant, not plain `text-destructive`: this renders at 12px, where
  // the base token only reaches 4.16:1 on --card and misses AA.
  if (pct > 30) return "text-destructive-text";
  if (pct > 0) return "text-warning";
  if (pct < 0) return "text-primary";
  return "text-text-secondary";
}

const TrendingComplaints = () => {
  const { data, isLoading, isError } = useTrendingComplaints();

  if (isLoading) {
    // Mirrors the loaded markup exactly — same SectionHeader, same GRID_COLS
    // header row, same four `py-2.5` two-line rows (one per tracked model).
    // The old skeleton was three flat h-8 bars with no header row, so the whole
    // dashboard below this card shifted when the data landed.
    return (
      <Surface role="status" aria-live="polite">
        <span className="sr-only">Loading trending complaints</span>
        <div className="animate-pulse" aria-hidden="true">
          {/* Matches SectionHeader's box (mb-4 + a text-section-height row)
              without an <h2>, so the skeleton never emits an empty heading. */}
          {/* Heights below are the real line boxes, not eyeballed: text-section
              18px x 1.5 = 27, text-mono-cap 11px x 1.5 = 17, text-body 14px x
              1.55 = 22. Matching them keeps this card the same height loading
              and loaded, so nothing downstream on the dashboard moves. */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <Shimmer className="h-[27px] w-44" />
            <Shimmer className="h-[17px] w-24" />
          </div>
          <div className="mt-2">
            <div className={`${GRID_COLS} border-b border-border pb-2`}>
              <Shimmer className="h-[17px] w-12" />
              <Shimmer className="h-[17px] w-full" />
              <Shimmer className="hidden h-[17px] w-14 sm:block" />
              <Shimmer className="h-[17px] w-full" />
            </div>
            <div className="divide-y divide-border">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`${GRID_COLS} py-2.5`}>
                  {/* 22 (topic) + 17 (model name) = the real two-line block */}
                  <div className="flex h-[39px] min-w-0 flex-col justify-between">
                    <Shimmer className="h-[18px] w-28" />
                    <Shimmer className="h-[14px] w-16" />
                  </div>
                  <Shimmer className="h-[17px] w-full" />
                  <Shimmer className="hidden h-1 w-full rounded-full sm:block" />
                  <Shimmer className="h-[17px] w-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Surface>
    );
  }

  if (isError) {
    return (
      <Surface>
        <SectionHeader title="Trending complaints" />
        <p className="py-8 text-center text-body text-text-tertiary" role="status" aria-live="polite">
          Couldn't load complaint trends.
        </p>
      </Surface>
    );
  }

  const topMovers = pickTopPerModel(
    (data || []).filter((item) => normalizePublicComplaintCategory(item.category) !== null),
  );

  if (topMovers.length === 0) {
    return null;
  }

  const maxVolume = topMovers.reduce((m, row) => Math.max(m, row.this_week), 0);

  return (
    <Surface>
      <SectionHeader
        title="Trending complaints"
        action={<span className="text-mono-cap text-text-tertiary">vs prior week</span>}
      />

      <div className="mt-2">
        <div className={`${GRID_COLS} border-b border-border pb-2 text-mono-cap text-text-tertiary`}>
          <span>Topic</span>
          <span className="text-right">Mentions</span>
          <span className="hidden sm:block">Volume</span>
          <span className="text-right">Change</span>
        </div>

        <ul className="divide-y divide-border">
          {topMovers.map((item) => {
            const label = formatComplaintLabel(item.category);
            const pct = item.pct_change;
            const sign = pct > 0 ? "+" : pct < 0 ? "" : "";
            const widthPct = maxVolume > 0 ? Math.max(4, (item.this_week / maxVolume) * 100) : 0;

            return (
              <li
                key={`${item.model_id}-${item.category}`}
                className={`${GRID_COLS} py-2.5`}
              >
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-foreground">{label}</p>
                  <p className="text-mono-cap text-text-tertiary">{item.model_name}</p>
                </div>

                <span
                  className="text-right text-mono-cap text-text-secondary"
                  aria-label={`${item.this_week.toLocaleString()} mentions this week`}
                >
                  {item.this_week.toLocaleString()}
                </span>

                <div
                  className="hidden h-1 w-full overflow-hidden rounded-full bg-track sm:block"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-foreground/60"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>

                <span
                  className={`text-right text-meta font-semibold ${changeToneClass(pct)}`}
                  aria-label={`${pct >= 0 ? "up" : "down"} ${Math.abs(pct)} percent`}
                >
                  {sign}{pct}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Surface>
  );
};

export default TrendingComplaints;
