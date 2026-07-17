export const Shimmer = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded-lg bg-secondary/35 ${className}`} />
);

// Mirrors ModelCard's anatomy (label / name+score / sparkline / meta /
// complaint row) so the loaded card lands in place instead of reflowing.
export const CardSkeleton = () => (
  <div className="glass min-h-56 overflow-hidden rounded-xl sm:min-h-64">
    <Shimmer className="hidden h-1.5 rounded-none sm:block" />
    <div className="px-5 py-4 sm:p-6">
      <Shimmer className="h-3.5 w-24" />
      <div className="mt-2 flex items-start justify-between gap-3">
        <Shimmer className="h-6 w-28" />
        <Shimmer className="h-9 w-14" />
      </div>
      <Shimmer className="mt-3 h-10 w-full sm:mt-4 sm:h-12" />
      <Shimmer className="mt-3 h-3.5 w-36" />
      <div className="mt-3 border-t border-border pt-3 sm:mt-4">
        <Shimmer className="h-4 w-40" />
      </div>
    </div>
  </div>
);

export const DashboardCardSkeleton = () => (
  <div className="glass min-h-56 overflow-hidden rounded-xl sm:min-h-64">
    <Shimmer className="h-1.5 rounded-none" />
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex justify-between">
        <div className="space-y-2">
          <Shimmer className="h-5 w-24" />
          <Shimmer className="h-4 w-32" />
        </div>
        <div className="space-y-1">
          <Shimmer className="h-10 w-16 ml-auto" />
          <Shimmer className="h-3 w-10 ml-auto" />
        </div>
      </div>
      <Shimmer className="h-12 w-full" />
      <div className="flex justify-between">
        <Shimmer className="h-3 w-32" />
        <Shimmer className="h-3 w-24" />
      </div>
      <Shimmer className="h-3 w-40" />
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

export const ChartSkeleton = () => (
  <div className="space-y-4">
    <Shimmer className="h-5 w-36" />
    <Shimmer className="h-3 w-24" />
    <Shimmer className="h-64 w-full" />
    <div className="flex gap-2">
      <Shimmer className="h-8 w-12" />
      <Shimmer className="h-8 w-12" />
      <Shimmer className="h-8 w-12" />
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
        <Shimmer className="h-2 w-full" />
      </div>
    ))}
  </div>
);
