export const Shimmer = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded-lg bg-secondary/35 ${className}`} />
);

// Mirrors ModelCard's anatomy (label / name+score / sparkline / meta /
// complaint row) so the loaded card lands in place instead of reflowing.
// The sentiment strip is positioned exactly as ModelCard positions it —
// absolute, so it contributes no flow height, and a left rail on mobile that
// becomes a top bar at `sm`. This is the single card skeleton for both `/` and
// `/dashboard`; they render the identical ModelCard, so they must not have
// differently-shaped placeholders.
export const CardSkeleton = () => (
  <div className="glass relative min-h-56 overflow-hidden rounded-xl sm:min-h-64">
    <Shimmer className="absolute inset-y-0 left-0 w-[3px] rounded-none sm:inset-x-0 sm:bottom-auto sm:h-1.5 sm:w-auto" />
    {/* Shimmer heights are ModelCard's real line boxes: text-mono-cap 11px x
        1.5 = 17, text-score 48px x 1 = 48, text-body 14px x 1.55 = 22. */}
    <div className="px-5 py-4 sm:p-6">
      <Shimmer className="h-[17px] w-24" />
      <div className="mt-1 flex items-start justify-between gap-3">
        <Shimmer className="h-[27px] w-28" />
        <Shimmer className="h-12 w-14" />
      </div>
      <Shimmer className="mt-3 h-10 w-full sm:mt-4 sm:h-12" />
      <Shimmer className="mt-2.5 h-[17px] w-36 sm:mt-3" />
      <div className="mt-3 border-t border-border pt-3 sm:mt-4">
        <Shimmer className="h-[22px] w-40" />
      </div>
    </div>
  </div>
);

export const RumorCardSkeleton = () => (
  <div className="glass space-y-4 rounded-xl p-4 sm:p-6">
    <div className="flex justify-between">
      <Shimmer className="h-3.5 w-24" />
      <Shimmer className="h-3.5 w-28" />
    </div>
    <Shimmer className="h-6 w-40" />
    <div className="space-y-2">
      <Shimmer className="h-4 w-full" />
      <Shimmer className="h-4 w-3/4" />
    </div>
    <Shimmer className="h-4 w-48" />
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex justify-between">
        <Shimmer className="h-3 w-28" />
        <Shimmer className="h-3 w-32" />
      </div>
      <Shimmer className="h-1 w-full rounded-full" />
      <Shimmer className="h-3 w-44" />
      <Shimmer className="h-3 w-36" />
    </div>
  </div>
);

export const ChatterSkeleton = () => (
  <div className="glass rounded-lg p-4 flex flex-col gap-2">
    <Shimmer className="h-3 w-40" />
    <Shimmer className="h-4 w-full" />
    <Shimmer className="h-4 w-2/3" />
  </div>
);

// The real panel is SectionHeader (title only, no meta line) + an h-64 chart +
// a row of FilterChips. Chips are h-11, not h-8: FilterChip enforces min-h-11
// for touch. An earlier version also carried a phantom subtitle Shimmer that
// had no counterpart in the loaded markup.
export const ChartSkeleton = () => (
  <div>
    <Shimmer className="mb-4 h-[23px] w-36" />
    <Shimmer className="h-64 w-full" />
    <div className="mt-4 flex gap-2">
      <Shimmer className="h-11 w-14" />
      <Shimmer className="h-11 w-14" />
      <Shimmer className="h-11 w-14" />
    </div>
  </div>
);

export const BarsSkeleton = ({ count = 4 }: { count?: number }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="space-y-1">
        <div className="flex justify-between">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-3 w-8" />
        </div>
        {/* h-1 matches BarList's real track height; h-2 made every row settle
            4px shorter the moment data arrived. */}
        <Shimmer className="h-1 w-full" />
      </div>
    ))}
  </div>
);

// StatusCard's loaded rows are tag + date + title (`py-3`), never bars — it
// previously borrowed BarsSkeleton, which is both the wrong shape and roughly
// half the height of a real event row.
export const StatusEventsSkeleton = ({ count = 3 }: { count?: number }) => (
  <div className="divide-y divide-border">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="space-y-1.5 py-3">
        <div className="flex items-center gap-2">
          <Shimmer className="h-[22px] w-14 rounded-full" />
          <Shimmer className="h-3 w-12" />
        </div>
        <Shimmer className="h-[22px] w-full" />
      </div>
    ))}
  </div>
);
