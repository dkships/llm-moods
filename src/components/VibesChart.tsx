import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, ReferenceLine } from "recharts";
import { memo } from "react";

interface VibesChartProps {
  chartData: { day: string; score: number }[];
  accent: string;
  timeRange: string;
}

const VibesChart = memo(({ chartData, accent, timeRange }: VibesChartProps) => (
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={chartData} margin={{ top: 5, right: 50, bottom: 0, left: 0 }}>
      <XAxis
        dataKey="day"
        tick={{ fill: "hsl(220 10% 50%)", fontSize: 10 }}
        axisLine={false}
        tickLine={false}
        interval={timeRange === "30d" ? Math.max(Math.floor(chartData.length / 5) - 1, 0) : timeRange === "7d" ? 0 : Math.max(Math.floor(chartData.length / 5) - 1, 0)}
        padding={{ left: 10, right: 40 }}
      />
      <YAxis
        domain={[20, 100]}
        tick={{ fill: "hsl(220 10% 50%)", fontSize: 10 }}
        axisLine={false}
        tickLine={false}
        width={30}
      />
      <Tooltip
        contentStyle={{
          background: "hsl(220 18% 10%)",
          border: "1px solid hsl(220 14% 18%)",
          borderRadius: 8,
          fontSize: 12,
          fontFamily: "JetBrains Mono, monospace",
        }}
        labelStyle={{ color: "hsl(220 10% 50%)" }}
        itemStyle={{ color: accent }}
      />
      <ReferenceLine y={50} stroke="hsl(220 10% 25%)" strokeDasharray="4 4" />
      <Line
        type="monotone"
        dataKey="score"
        stroke={accent}
        strokeWidth={2.5}
        dot={false}
        activeDot={{ r: 4, fill: accent, strokeWidth: 0 }}
      />
    </LineChart>
  </ResponsiveContainer>
));
VibesChart.displayName = "VibesChart";

export default VibesChart;
