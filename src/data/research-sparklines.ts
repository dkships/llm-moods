/**
 * Score lines for the featured post on /research (the newest post gets the
 * hero chart). Each series is copied from the article's own companion CSV (public/research/<slug>/data.csv; the
 * cross-model post reuses claude-april-2026's), so a card shows the same
 * frozen snapshot its article is built on. Markers point at VENDOR_EVENTS ids
 * so dates live in one place. A newest post without an entry shows no chart.
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
  "gpt-6-2-astra-launch-claims-vs-reception-2026": {
    startDate: "2026-09-28",
    caption: "ChatGPT daily score, Sep 28 – Nov 20, 2026",
    subject: "ChatGPT daily score",
    series: [
      {
        label: "ChatGPT",
        emphasis: "primary",
        scores:
        [54, 53, 58, 54, 62, 59, 58, 59, 63, 64, 61, 58, 62, 57, 59, 60, 61, 64, 63, 61, 63, 60, 55, 54,
        56, 56, 62, 62, 59, 56, 60, 57, 58, 59, 60, 57, 65, 64, 63, 62, 59, 63, 58, 59, 60, 66, 65, 63,
        57, 54, 58, 59, 59, 60],
      },
    ],
    markers: [
      { eventId: "openai-gpt-6-1-sol-launch", label: "GPT-6.1 Sol" },
      { eventId: "openai-gpt-6-2-astra-sol-launch", label: "GPT-6.2" },
    ],
  },
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
    startDate: "2026-03-20",
    caption: "Claude daily score, Mar 20 – Apr 24, 2026",
    subject: "Claude daily score",
    series: [
      {
        label: "Claude",
        emphasis: "primary",
        scores:
        [55, 56, 61, 53, 70, 55, 48, 38, 49, 53, 49, 42, 57, 46, 59, 56, 53, 45, 46, 43, 35, 43, 36,
        29, 33, 30, 52, 45, 58, 51, 48, 42, 29, 37, 45, 44],
      },
    ],
    markers: [
      { eventId: "anthropic-2026-bug2-thinking-cache", label: "Cache bug" },
    ],
  },
  "cross-model-deltas-march-april-2026": {
    startDate: "2026-03-20",
    caption: "Daily scores for all four models, Mar 20 – Apr 24, 2026",
    subject: "Claude vs the other three models",
    series: [
      {
        label: "ChatGPT",
        emphasis: "muted",
        scores:
        [20, 24, 30, 18, 24, 37, 19, 15, 26, 20, 21, 19, 16, 30, 26, 31, 42, 52, 54, 61, 34, 46, 49,
        44, 36, 59, 44, 37, 43, 41, 49, 29, 25, 50, 41, 46],
      },
      {
        label: "Gemini",
        emphasis: "muted",
        scores:
        [33, 56, 52, 42, 48, 46, 40, 40, 37, 50, 42, 23, 35, 32, 39, 53, 57, 35, 32, 29, 35, 36, 34,
        59, 29, 31, 28, 39, 33, 28, 36, 26, 45, 44, 28, 41],
      },
      {
        label: "Grok",
        emphasis: "muted",
        scores:
        [26, 15, 27, 40, 57, 36, 31, 40, 25, 45, 29, 43, 16, 27, 31, 42, 25, 29, 64, 33, 37, 36, 31,
        35, 31, 14, 21, 30, 51, 42, 45, 41, 58, 39, 26, 25],
      },
      {
        label: "Claude",
        emphasis: "primary",
        scores:
        [55, 56, 61, 53, 70, 55, 48, 38, 49, 53, 49, 42, 57, 46, 59, 56, 53, 45, 46, 43, 35, 43, 36,
        29, 33, 30, 52, 45, 58, 51, 48, 42, 29, 37, 45, 44],
      },
    ],
    markers: [
      { eventId: "anthropic-2026-bug2-thinking-cache", label: "Cache bug" },
    ],
  },
};
