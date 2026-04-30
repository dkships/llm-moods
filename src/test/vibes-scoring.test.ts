import { describe, expect, it } from "vitest";

import {
  applyScoreSmoothing,
  computeScore,
  getMatchingWindow,
  getPacificDayWindow,
  getPreviousDailyScore,
  getUtcDayWindow,
} from "../../supabase/functions/_shared/vibes-scoring";

describe("vibes scoring helpers", () => {
  const scoredPost = (
    sentiment: "positive" | "negative" | "neutral",
    source: string,
  ) => ({
    sentiment,
    complaint_category: sentiment === "negative" ? "general_drop" : null,
    confidence: 1,
    score: 0,
    content_type: "full_content",
    source,
  });

  it("builds daily windows from UTC calendar boundaries", () => {
    const window = getUtcDayWindow(new Date("2026-04-18T15:42:10.000Z"));

    expect(window).toEqual({
      periodStart: "2026-04-18T00:00:00.000Z",
      rangeStart: "2026-04-18T00:00:00.000Z",
      rangeEnd: "2026-04-19T00:00:00.000Z",
      label: "2026-04-18",
      timeZone: "UTC",
    });
  });

  it("builds Pacific-local daily windows from local midnight boundaries", () => {
    const window = getPacificDayWindow(new Date("2026-04-18T15:42:10.000Z"));

    expect(window).toEqual({
      periodStart: "2026-04-18T07:00:00.000Z",
      rangeStart: "2026-04-18T07:00:00.000Z",
      rangeEnd: "2026-04-19T07:00:00.000Z",
      label: "2026-04-18",
      timeZone: "America/Los_Angeles",
    });
  });

  it("matches coordinated scrape windows in Pacific time", () => {
    const matched = getMatchingWindow(
      new Date("2026-04-18T21:00:00.000Z"),
      "America/Los_Angeles",
      ["05:00", "14:00", "21:00"],
    );

    expect(matched).toEqual({
      label: "afternoon",
      time: "14:00",
      localDate: "2026-04-18",
      localTime: "14:00",
      timeZone: "America/Los_Angeles",
    });
  });

  it("allows a small scheduler grace period after a scrape window", () => {
    const matched = getMatchingWindow(
      new Date("2026-04-18T12:12:00.000Z"),
      "America/Los_Angeles",
      ["05:00", "14:00", "21:00"],
      15,
    );

    expect(matched?.time).toBe("05:00");
    expect(matched?.localTime).toBe("05:12");
  });

  it("does not match scrape windows after the grace period", () => {
    const matched = getMatchingWindow(
      new Date("2026-04-18T12:16:00.000Z"),
      "America/Los_Angeles",
      ["05:00", "14:00", "21:00"],
      15,
    );

    expect(matched).toBeNull();
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

  it("uses a softer source cap when alternate-source evidence is sparse", () => {
    const result = computeScore([
      ...Array.from({ length: 9 }, () => scoredPost("positive", "bluesky")),
      scoredPost("negative", "twitter"),
    ]);

    expect(result.positive_count).toBe(9);
    expect(result.negative_count).toBe(1);
    expect(result.score).toBe(83);
  });

  it("keeps a dominant source from exceeding half of final scoring weight once alternate evidence is sufficient", () => {
    const result = computeScore([
      ...Array.from({ length: 9 }, () => scoredPost("positive", "bluesky")),
      scoredPost("negative", "twitter"),
      scoredPost("negative", "twitter"),
      scoredPost("negative", "twitter"),
    ]);

    expect(result.positive_count).toBe(9);
    expect(result.negative_count).toBe(3);
    expect(result.score).toBe(50);
  });

  it("does not cap single-source days when there is no alternate source", () => {
    const result = computeScore([
      scoredPost("positive", "bluesky"),
      scoredPost("positive", "bluesky"),
      scoredPost("positive", "bluesky"),
    ]);

    expect(result.score).toBe(100);
  });

  it("ramps sample weighting gradually after the measured threshold", () => {
    expect(applyScoreSmoothing(100, 50, 4, 5)).toBe(70);
    expect(applyScoreSmoothing(100, 50, 5, 5)).toBe(73);
    expect(applyScoreSmoothing(100, 50, 9, 5)).toBe(83);
    expect(applyScoreSmoothing(100, 50, 10, 5)).toBe(85);
  });
});
