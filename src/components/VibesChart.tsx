import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, ReferenceLine } from "recharts";
import { memo } from "react";

// Theme colors — mapped from CSS variables (Recharts needs raw strings)
const CHART_COLORS = {
  mutedForeground: "hsl(220 10% 50%)",  // --muted-foreground
  card: "hsl(220 18% 10%)",             // --card
  border: "hsl(220 14% 18%)",           // --border
  referenceLine: "hsl(220 10% 25%)",    // between --border and --muted-foreground
} as const;

interface VibesChartProps {
  chartData: { day: string; score: number | null }[];
  accent: string;
  timeRange: string;
}

const VibesChart = memo(({ chartData, accent, timeRange }: VibesChartProps) => (
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 0, left: 0 }}>
      <XAxis
        dataKey="day"
        tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 10 }}
        axisLine={false}
        tickLine={false}
        interval={timeRange === "30d" ? Math.max(Math.floor(chartData.length / 5) - 1, 0) : timeRange === "7d" ? 0 : Math.max(Math.floor(chartData.length / 5) - 1, 0)}
        padding={{ left: 10, right: 10 }}
      />
      <YAxis
        domain={[20, 100]}
        tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 10 }}
        axisLine={false}
        tickLine={false}
        width={30}
      />
      <Tooltip
        contentStyle={{
          background: CHART_COLORS.card,
          border: `1px solid ${CHART_COLORS.border}`,
          borderRadius: 8,
          fontSize: 12,
          fontFamily: "JetBrains Mono, monospace",
        }}
        labelStyle={{ color: CHART_COLORS.mutedForeground }}
        itemStyle={{ color: accent }}
      />
      <ReferenceLine y={50} stroke={CHART_COLORS.referenceLine} strokeDasharray="4 4" />
      <Line
        type="monotone"
        dataKey="score"
        stroke={accent}
        strokeWidth={2.5}
        dot={false}
        activeDot={{ r: 4, fill: accent, strokeWidth: 0 }}
        connectNulls={false}
      />
    </LineChart>
  </ResponsiveContainer>
));
VibesChart.displayName = "VibesChart";

export default VibesChart;
