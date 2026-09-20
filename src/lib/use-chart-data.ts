import { useMemo } from "react";
import { getPacificDateLabel } from "@/lib/pacific-day";
import { getEventColor, getEventsForModel, type VendorEventType } from "@/data/vendor-events";
import type { VendorStatusEvent } from "@/hooks/useVendorStatus";
import type { ChartEventKind, ChartEventMarker } from "@/components/VibesChart";

export interface VibesHistoryRow {
  period_start: string;
  score: number;
  total_posts?: number | null;
  eligible_posts?: number | null;
  score_basis_status?: string | null;
  queued_posts?: number | null;
  failed_posts?: number | null;
  classification_coverage?: number | null;
}

export interface DailyChartPoint {
  day: string;
  score: number | null;
  /** Marks days where the aggregator carried yesterday's score forward
   * because zero posts were scraped. Renders distinctly so a stale point
   * isn't read as a real measurement. */
  isCarryForward?: boolean;
  /** The current Pacific day. Scrapers are still filling it, so the score is
   * provisional: the chart draws it as a dashed tail, never as a settled point. */
  isProvisional?: boolean;
  /** Eligible posts (confidence ≥ 0.65) for this day. Null pre-backfill;
   * confidence chip on the tooltip coerces null → 0 → "Preliminary". */
  eligiblePosts?: number | null;
  scoreBasisStatus?: string | null;
  queuedPosts?: number | null;
  /** Posts that exhausted classification retries on this day; surfaced as
   * "abandoned" in tooltips. Distinct from queuedPosts so the user sees
   * dead posts separately from work-in-progress. */
  failedPosts?: number | null;
  classificationCoverage?: number | null;
}

export interface DailyChartData {
  chartData: DailyChartPoint[];
  dateLabels: Record<string, string>;
}

/**
 * Build a complete N-day daily chart from a sparse vibes_scores history.
 * Missing days render as null gaps. The most recent Pacific day is labeled "Today".
 *
 * Used by /model/:slug (7d/30d ranges) and the embedded chart on research
 * articles. The 24h hourly view computes its own data inline since it has
 * different label semantics.
 *
 * When `anchorDate` is provided, the day grid is generated N days back from
 * that anchor (inclusive) rather than from `new Date()`. Research articles use
 * this to pin a chart to a fixed historical window so the visual stays aligned
 * with the article's prose even years later.
 */
export function useDailyChartData(
  history: VibesHistoryRow[] | undefined,
  days: number,
  anchorDate?: Date,
): DailyChartData {
  const anchorMs = anchorDate?.getTime() ?? null;
  return useMemo(() => {
    const rows = history ?? [];
    const emptyLabels: Record<string, string> = {};
    if (rows.length === 0) return { chartData: [], dateLabels: emptyLabels };

    const rowByDate = new Map<string, VibesHistoryRow>();
    for (const v of rows) {
      const key = new Date(v.period_start).toISOString().slice(0, 10);
      rowByDate.set(key, v);
    }

    const todayPacific = getPacificDateLabel(new Date());
    // Live charts anchor on the current *Pacific* day, not the UTC day —
    // from 5pm PT the UTC date is already tomorrow, which used to render a
    // phantom empty rightmost day and push "Today" one slot in.
    const anchor = anchorMs != null ? new Date(anchorMs) : new Date(`${todayPacific}T00:00:00Z`);
    const result: DailyChartPoint[] = [];
    const labels: Record<string, string> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - i));
      const key = d.toISOString().slice(0, 10);
      const label =
        key === todayPacific
          ? "Today"
          : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      const row = rowByDate.get(key);
      result.push({
        day: label,
        score: row?.score ?? null,
        isCarryForward: row != null && (row.score_basis_status === "carried_forward" || row.total_posts === 0),
        isProvisional: anchorMs == null && key === todayPacific,
        eligiblePosts: row?.eligible_posts ?? null,
        scoreBasisStatus: row?.score_basis_status ?? null,
        queuedPosts: row?.queued_posts ?? null,
        failedPosts: row?.failed_posts ?? null,
        classificationCoverage: row?.classification_coverage ?? null,
      });
      labels[key] = label;
    }
    return { chartData: result, dateLabels: labels };
  }, [history, days, anchorMs]);
}

/**
 * Map vendor events to the chart's date-label space, clamping to visible
 * range and snapping to the nearest day on missing-data gaps.
 */
export function useChartEvents(
  modelSlug: string,
  dateLabels: Record<string, string>,
): ChartEventMarker[] {
  return useMemo(() => {
    const visibleKeys = Object.keys(dateLabels);
    if (visibleKeys.length === 0) return [];
    const minKey = visibleKeys[0];
    const maxKey = visibleKeys[visibleKeys.length - 1];

    const findLabelOnOrAfter = (iso: string): string | null => {
      if (iso < minKey) return dateLabels[minKey];
      if (iso > maxKey) return null;
      if (dateLabels[iso]) return dateLabels[iso];
      for (const k of visibleKeys) {
        if (k >= iso) return dateLabels[k];
      }
      return null;
    };
    const findLabelOnOrBefore = (iso: string): string | null => {
      if (iso > maxKey) return dateLabels[maxKey];
      if (iso < minKey) return null;
      if (dateLabels[iso]) return dateLabels[iso];
      for (let i = visibleKeys.length - 1; i >= 0; i--) {
        if (visibleKeys[i] <= iso) return dateLabels[visibleKeys[i]];
      }
      return null;
    };

    const markers: ChartEventMarker[] = [];
    for (const event of getEventsForModel(modelSlug)) {
      const startIso = event.eventDate;
      const endIso = event.eventEndDate ?? event.eventDate;
      if (endIso < minKey || startIso > maxKey) continue;

      const startLabel = findLabelOnOrAfter(startIso);
      const endLabel = findLabelOnOrBefore(endIso);
      if (!startLabel || !endLabel) continue;

      markers.push({
        startLabel,
        endLabel: startLabel === endLabel ? undefined : endLabel,
        color: getEventColor(event.eventType),
        title: event.title,
        kind: eventKindFor(event.eventType),
        shortLabel: shortLabelFor(event.title, event.eventType),
      });
    }
    return markers;
  }, [modelSlug, dateLabels]);
}

const EVENT_KIND_BY_TYPE: Record<VendorEventType, ChartEventKind> = {
  model_launch: "launch",
  known_regression: "regression",
  outage: "incident",
  incident_observed: "incident",
  postmortem: "note",
  pricing_change: "note",
  infrastructure_change: "note",
};

function eventKindFor(type: VendorEventType): ChartEventKind {
  return EVENT_KIND_BY_TYPE[type];
}

// Only launches get an on-chart label: they are the events readers most want
// to line up against the score, and a 30-day window rarely holds more than
// two. Everything else stays a bare marker and is named in the legend.
const LAUNCH_TITLE_SUFFIX = / launch$/i;

function shortLabelFor(title: string, type: VendorEventType): string | undefined {
  if (type !== "model_launch") return undefined;
  return title.replace(LAUNCH_TITLE_SUFFIX, "");
}

// Severities worth drawing on the score chart. "minor" and "maintenance"
// happen weekly and would bury the line in markers; the status panel still
// lists them.
const CHARTED_STATUS_SEVERITIES = new Set(["critical", "major"]);
const INCIDENT_MARKER_COLOR = getEventColor("outage");

/**
 * Map official status-page incidents onto the chart's date-label space so
 * downtime shows up next to the score without anyone hand-editing the
 * timeline. Each incident is a single-day marker on its Pacific day.
 */
export function useStatusIncidentMarkers(
  statusEvents: VendorStatusEvent[] | undefined,
  dateLabels: Record<string, string>,
): ChartEventMarker[] {
  return useMemo(() => {
    if (!statusEvents?.length) return [];
    const markers: ChartEventMarker[] = [];
    const seenDays = new Set<string>();
    for (const incident of statusEvents) {
      if (!CHARTED_STATUS_SEVERITIES.has(incident.severity)) continue;
      const iso = getPacificDateLabel(new Date(incident.updatedAt));
      const label = dateLabels[iso];
      if (!label) continue;
      // Several updates of one incident land on the same day; one marker is enough.
      const dedupeKey = `${iso}|${incident.title}`;
      if (seenDays.has(dedupeKey)) continue;
      seenDays.add(dedupeKey);
      markers.push({
        startLabel: label,
        color: INCIDENT_MARKER_COLOR,
        title: incident.title,
        kind: "incident",
      });
    }
    return markers;
  }, [statusEvents, dateLabels]);
}
