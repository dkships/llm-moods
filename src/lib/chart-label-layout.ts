/**
 * Collision-aware placement for the text drawn inside the score chart.
 *
 * Recharts places reference-line labels blindly, so two launch labels can
 * land on top of each other and the "balanced" midline label can sit under
 * the score line. These helpers estimate each label's box in plot pixels
 * (labels use a monospace face, so width is a character count) and pick
 * placements that stay clear.
 */

// JetBrains Mono advances ~0.6em per glyph; labels are 10px.
const LABEL_CHAR_WIDTH_PX = 6;
const LABEL_HEIGHT_PX = 14;
// Recharts insets inside* labels by an offset; count it plus breathing room.
const LABEL_PADDING_PX = 10;
const MIN_LABEL_GAP_PX = 8;

export interface EventLabelMarker {
  /** Caller's index for the event; returned in the kept set. */
  index: number;
  /** Day position of the marker in the chart's series. */
  day: number;
  text: string;
}

export interface EventLabelLayout {
  dayCount: number;
  plotWidth: number;
  /** Markers at or past this day draw their label to the left of the line. */
  flipAfterDay: number;
}

interface Span {
  start: number;
  end: number;
}

function labelWidth(text: string): number {
  return text.length * LABEL_CHAR_WIDTH_PX + LABEL_PADDING_PX;
}

function labelSpan(marker: EventLabelMarker, layout: EventLabelLayout): Span {
  const pxPerDay = layout.plotWidth / Math.max(layout.dayCount - 1, 1);
  const x = marker.day * pxPerDay;
  const width = labelWidth(marker.text);
  if (marker.day >= layout.flipAfterDay) {
    return { start: x - width, end: x };
  }
  return { start: x, end: x + width };
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end + MIN_LABEL_GAP_PX && b.start < a.end + MIN_LABEL_GAP_PX;
}

/**
 * Indexes of markers whose label fits without touching another kept label.
 * Newest markers win a collision: the latest launch is usually the one the
 * reader came to see.
 */
export function pickEventLabels(markers: EventLabelMarker[], layout: EventLabelLayout): Set<number> {
  const kept = new Set<number>();
  const keptSpans: Span[] = [];
  const newestFirst = [...markers].sort((a, b) => b.day - a.day);

  for (const marker of newestFirst) {
    const span = labelSpan(marker, layout);
    if (keptSpans.some((other) => overlaps(span, other))) {
      continue;
    }
    kept.add(marker.index);
    keptSpans.push(span);
  }
  return kept;
}

export type MidlineSide = "above" | "below";

export interface MidlineSpot {
  /** Day the label's left edge sits on. */
  startDay: number;
  side: MidlineSide;
}

export interface MidlinePlot {
  yDomain: [number, number];
  plotWidth: number;
  plotHeight: number;
  midline?: number;
  text?: string;
  /** Days carrying an event marker line; the label won't sit on one. */
  markerDays?: number[];
}

const DEFAULT_SPOT: MidlineSpot = { startDay: 0, side: "above" };

// True when the line between consecutive points passes through the band.
function lineEntersBand(scores: (number | null)[], from: number, to: number, band: Span): boolean {
  for (let i = from; i <= to; i++) {
    const a = scores[i];
    const b = i + 1 <= to ? scores[i + 1] : a;
    if (a == null || b == null) {
      continue;
    }
    if (Math.min(a, b) <= band.end && Math.max(a, b) >= band.start) {
      return true;
    }
  }
  return false;
}

/**
 * Where to write the midline label so the score line doesn't run through
 * it or an event marker. Prefers the left edge and the space above the line,
 * then slides right until a clear window turns up. Falls back to the left edge if none does.
 */
export function pickMidlineSpot(scores: (number | null)[], plot: MidlinePlot): MidlineSpot {
  const midline = plot.midline ?? 50;
  const text = plot.text ?? "balanced";
  const last = scores.length - 1;
  if (last < 1 || plot.plotHeight <= 0 || plot.plotWidth <= 0) {
    return DEFAULT_SPOT;
  }

  const pxPerDay = plot.plotWidth / last;
  const labelDays = Math.ceil(labelWidth(text) / pxPerDay);
  const scorePerPx = (plot.yDomain[1] - plot.yDomain[0]) / plot.plotHeight;
  const bandScore = LABEL_HEIGHT_PX * scorePerPx;
  const bands: Record<MidlineSide, Span> = {
    above: { start: midline, end: midline + bandScore },
    below: { start: midline - bandScore, end: midline },
  };

  const markerDays = plot.markerDays ?? [];
  for (let startDay = 0; startDay + labelDays <= last; startDay++) {
    const endDay = startDay + labelDays;
    if (markerDays.some((day) => day >= startDay && day <= endDay)) {
      continue;
    }
    for (const side of ["above", "below"] as const) {
      if (!lineEntersBand(scores, startDay, startDay + labelDays, bands[side])) {
        return { startDay, side };
      }
    }
  }
  return DEFAULT_SPOT;
}
