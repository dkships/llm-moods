import Surface from "@/components/Surface";

interface StatCalloutItem {
  value: string;
  label: string;
}

interface StatCalloutProps {
  stats: [StatCalloutItem, StatCalloutItem];
}

const StatCallout = ({ stats }: StatCalloutProps) => (
  <Surface motion="fade" className="my-6">
    <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt className="font-mono text-xs uppercase tracking-[0.12em] text-text-tertiary">{stat.label}</dt>
          <dd className="mt-2 font-display text-4xl font-bold leading-none text-foreground sm:text-5xl">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  </Surface>
);

export default StatCallout;
