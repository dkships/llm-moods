import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip as RechartsTooltip, ReferenceLine, ReferenceArea } from "recharts";
import { memo } from "react";

/**
 * Static single-series line chart for research-article data that isn't a model
 * sentiment score (share-of-voice, keyword-mention share, etc.). Data is a
 * frozen snapshot baked into the article body — research artifacts cite fixed
 * numbers, so this deliberately does NOT fetch live data the way
 * EmbeddedModelChart does. Styling mirrors VibesChart (mono ticks, recessive
 * axes, card tooltip, single accent stroke).
 */

const CHART_COLORS = {
  mutedForeground: "hsl(var(--muted-foreground))",
  card: "hsl(var(--card))",
  border: "hsl(var(--border))",
} as const;

export interface ArticleSeriesDatum {
  day: string;
  value: number | null;
}

export interface ArticleSeriesEvent {
  startDay: string;
  endDay?: string;
  color: string;
  title: string;
}

interface ArticleSeriesChartProps {
  data: ArticleSeriesDatum[];
  /** Short y-value unit rendered in the tooltip, e.g. "%" or " posts". */
  valueSuffix?: string;
  /** Accessible one-sentence description of what the chart shows. */
  ariaLabel: string;
  events?: ArticleSeriesEvent[];
  yDomain?: [number, number];
  height?: number;
}

interface SeriesTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ArticleSeriesDatum; value: number | null }>;
  label?: string;
  valueSuffix: string;
}

const SeriesTooltip = ({ active, payload, label, valueSuffix }: SeriesTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0].payload;
  if (datum.value == null) return null;
  return (
    <div
      style={{
        background: CHART_COLORS.card,
        border: `1px solid ${CHART_COLORS.border}`,
        borderRadius: 8,
        boxShadow: "var(--shadow-elevated)",
        padding: "9px 12px",
        fontSize: 12,
        fontFamily: "JetBrains Mono, monospace",
      }}
    >
      <p style={{ color: CHART_COLORS.mutedForeground, margin: 0 }}>{label}</p>
      <p style={{ color: "hsl(var(--primary))", margin: "2px 0 0" }}>
        {datum.value}
        {valueSuffix}
      </p>
    </div>
  );
};

const ArticleSeriesChart = memo(
  ({ data, valueSuffix = "", ariaLabel, events = [], yDomain, height = 220 }: ArticleSeriesChartProps) => {
    const values = data.map((d) => d.value).filter((v): v is number => typeof v === "number");
    const autoMax = values.length > 0 ? Math.ceil(Math.max(...values) * 1.15) : 10;
    const [yMin, yMax] = yDomain ?? [0, autoMax];
    return (
      <div role="img" aria-label={ariaLabel} className="my-6 w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} accessibilityLayer>
            <XAxis
              dataKey="day"
              tick={{ fill: CHART_COLORS.mutedForeground, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              // Width-aware thinning; see the same change in VibesChart. Labels
              // here are shorter (MM-DD via tickFormatter), so the gap is too.
              interval="preserveStartEnd"
              minTickGap={40}
              padding={{ left: 10, right: 10 }}
              tickFormatter={(day: string) => day.slice(5)}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: CHART_COLORS.mutedForeground, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickMargin={4}
              width={32}
            />
            <RechartsTooltip
              cursor={{ stroke: CHART_COLORS.border, strokeDasharray: "3 3" }}
              content={(props) => <SeriesTooltip {...(props as SeriesTooltipProps)} valueSuffix={valueSuffix} />}
            />
            {events.map((event, i) => {
              const isRange = event.endDay && event.endDay !== event.startDay;
              if (isRange) {
                return (
                  <ReferenceArea
                    key={`evt-${i}`}
                    x1={event.startDay}
                    x2={event.endDay}
                    y1={yMin}
                    y2={yMax}
                    fill={event.color}
                    fillOpacity={0.08}
                    stroke={event.color}
                    strokeOpacity={0.35}
                    ifOverflow="visible"
                  />
                );
              }
              return (
                <ReferenceLine
                  key={`evt-${i}`}
                  x={event.startDay}
                  stroke={event.color}
                  strokeDasharray="3 3"
                  strokeOpacity={0.7}
                  ifOverflow="visible"
                />
              );
            })}
            <Line
              type="monotone"
              dataKey="value"
              stroke="hsl(var(--primary))"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
              connectNulls={false}
              // JS-driven (rAF), so the global prefers-reduced-motion rule in
              // index.css cannot neutralise it. See VibesChart.
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  },
);
ArticleSeriesChart.displayName = "ArticleSeriesChart";

export default ArticleSeriesChart;
