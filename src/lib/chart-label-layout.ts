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
  /** Markers at or past this day prefer to draw their label left of the line. */
  flipAfterDay: number;
}

export type EventLabelSide = "left" | "right";

/** Where a kept label sits: which side of its line, and which text row. */
export interface EventLabelPlacement {
  side: EventLabelSide;
  /** 0 = top row; 1 = one line lower, used when the top row is taken. */
  row: number;
}

const EVENT_LABEL_ROWS = 2;

interface Span {
  start: number;
  end: number;
}

interface PlacedSpan extends Span {
  row: number;
}

function labelWidth(text: string): number {
  return text.length * LABEL_CHAR_WIDTH_PX + LABEL_PADDING_PX;
}

function labelSpan(marker: EventLabelMarker, side: EventLabelSide, layout: EventLabelLayout): Span {
  const pxPerDay = layout.plotWidth / Math.max(layout.dayCount - 1, 1);
  const x = marker.day * pxPerDay;
  const width = labelWidth(marker.text);
  if (side === "left") {
    return { start: x - width, end: x };
  }
  return { start: x, end: x + width };
}

function overlaps(a: Span, b: Span, gap = MIN_LABEL_GAP_PX): boolean {
  return a.start < b.end + gap && b.start < a.end + gap;
}

function insidePlot(span: Span, layout: EventLabelLayout): boolean {
  return span.start >= 0 && span.end <= layout.plotWidth;
}

function preferredSide(marker: EventLabelMarker, layout: EventLabelLayout): EventLabelSide {
  return marker.day >= layout.flipAfterDay ? "left" : "right";
}

// Candidate placements in preference order: the default side on the top row,
// the other side on the top row, then the same two on the next row down.
function candidates(marker: EventLabelMarker, layout: EventLabelLayout): EventLabelPlacement[] {
  const preferred = preferredSide(marker, layout);
  const other: EventLabelSide = preferred === "left" ? "right" : "left";
  const placements: EventLabelPlacement[] = [];
  for (let row = 0; row < EVENT_LABEL_ROWS; row++) {
    placements.push({ side: preferred, row }, { side: other, row });
  }
  return placements;
}

/**
 * Placement for every marker whose label fits without touching another
 * kept label. A label that collides first tries the other side of its line,
 * then a second row; only when all four spots are taken is it dropped (the
 * legend under the chart still names it). Newest markers place first: the
 * latest launch is usually the one the reader came to see.
 *
 *   Sep 22 Opus            Sep 28 Sonnet
 *   [Opus 5.5] |  [Sonnet 5.5] |        <- both on the top row, Opus flipped
 */
export function pickEventLabels(
  markers: EventLabelMarker[],
  layout: EventLabelLayout,
): Map<number, EventLabelPlacement> {
  const kept = new Map<number, EventLabelPlacement>();
  const keptSpans: PlacedSpan[] = [];
  const newestFirst = [...markers].sort((a, b) => b.day - a.day);

  for (const marker of newestFirst) {
    const preferred = preferredSide(marker, layout);
    // On a lower row, a side that sits under another label reads as part of
    // it, so try the side clear of every kept label first.
    const underAnother = (p: EventLabelPlacement) =>
      p.row > 0 && keptSpans.some((other) => overlaps(labelSpan(marker, p.side, layout), other, 0));
    const ordered = candidates(marker, layout).sort(
      (a, b) => a.row - b.row || Number(underAnother(a)) - Number(underAnother(b)),
    );

    for (const placement of ordered) {
      const span = labelSpan(marker, placement.side, layout);
      // The default side always fits by construction of flipAfterDay; a
      // flipped label must stay inside the plot.
      if (placement.side !== preferred && !insidePlot(span, layout)) {
        continue;
      }
      const taken = keptSpans.some((other) => other.row === placement.row && overlaps(span, other));
      if (taken) {
        continue;
      }
      kept.set(marker.index, placement);
      keptSpans.push({ ...span, row: placement.row });
      break;
    }
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
