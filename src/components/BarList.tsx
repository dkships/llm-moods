interface BarListItem {
  label: string;
  value: number; // 0–100 percentage, OR an absolute count
  secondary?: string; // optional right-side suffix, e.g. "%"
}

interface BarListProps {
  items: BarListItem[];
  max?: number; // when value is absolute, the max for scaling
  accent: string; // CSS color string (e.g. model.accent_color)
  /** When true, fade each bar's opacity by row index (ramp). */
  ramp?: boolean;
}

const RAMP = [1, 0.78, 0.6, 0.45, 0.32, 0.22];

const BarList = ({ items, max, accent, ramp = false }: BarListProps) => {
  const scaleMax = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-3">
      {items.map((row, i) => {
        const pct = Math.round((row.value / scaleMax) * 100);
        const opacity = ramp ? RAMP[Math.min(i, RAMP.length - 1)] : 0.85;
        return (
          <li key={row.label}>
            <div className="mb-1 flex items-baseline justify-between text-meta">
              <span className="text-text-tertiary">{row.label}</span>
              <span className="text-foreground">{row.secondary ?? `${pct}%`}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-border/60">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: accent, opacity }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default BarList;
