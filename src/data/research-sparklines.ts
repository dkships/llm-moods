/**
 * Score lines for the /research index cards. Each series is copied from the
 * article's own companion CSV (public/research/<slug>/data.csv; the
 * cross-model post reuses claude-april-2026's), so a card shows the same
 * frozen snapshot its article is built on. Markers point at VENDOR_EVENTS ids
 * so dates live in one place. Posts without a dataset have no entry.
 */

export interface SparklineSeries {
  label: string;
  /** "primary" draws the accent stroke; "muted" draws a quiet comparison line. */
  emphasis: "primary" | "muted";
  /** One score per day from startDate; null where the day had no score. */
  scores: (number | null)[];
}

export interface ResearchSparkline {
  /** ISO date of the first score. */
  startDate: string;
  /** Plain-language description, used as the chart's accessible label. */
  caption: string;
  /** Short name of what the line measures, shown under the chart. */
  subject: string;
  series: SparklineSeries[];
  markers: { eventId: string; label: string }[];
}

export const RESEARCH_SPARKLINES: Record<string, ResearchSparkline> = {
  "opus-5-5-vs-opus-5-launch-sentiment-2026": {
    startDate: "2026-07-13",
    caption: "Claude daily score, Jul 13 – Sep 26, 2026",
    subject: "Claude daily score",
    series: [
      {
        label: "Claude",
        emphasis: "primary",
        scores:
        [50, 50, 53, 49, 42, 46, 50, 51, 59, 58, 61, 59, 60, 59, 51, 49, 46, 45, 44, 50, 49, 49, 50, 49,
        46, 46, 53, 51, 46, 48, 52, 49, 35, 44, 43, 44, 52, 37, 34, 33, 40, 38, 35, 35, 32, 39, 40, 38,
        37, 37, 41, 46, 49, 40, 41, 47, 46, 43, 37, 43, 47, 46, 47, 47, 43, 37, 43, 40, 30, 31, 43, 55,
        61, 67, 71, 69],
      },
    ],
    markers: [
      { eventId: "anthropic-opus-5-launch", label: "Opus 5" },
      { eventId: "anthropic-opus-5-5-launch", label: "Opus 5.5" },
    ],
  },
  "fable-5-lifecycle-june-july-2026": {
    startDate: "2026-06-01",
    caption: "Claude daily score, Jun 1 – Jul 16, 2026",
    subject: "Claude daily score",
    series: [
      {
        label: "Claude",
        emphasis: "primary",
        scores:
        [51, 48, 54, 53, 61, 60, 53, 53, 50, 47, 52, 49, 36, 56, 46, 38, 42, 41, 48, 51, 52, 53, 50, 55,
        51, 53, 52, 52, 46, 46, 53, 57, 58, 65, 60, 61, 60, 46, 50, 55, 52, 47, 50, 50, 52, 47],
      },
    ],
    markers: [
      { eventId: "anthropic-fable-5-launch", label: "Launch" },
      { eventId: "anthropic-fable-5-suspension", label: "Suspended" },
      { eventId: "anthropic-fable-5-redeploy", label: "Back" },
    ],
  },
  "grok-45-launch-july-2026": {
    startDate: "2026-06-01",
    caption: "Grok daily score, Jun 1 – Jul 16, 2026",
    subject: "Grok daily score",
    series: [
      {
        label: "Grok",
        emphasis: "primary",
        scores:
        [29, 39, 57, 23, 27, 26, 34, 45, 48, 31, 18, 17, 26, 28, 22, 33, 30, 28, 45, 29, 26, 19, 26, 25,
        28, 19, 15, 35, 18, 28, 49, 21, 44, 35, 27, 42, 30, 57, 54, 57, 54, 50, 47, 37, 47, 39],
      },
    ],
    markers: [
      { eventId: "xai-grok-4-5-launch", label: "Grok 4.5" },
    ],
  },
  "surface-segmentation-march-may-2026": {
    startDate: "2026-03-20",
    caption: "Claude Code daily score, Mar 20 – May 14, 2026",
    subject: "Claude Code daily score",
    series: [
      {
        label: "Claude Code",
        emphasis: "primary",
        scores:
        [66, 44, 71, 37, 100, null, 45, 47, 67, 56, 51, 52, 59, 50, 55, 43, 49, 29, 50, 22, 28, 16, 32,
        31, 29, 33, 66, 77, 79, 75, 54, 69, null, 50, 64, 48, 80, 61, null, 30, null, 18, 48, 49, 24,
        38, 63, 63, null, 90, 49, 70, 49, 46, 66, 67],
      },
    ],
    markers: [
      { eventId: "anthropic-2026-bug2-thinking-cache", label: "Cache bug" },
    ],
  },
  "claude-april-2026": {
    startDate: "2026-02-15",
    caption: "Claude daily score, Feb 15 – Apr 21, 2026",
    subject: "Claude daily score",
    series: [
      {
        label: "Claude",
        emphasis: "primary",
        scores:
        [70, 75, 72, 67, null, null, null, null, null, 60, null, null, null, 36, 32, null, 42, null, 30,
        40, 40, 40, 42, 31, 35, 26, 26, 26, 29, 17, 50, 40, 52, 51, 59, 56, 60, 61, 60, 53, 39, 51, 52,
        49, 42, 55, 46, 60, 54, 51, 50, 43, 44, 38, 40, 35, 33, 34, 26, 39, 44, 55, 49, 50, 39, 43],
      },
    ],
    markers: [
      { eventId: "anthropic-2026-bug2-thinking-cache", label: "Cache bug" },
    ],
  },
  "cross-model-deltas-march-april-2026": {
    startDate: "2026-02-15",
    caption: "Daily scores for all four models, Feb 15 – Apr 21, 2026",
    subject: "Claude vs the other three models",
    series: [
      {
        label: "ChatGPT",
        emphasis: "muted",
        scores:
        [80, 78, 81, 84, 50, null, 30, 18, 11, 47, null, 63, 42, 30, null, null, 33, 20, 12, 20, 30, 35,
        30, 26, 56, 30, 30, 30, 79, 72, 58, 35, 28, 18, 21, 28, 22, 19, 37, 19, 8, 20, 22, 23, 16, 18,
        32, 26, 30, 38, 50, 51, 59, 44, 43, 45, 49, 43, 57, 51, 45, 42, 39, 46, 39, 32],
      },
      {
        label: "Gemini",
        emphasis: "muted",
        scores:
        [73, 77, 75, 79, null, null, null, null, null, null, null, null, null, 47, null, null, null, 28,
        28, 28, 28, 48, 41, 41, 41, 65, 65, 65, 65, 65, 65, 65, 65, 29, 49, 48, 49, 53, 36, 36, 37, 38,
        51, 38, 37, 24, 35, 35, 50, 51, 34, 29, 33, 34, 36, 31, 63, 29, 30, 38, 46, 26, 25, 33, 26, 23],
      },
      {
        label: "Grok",
        emphasis: "muted",
        scores:
        [46, 50, 47, 51, null, null, null, null, null, null, null, null, null, null, null, null, null,
        null, 51, 51, 51, 29, 21, 21, 21, 21, 21, 21, 21, 13, 13, 13, 13, 27, 18, 23, 39, 32, 38, 32,
        40, 33, 37, 41, 47, 16, 21, 28, 32, 28, 32, 40, 30, 46, 34, 32, 33, 30, 17, 10, 25, 48, 40, 27,
        37, 43],
      },
      {
        label: "Claude",
        emphasis: "primary",
        scores:
        [70, 75, 72, 67, null, null, null, null, null, 60, null, null, null, 36, 32, null, 42, null, 30,
        40, 40, 40, 42, 31, 35, 26, 26, 26, 29, 17, 50, 40, 52, 51, 59, 56, 60, 61, 60, 53, 39, 51, 52,
        49, 42, 55, 46, 60, 54, 51, 50, 43, 44, 38, 40, 35, 33, 34, 26, 39, 44, 55, 49, 50, 39, 43],
      },
    ],
    markers: [
      { eventId: "anthropic-2026-bug2-thinking-cache", label: "Cache bug" },
    ],
  },
};
