import { memo } from "react";

export interface SparklinePoint {
  score: number;
  isCarryForward: boolean;
}

interface SparklineProps {
  data: SparklinePoint[];
  accent: string;
}

// Internal coordinate space. The SVG scales to the card via
// preserveAspectRatio="none"; the line/dot strokes use vector-effect
// non-scaling-stroke so thickness stays uniform regardless of card width.
// Aspect (~6.25:1) is picked close to the real container (h-12 in a p-6 card)
// so carry-forward markers stay near-circular.
const VB_W = 300;
const VB_H = 48;
const PAD_X = 4;
const PAD_Y = 4;
// Matches the previous recharts YAxis domain (["dataMin - 5", "dataMax + 5"]).
const DOMAIN_PAD = 5;

interface Pt {
  x: number;
  y: number;
}

// Monotone cubic interpolation (Fritsch–Carlson), the same family as recharts'
// `type="monotone"` — smooth, with no overshoot on flat or reversing segments.
function monotonePath(pts: Pt[]): string {
  const n = pts.length;
  if (n < 2) return "";
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1].x - pts[i].x;
    dx.push(h);
    slope.push(h === 0 ? 0 : (pts[i + 1].y - pts[i].y) / h);
  }

  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    const cp1x = pts[i].x + h / 3;
    const cp1y = pts[i].y + (m[i] * h) / 3;
    const cp2x = pts[i + 1].x - h / 3;
    const cp2y = pts[i + 1].y - (m[i + 1] * h) / 3;
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${pts[i + 1].x} ${pts[i + 1].y}`;
  }
  return d;
}

const Sparkline = memo(({ data, accent }: SparklineProps) => {
  const n = data.length;
  if (n < 2) return null;

  const scores = data.map((p) => p.score);
  const domainMin = Math.min(...scores) - DOMAIN_PAD;
  const domainMax = Math.max(...scores) + DOMAIN_PAD;
  const range = domainMax - domainMin || 1;

  const innerW = VB_W - PAD_X * 2;
  const innerH = VB_H - PAD_Y * 2;
  const pts: Pt[] = data.map((p, i) => ({
    x: PAD_X + (i / (n - 1)) * innerW,
    y: PAD_Y + (1 - (p.score - domainMin) / range) * innerH,
  }));

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      role="presentation"
    >
      <path
        d={monotonePath(pts)}
        fill="none"
        stroke={accent}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {pts.map((pt, i) =>
        data[i].isCarryForward ? (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={2.5}
            fill="none"
            stroke={accent}
            strokeWidth={1}
            strokeDasharray="2 1.5"
            vectorEffect="non-scaling-stroke"
          />
        ) : null
      )}
    </svg>
  );
});
Sparkline.displayName = "Sparkline";

export default Sparkline;
