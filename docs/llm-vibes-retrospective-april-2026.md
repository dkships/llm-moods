# LLM Vibes Retrospective — Anthropic April 2026 Claude Code Incident

**Status:** Internal retrospective
**Date:** 2026-04-24
**Companion analysis:** [`claude-april-2026-degradation-analysis.md`](./claude-april-2026-degradation-analysis.md)
**External reference:** [Anthropic April 23 postmortem](https://www.anthropic.com/engineering/april-23-postmortem)

## TL;DR scorecard

| Dimension | Grade | Why |
|---|---|---|
| Detection lead time | **B+** | Captured user grumbling on March 26, the same day Anthropic shipped the cache bug, and token-drain complaints on March 27. About three weeks ahead of mainstream tech press (April 13–16). |
| Symptom-category fidelity | **B** | Captured the right tags (`general_drop`, `lazy_responses`, `context_window`, `reasoning`) but with no cohort separation between Claude Code and Claude.ai. The bugs were Claude Code-specific; we read them as Claude-wide. |
| Signal clarity | **C** | No anomaly logic. The dip was retrospectively obvious only. The lowest single-window score (34, Apr 11–15) came after the cache fix, during press-cycle echo, not during the silent bug period. |

The dashboard caught the problem early. It just couldn't tell us so in real time.

## Timeline reconciliation

| Window | Anthropic disclosure | Claude weighted score | Neg % | Posts | Top complaints |
|---|---|---|---|---|---|
| Feb 15–18 | (pre-bug baseline) | 67–75 | 32–45% | 128–138/day | n/a |
| **Feb 19 – Mar 7** | (bug 1 active from Mar 4; we had no data) | — | — | 1–5/day | volume gap, see below |
| Mar 8 – Mar 25 | Bug 1 silently active | 47.4 | 32.5% | 981 | general_drop, coding_quality, lazy_responses, reasoning |
| Mar 26 – Apr 10 | Bugs 1 + 2 both active | 48.2 | 35.8% | 1,283 | general_drop, api_reliability, coding_quality, lazy_responses, **context_window**, reasoning |
| Apr 11 – Apr 15 | Bug 2 fixed Apr 10, no Bug 3 yet | **34.1** | **47.7%** | 176 | api_reliability, general_drop, lazy_responses |
| Apr 16 – Apr 20 | Bug 3 (verbosity prompt) active | 47.2 | 36.4% | 308 | coding_quality, general_drop |
| Apr 21+ | All bugs fixed | 43 | 37.5% | 16 | lazy_responses |

**The Feb 19 – Mar 7 volume gap is on us.** The orchestrator code shipped on March 9 but had no cron schedule until April 22 (`supabase/migrations/20260422120000_schedule_run_scrapers_hourly.sql`). For 17 of the 35 days where Bug 1 was silently active in production, our scrapers ran only on manual triggers. We had no operational alarm telling us post volume had collapsed.

## What worked

**Same-day capture of Bug 2.** On March 26, the day Anthropic shipped the thinking-cache bug, our scrapers picked up a Bluesky post reading "it's dumb af. Feels like sonnet 3." The next day, March 27, Reddit posts about "27% of the 5-hour tokens usage consumed in an instant" landed in our `context_window` complaint bucket. Anthropic specifically called out faster usage-limit drain as a Bug 2 symptom. The match is exact and the lead time over mainstream press is roughly 18 days.

**Cross-model sanity check.** During the cache-bug window, ChatGPT scored 31, Gemini 37, Grok 33, Claude 48 — Claude was still ahead. But the *delta from each model's own February baseline* was distinctive: Claude dropped 24 points, while ChatGPT dropped 33 and Gemini 36. More telling, in Apr 11–15 every other model held or rose while Claude alone dropped 14 points. That isolation is the cleanest evidence the issue was Claude-specific rather than a vendor-wide vibe shift.

**Symptom mapping.** Anthropic's three stated symptoms map onto categories we already had:
- "Less intelligent" → `reasoning` and `general_drop`
- "Forgetful and repetitive" → `context_window` and `lazy_responses`
- "Usage limits drained faster" → `pricing_value` and `context_window`
- "Odd tool choices" → `coding_quality`

## What failed

**Cohort blindness.** Every Anthropic bug was scoped to Claude Code. Our scrapers tag posts as "Claude" via keyword matching with no surface awareness, so Claude Code complaints diluted into the Claude-wide score and signal blunted accordingly. A Claude Code-only score would likely have shown a much larger drop than the all-surfaces ~48.

**Anomaly blindness.** `get_landing_vibes()` returns latest score and previous-day score, nothing more. There is no rolling baseline anywhere in the stack. The Apr 11–15 dip to 34 was statistically obvious in retrospect (≥3σ from the trailing 14-day baseline) but invisible in real time because nothing was computing that comparison.

**Operational blindness.** The 17-day post-volume gap had no monitoring. `scraper_runs` was logging successful zero-row runs and the dashboard rendered stale-from-baseline scores carried forward via the smoothing logic. The only thing that would have caught it was a daily-volume threshold alert, which we didn't have.

**Classifier risk.** Sentiment classification runs through Gemini 3.1 Flash-Lite, classifying posts about Gemini's main competitor. We have no validation harness to spot-check Claude classifications against a second model. There's no evidence of bias in this dataset, but the structural risk is real and worth naming.

## Counterfactuals (what the dashboard would have shown if Tier 1 had already shipped)

**Anomaly detection** (B1). The Apr 11–15 Claude window would have flashed a `breach`-severity row in the admin Anomalies panel on April 11. Working backward, Mar 26 would likely have shown a `watch`-level dip for Claude given the score moved from a 21-day pre-bug average of ~58 to 53 that day. The watch threshold is calibrated to fire ~5% of the time so this would have arrived among other false positives, but it would have arrived.

**Vendor events overlay** (B2). The chart at `/model/claude` would already display the three Anthropic regression bands at Mar 4 – Apr 7, Mar 26 – Apr 10, and Apr 16 – Apr 20. The "we caught it on March 26" claim becomes a screenshot rather than a paragraph.

**Product surface tagging** (B3). The Recent Posts panel would show a "Claude Code" badge on the March 26 Bluesky post and the March 27 Reddit token-drain post. Filtering to Claude Code only would have surfaced a heavily lopsided complaint mix from late March onward, isolating the cohort that was actually broken.

## Prioritized opportunities

| # | Item | Effort | Impact | Lead-time gain | Tier |
|---|---|---|---|---|---|
| 1 | Browser-side z-score anomaly detection | Half day | High | 2–3 weeks earlier than press cycle | Active (B1) |
| 2 | Static `vendor-events.ts` + chart overlay | Half day | Medium | Retrospective clarity, future incident framing | Active (B2) |
| 3 | Per-model lexical product-surface tagging (display only) | Half day | Medium | Cohort visibility on the existing posts panel | Active (B3) |
| 4 | Persist `product_surface` to `scraped_posts` | 1 day + Lovable prompt | High once active | Cohort scoring (real "Claude Code score") | Parked |
| 5 | Lower `MIN_CONFIDENCE` from 0.65 to 0.55 | 1 line + Lovable prompt | Low–Medium | Recall on weak-signal early-warning posts | Parked |
| 6 | `usage_limit_drain` complaint category | Several edits + reaggregation | Low | Marginal precision gain | Parked |
| 7 | Volume anomaly alert | Half day | Already mitigated by hourly cron | n/a | Parked |
| 8 | Classifier validation harness | 1+ day | Long-term confidence | n/a | Parked |

The active path is everything frontend-only with no Lovable prompts. Parked items wait until the active path has been live and proven against at least one real anomaly.

## Methodology caveats

**Self-bias risk, classifier.** Gemini classifies posts about Claude during a window where Claude users were unhappy. We have no cross-model classifier validation in place. The mitigating fact is that absolute-precision matters less than directional movement, and the directional movement is consistent across multiple complaint categories and across multiple sources.

**Self-bias risk, analyst.** This retrospective is being co-authored by Claude. Reasonable readers should weight that. Specific dates, scores, and quoted post content are reproducible from the database; the framing and grades are not.

**Lovable constraint.** The repo is Lovable-managed. Frontend code under `src/` auto-syncs both ways; SQL migrations and edge functions need a Lovable chat prompt to apply. Active-path improvements are deliberately scoped to `src/` to avoid that friction.

**Public-repo constraint.** No service role keys, API tokens, or sensitive secrets in any change.

**Apify cost ceiling.** Reddit and Twitter scrapers run on a $29/month Apify budget. Any change near scraper code carries real money risk; the active plan touches no scraper code.

**Volume baseline limitation.** The Feb 15–18 baseline has only four days of meaningful data because of the volume gap. "Pre-bug baseline" should be read as indicative, not statistically robust.

## Linkbacks

This retrospective is referenced from `README.md` and from [`docs/claude-april-2026-degradation-analysis.md`](./claude-april-2026-degradation-analysis.md). Implementation tracker is at `~/.claude/plans/ticklish-wishing-river.md`.
