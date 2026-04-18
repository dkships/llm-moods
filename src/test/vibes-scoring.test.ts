import { describe, expect, it } from "vitest";

import {
  applyScoreSmoothing,
  computeScore,
  getPreviousDailyScore,
  getUtcDayWindow,
} from "../../supabase/functions/_shared/vibes-scoring";

describe("vibes scoring helpers", () => {
  it("builds daily windows from UTC calendar boundaries", () => {
    const window = getUtcDayWindow(new Date("2026-04-18T15:42:10.000Z"));

    expect(window).toEqual({
      periodStart: "2026-04-18T00:00:00.000Z",
      rangeStart: "2026-04-18T00:00:00.000Z",
      rangeEnd: "2026-04-19T00:00:00.000Z",
      label: "2026-04-18",
    });
  });

  it("ignores the current day row when selecting the smoothing seed", () => {
    const previousScore = getPreviousDailyScore([
      { period_start: "2026-04-18T00:00:00.000Z", score: 62 },
      { period_start: "2026-04-17T00:00:00.000Z", score: 36 },
    ], "2026-04-18T00:00:00.000Z");

    expect(previousScore).toBe(36);
  });

  it("keeps ultra-thin daily samples anchored close to the prior day", () => {
    const rawScore = computeScore([
      {
        sentiment: "positive",
        complaint_category: null,
        confidence: 0.9,
        score: 1,
        content_type: "full_text",
        source: "bluesky",
      },
    ]).score;

    expect(rawScore).toBe(100);
    expect(applyScoreSmoothing(rawScore, 36, 1, 5)).toBe(49);
    expect(applyScoreSmoothing(rawScore, 62, 1, 5)).toBe(70);
  });

  it("counts only eligible scored posts when smoothing thin daily samples", () => {
    const result = computeScore([
      {
        sentiment: "positive",
        complaint_category: null,
        confidence: 0.9,
        score: 1,
        content_type: "full_text",
        source: "mastodon",
      },
      {
        sentiment: "positive",
        complaint_category: null,
        confidence: 0.85,
        score: 1,
        content_type: "full_text",
        source: "mastodon",
      },
      {
        sentiment: "positive",
        complaint_category: null,
        confidence: 0.9,
        score: 1,
        content_type: "full_text",
        source: "mastodon",
      },
      {
        sentiment: null,
        complaint_category: null,
        confidence: 0,
        score: 1,
        content_type: "full_text",
        source: "bluesky",
      },
      {
        sentiment: null,
        complaint_category: null,
        confidence: 0,
        score: 1,
        content_type: "full_text",
        source: "bluesky",
      },
    ]);

    expect(result.score).toBe(100);
    expect(result.total_posts).toBe(5);
    expect(result.eligible_posts).toBe(3);
    expect(applyScoreSmoothing(result.score, 46, result.eligible_posts, 5)).toBe(62);
  });
});
