const Shimmer = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded-lg bg-secondary/60 ${className}`} />
);

export const CardSkeleton = () => (
  <div className="glass rounded-xl overflow-hidden">
    <Shimmer className="h-1 rounded-none" />
    <div className="p-5 space-y-3">
      <Shimmer className="h-4 w-20" />
      <Shimmer className="h-5 w-32" />
      <div className="flex justify-between">
        <Shimmer className="h-4 w-12" />
        <Shimmer className="h-4 w-24" />
      </div>
    </div>
  </div>
);

export const DashboardCardSkeleton = () => (
  <div className="glass rounded-xl overflow-hidden">
    <Shimmer className="h-1 rounded-none" />
    <div className="p-6 space-y-4">
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

export const ChatterSkeleton = () => (
  <div className="glass rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
    <Shimmer className="h-5 w-20 shrink-0" />
    <Shimmer className="h-4 flex-1" />
    <div className="flex items-center gap-2 shrink-0">
      <Shimmer className="h-4 w-16" />
      <Shimmer className="h-4 w-14" />
      <Shimmer className="h-4 w-10" />
    </div>
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
