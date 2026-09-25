// Y-axis scale for the sentiment charts. Lives outside VibesChart so a page
// can compute one shared domain for several charts (Compare) without pulling
// the lazily loaded chart bundle into its own chunk.

export type YDomain = [number, number];

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const DOMAIN_PAD = 5;
const DOMAIN_SNAP = 5;
const MIN_DOMAIN_SPAN = 30;
const EMPTY_DOMAIN: YDomain = [20, 100];

// Tick steps: 10 for the usual 30–60 point window, 25 once the window is wide
// enough that 10-point ticks would crowd a short chart.
const FINE_TICK_STEP = 10;
const COARSE_TICK_STEP = 25;
const MAX_FINE_TICK_SPAN = 60;

export function computeYDomain(data: { score: number | null }[]): YDomain {
  // Auto-scale around the visible data with a 5-point pad and snap to multiples of 5.
  // Always cap to [0, 100] since scores can never exceed that range.
  const scores = data.map((d) => d.score).filter((v): v is number => typeof v === "number");
  if (scores.length === 0) {
    return EMPTY_DOMAIN;
  }

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const lo = Math.max(SCORE_MIN, Math.floor((min - DOMAIN_PAD) / DOMAIN_SNAP) * DOMAIN_SNAP);
  const hi = Math.min(SCORE_MAX, Math.ceil((max + DOMAIN_PAD) / DOMAIN_SNAP) * DOMAIN_SNAP);

  // Keep at least a 30-point span so a flat day doesn't crush the line.
  if (hi - lo < MIN_DOMAIN_SPAN) {
    const mid = (hi + lo) / 2;
    const half = MIN_DOMAIN_SPAN / 2;
    return [
      Math.max(SCORE_MIN, Math.round((mid - half) / DOMAIN_SNAP) * DOMAIN_SNAP),
      Math.min(SCORE_MAX, Math.round((mid + half) / DOMAIN_SNAP) * DOMAIN_SNAP),
    ];
  }
  return [lo, hi];
}

// Evenly stepped ticks inside the domain, e.g. [25, 75] -> [30, 40, 50, 60, 70].
// Recharts' own tick picker lands on uneven values (75/55/40/25) for these
// narrow, 5-snapped domains.
export function computeYTicks([lo, hi]: YDomain): number[] {
  const step = hi - lo > MAX_FINE_TICK_SPAN ? COARSE_TICK_STEP : FINE_TICK_STEP;
  const ticks: number[] = [];
  for (let tick = Math.ceil(lo / step) * step; tick <= hi; tick += step) {
    ticks.push(tick);
  }
  return ticks;
}
