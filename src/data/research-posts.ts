import type { ModelSlug } from "./vendor-events";

export type ResearchTag =
  | "claude"
  | "chatgpt"
  | "gemini"
  | "grok"
  | "anthropic"
  | "postmortem"
  | "incident"
  | "methodology"
  | "case-study"
  | "cross-model";

/**
 * Metadata for a downloadable dataset companion to the article.
 * Surfaced in-body as a download link and emitted as schema.org Dataset
 * JSON-LD for primary-source-citing search engines.
 */
export interface ResearchPostDataset {
  /** Human-readable label for the download link */
  label: string;
  /** Public path (served from /public, e.g. "/research/claude-april-2026/data.csv") */
  path: string;
  description: string;
  /** ISO 8601 — last time the file was regenerated */
  publishedAt: string;
  /** Optional license identifier; defaults to MIT to match the repo */
  license?: string;
}

export interface ResearchPost {
  /** URL segment, e.g. "claude-april-2026" */
  slug: string;
  title: string;
  publishedAt: string; // YYYY-MM-DD
  updatedAt?: string;
  /** 1-2 sentence plain-text used in the index card and OG description */
  summary: string;
  author: string;
  tags: ResearchTag[];
  /** Drives the "Recent incident analysis" card on /model/:slug */
  relatedModelSlug?: ModelSlug;
  /** Full markdown body */
  body: string;
  /** Optional companion dataset for download + Dataset JSON-LD */
  dataset?: ResearchPostDataset;
  /** Optional path-relative URL to a 1200x630 OG card image */
  ogImage?: string;
}

const claudeApril2026Body = `## The 28-day gap

On March 26, 2026, Anthropic shipped a thinking-cache regression into Claude Sonnet 4.6 and Opus 4.6. The same day, an LLM Vibes scraper logged a [Bluesky post](https://bsky.app/profile/tetrac-official.bsky.social/post/3mhxg72ka722t) from \`@tetrac-official.bsky.social\` that read, in full: "Restart session, clear conversations, clear claude md, give it specific skill and working examples and it's dumb af. Feels like sonnet 3.5 wtf." Anthropic [confirmed the bug 28 days later](https://www.anthropic.com/engineering/april-23-postmortem), on April 23. We logged the grumbling on day zero. We just couldn't tell you so in real time.

This piece is the receipts. What our data shows, where it lined up with Anthropic's postmortem, and where it didn't.

\`\`\`chart-model
claude
\`\`\`
*Claude's daily sentiment score over the last 30 days. The shaded bands are Anthropic's three confirmed bug windows from the April 23 postmortem.*

## The match-up

Anthropic's [April 23 engineering postmortem](https://www.anthropic.com/engineering/april-23-postmortem) named three bugs that ran between March 4 and April 20. Each one maps onto a complaint category our classifier was already tagging.

| Bug | Anthropic window | Stated symptom | LLM Vibes complaint tag | First captured signal |
|---|---|---|---|---|
| Reasoning default high → medium | Mar 4 – Apr 7 | "Less intelligent" | \`reasoning\`, \`general_drop\` | Mar 8 onward (volume gap before) |
| Thinking-cache dropped every turn | Mar 26 – Apr 10 | "Forgetful, repetitive, odd tool choices; usage limits drained faster" | \`context_window\`, \`lazy_responses\`, \`general_drop\` | **Mar 26, same-day** |
| ≤25-word verbosity system prompt | Apr 16 – Apr 20 | ~3% coding-quality drop | \`coding_quality\`, \`general_drop\` | Apr 16, same-day |

For two of three bugs, our scrapers logged matching user-language complaints on the day the bug shipped. The mainstream tech press cycle (VentureBeat, Fortune, Simon Willison, The Register, The Decoder) landed between April 13 and April 24. The clearest match was the cache bug. Anthropic specifically called out faster usage-limit drain, and we had a \`context_window\` spike on March 27, one day after deployment.

## The receipts

These are verbatim posts pulled from the \`scraped_posts\` table, paired with Anthropic's postmortem dates.

> "Restart session, clear conversations, clear claude md, give it specific skill and working examples and it's dumb af. Feels like sonnet 3.5 wtf."
>
> — [@tetrac-official](https://bsky.app/profile/tetrac-official.bsky.social/post/3mhxg72ka722t) on Bluesky, **2026-03-26 10:42 UTC**

> "I just experienced something weird, and I'm not sure if it's been like this the entire time or just a bug. I was having a long session with Claude Code, probably consumed about 80% of the 1M tokens (haven't paying attention), I've reached 90% of the 5h tokens usage limit, and then, the 5h window has ended, and right when the next window started, I noticed that it jumps straight to 27% usage..."
>
> — [r/ClaudeAI on Reddit](https://www.reddit.com/r/ClaudeAI/comments/1s5hfa4/), **2026-03-27 21:36 UTC**

> "Paying for Claude Max 20x and the token limits still tank mid-session on heavy coding work. If you're selling a premium tier for power users, actually build for power users."
>
> — [@mkalkere on X](https://x.com/mkalkere/status/2038404677000216624), **2026-03-29 23:55 UTC**

The first quote is the most direct. Bug 2, the thinking-cache regression, shipped on March 26. The post was captured on March 26. The user is comparing Claude's behavior to a model two generations old. Our classifier tagged it \`general_drop\` and \`lazy_responses\`, the categories Anthropic later mapped to "forgetful and repetitive."

The second quote is the token-drain symptom Anthropic admitted to in the postmortem, captured 24 hours after deployment. The user describes the cache bug's exact mechanism in plain English without knowing what it was. The third quote shows the issue spreading into the paid Claude Max tier within three days, well before any tech outlet had filed copy on it.

## What we got right

Same-day capture on March 26. Same-day capture on the March 27 token-drain spike: our \`context_window\` complaint volume jumped on the day Anthropic later said the cache bug began burning quota. A one-day match between an internal engineering change and an external sentiment pattern is the case for tools like ours existing at all.

The cross-model isolation also held up. During the cache-bug window (March 26 – April 10), Claude scored 48.2, ChatGPT 31.1, Gemini 36.9, Grok 32.6. Claude was still ahead in absolute terms. The signal was in the *delta from each model's own February baseline*. Claude dropped 24 points. ChatGPT dropped 33. Gemini dropped 36. Then between April 11 and April 15, every other tracked model held flat or rose while Claude alone fell another 14 points to 34. That isolation is the strongest evidence we have that the issue was Claude-specific rather than industry-wide.

## What we got wrong

Three things, listed because the post-fix dip is currently the lowest score on Claude's chart and that misleads anyone reading the dashboard cold.

The April 11–15 trough (score 34, the lowest single-window number on Claude's history) landed *after* Anthropic fixed the cache bug on April 10 and *before* the verbosity-prompt bug on April 16. That window is press-cycle echo, not silent-bug detection. The Register published on April 13, VentureBeat and Hacker News followed, and our scrapers captured the resulting wave of "Claude is broken" posts. Many of those came from users whose actual issues had already been fixed. The dashboard looks more like an early-grumble detector than a clean leading indicator.

The February 19 – March 7 volume gap is on us. The scraper orchestrator code shipped on March 9 but had no cron schedule until April 22. For 17 of the 35 days when Bug 1 was silently active in production, our scrapers ran only on manual triggers. We had no operational alarm telling us post volume had collapsed. That means the "Feb 15–18 baseline" is four days of meaningful data, not a robust statistical floor.

The classifier itself is one of the tracked models. Sentiment runs through Gemini 3.1 Flash-Lite, classifying posts about Gemini's main competitor.[^1] There is no evidence of bias in this dataset, and the directional movement is consistent across complaint categories and sources, but the structural risk is real and we have no validation harness yet to spot-check.

## What this changes

When SaaS reliability mattered enough, third-party status pages and observability tools (StatusGator, Downdetector, Datadog's third-party monitors) emerged because vendor-published uptime numbers turned out to be a conflict of interest. Frontier-model quality is now in roughly the same position. Anthropic's postmortem is unusually candid by industry standards, but it took 28 days, multiple Hacker News threads, and an international press cycle to produce. The user-side signal was visible the day the bug shipped.

The argument is not that LLM Vibes is correct and Anthropic is wrong. We share a classifier vendor with our subjects, our scrapers are imperfect, and our lowest score landed on the wrong week. The argument is that AI accountability needs more sources of telemetry that don't sit inside the lab's CI pipeline. We're one of them. There should be five.

## Methodology

LLM Vibes scrapes posts about four LLM models (Claude, ChatGPT, Gemini, Grok) across six social platforms: Reddit (Apify), Hacker News (Algolia API), Bluesky (AT Protocol), Twitter/X (Apify), Mastodon (5 instances), and Lemmy (2 instances). The orchestrator runs once an hour and the scoring pipeline aggregates a daily 0–100 score per model.

Each post is classified for sentiment and complaint category by Gemini 3.1 Flash-Lite via the Google AI API, in batches of 25. Multi-model posts use a per-model targeted prompt so a sentence like "DeepSeek fixed Gemini's mess" scores correctly for each model. The daily score is volume-weighted negative-vs-positive on a 0–100 scale.

The numbers in this article come from the \`vibes_scores\` and \`scraped_posts\` tables, filtered to days with ≥10 Claude posts. All quoted text is verbatim. The full data analysis lives in the [public repository](https://github.com/dkships/llm-moods) under \`docs/claude-april-2026-degradation-analysis.md\`, and the internal retrospective is at \`docs/llm-vibes-retrospective-april-2026.md\`.

## What you can do next

See the [live Claude chart](/model/claude). The three Anthropic bug bands are overlaid on the score history, with annotation arrows on March 26 and April 11.

[Read or fork the source on GitHub](https://github.com/dkships/llm-moods). The classifier prompt, the scraper config, and the anomaly-detection logic are all in \`supabase/functions/_shared/\`.

The next incident write-up will go out within 24 hours of the next ≥3σ score drop on any tracked model. Watch the [dashboard](/dashboard) or follow the [GitHub repo](https://github.com/dkships/llm-moods).

## Notes

[^1]: Self-bias risk on the classifier. Gemini 3.1 Flash-Lite is the model performing classification and is also one of the four tracked models. We have no second-model validation harness yet. Mitigating evidence: across the windows examined, Claude often outscored Gemini, the opposite of what classifier bias toward Gemini would produce. The risk is structural, and disclosing it is the obligation; spot-checking it is the next build item.
`;

const methodologyBody = `## Why a methodology post

LLM Vibes is two things at once: a public sentiment dashboard, and an argument that frontier-model accountability needs telemetry that doesn't sit inside a vendor's CI pipeline. The dashboard only carries the argument if the methodology is legible. This post walks through the full pipeline: what we scrape, how we score it, how we flag anomalies, and which failure modes we've documented but not yet solved.

If you want to verify any of this against the source, every script, query, and prompt referenced here lives in the [public repository](https://github.com/dkships/llm-moods). The classifier prompt is in \`supabase/functions/_shared/classifier.ts\`. The scoring math is in \`supabase/functions/_shared/vibes-scoring.ts\`.

## What gets scraped

Six platforms, six edge functions, one orchestrator.

Reddit comes from the Apify \`trudax~reddit-scraper-lite\` actor, pulling 40 posts per run from five subreddits (r/ClaudeAI, r/ChatGPT, r/LocalLLaMA, r/GoogleGemini, r/artificial). Hacker News uses the Algolia API, free and rate-friendly. Bluesky uses the AT Protocol with an authenticated handle. Twitter/X uses the Apify \`apidojo~tweet-scraper\` actor, four search terms, 50 posts per run. Mastodon uses the public API across five instances. Lemmy uses the public API across two instances.

A coordinator function (\`run-scrapers\`) fires each scraper in batches of three. The schedule lives in Supabase \`pg_cron\` and runs hourly, but the orchestrator only does a real fetch on three Pacific-time windows per day (05:00, 14:00, 21:00). On the other 21 hourly invocations it returns \`{"status":"skipped","reason":"outside_window"}\` in milliseconds, which keeps the cron column legible without burning Apify credits.

The hourly trigger landed on April 22, 2026. Before that, the orchestrator code shipped without a cron schedule for 17 days. That gap is documented in [our retrospective](https://github.com/dkships/llm-moods/blob/main/docs/llm-vibes-retrospective-april-2026.md).

## How posts get attributed to a model

Two-stage matching, both deterministic. First, lexical: a list of keywords per model (\`Claude\`, \`Sonnet\`, \`Opus\`, \`Haiku\`, \`ChatGPT\`, \`GPT-5\`, etc.) loaded from the \`model_keywords\` table at runtime. Tier-1 keywords match outright. Tier-2 keywords (\`gpt\`, \`openai\`) only match in the presence of explicit context words, and not when the post mentions local-model markers (\`gpt-oss\`, \`ollama\`, \`huggingface.co/openai/gpt-oss\`). That disambiguation alone removed a meaningful share of false ChatGPT attributions to self-hosted runs.

Second, source-aware: each Reddit post inherits a hint from its subreddit (r/ClaudeAI implies Claude). The hint augments but doesn't override the keyword match. Multi-model posts can still attribute to multiple models simultaneously.

A single post can match multiple models. When it does, downstream classification uses a per-model targeted prompt so a sentence like *"DeepSeek fixed Gemini's mess"* scores positive for DeepSeek and negative for Gemini independently. There are two classifier prompts in the codebase: a single-model batch prompt for posts that match one slug, and a targeted batch prompt for posts that match more than one.

## How sentiment gets classified

Every relevant post is sent to **Gemini 3.1 Flash-Lite** via the Google AI API in batches of 25. The classifier returns six fields per post: \`relevant\`, \`sentiment\` (positive / negative / neutral), \`complaint_category\` (one of 12 if negative), \`praise_category\` (one of 10 if positive), \`confidence\` (0.0–1.0), and a translation if the post is non-English.

The 12 complaint categories are: \`lazy_responses\`, \`hallucinations\`, \`refusals\`, \`coding_quality\`, \`speed\`, \`general_drop\`, \`pricing_value\`, \`censorship\`, \`context_window\`, \`api_reliability\`, \`multimodal_quality\`, and \`reasoning\`. They are deliberately coarse. A public dashboard rewards stable category labels readers can recognize over time.

Non-English posts are translated by the same prompt and stored alongside the original. Original-language text stays in \`content\`; the translation goes into \`translated_content\`. The detected ISO code goes into \`original_language\`. There is no separate translation API call.

## How a daily score gets computed

The score is volume-weighted and source-capped. The relevant code is at [\`supabase/functions/_shared/vibes-scoring.ts\` lines 231–325](https://github.com/dkships/llm-moods/blob/main/supabase/functions/_shared/vibes-scoring.ts).

For each eligible post in a 24-hour Pacific-local window:

\`\`\`
weight = confidence × log(engagement + 1) × content_multiplier
content_multiplier = 0.6 if title-only else 1.0
\`\`\`

Eligibility means \`confidence >= 0.65\`. Below that floor the classifier says it's a weak signal; we drop it.

Each source (\`reddit\`, \`bluesky\`, \`twitter\`, etc.) is then capped at no more than 50% of total weight. If Bluesky alone produces enough volume to dominate a day's score, the cap rescales it down. This is the most important guardrail against sentiment shifts that come from one platform's local culture rather than a real model-quality change.

After capping, the per-day score is:

\`\`\`
effective_positive = positive_weight + 0.3 × neutral_weight
score = round((effective_positive / total_weight) × 100)
\`\`\`

The 0.3 coefficient on neutral weight is a soft hand: a day full of *"meh"* posts scores around 30, not 0. Empty days (zero eligible posts) default to 50, the visual midpoint, so the chart line doesn't dive on missing data.

The top-complaint label per day is the highest-weighted complaint category from negative posts that day.

## How anomaly detection works

The anomaly hook ([\`src/hooks/useScoreAnomalies.ts\`](https://github.com/dkships/llm-moods/blob/main/src/hooks/useScoreAnomalies.ts)) runs entirely in the browser over the last 30 days of \`vibes_scores\`. For each row it computes a 14-day trailing baseline (mean and sample standard deviation), then a z-score:

\`\`\`
z = (today_score - baseline_mean) / baseline_stddev
\`\`\`

The thresholds:
- \`|z| ≥ 3\` → **breach** (≈0.3% false-positive rate against a normal distribution)
- \`|z| ≥ 2\` → **watch** (≈5% false-positive rate)
- otherwise → normal, hidden

Rows where the baseline window has fewer than 7 days of data are skipped. The stddev is too noisy to be useful. Today's anomaly view is admin-only at \`/admin/scrapers\` (gated to dev builds via \`import.meta.env.DEV\` so production bundles physically exclude the route).

The same anomaly stream feeds the status-correlation chip on each model's [Official Status](/model/claude) card. When a vendor publishes a status incident, we cross-reference its date against any breach or watch anomalies for that model within ±2 days and surface the match inline.

## What this analysis assumes

Three caveats that anyone reading the dashboard should know.

The classifier vendor is one of the tracked models. Gemini 3.1 Flash-Lite classifies posts about Gemini's competitors. There is no evidence of bias in the data (Claude often scores higher than Gemini in the windows we've examined, the opposite of what classifier bias toward Gemini would produce), but the structural risk is real. We do not yet have a second-model validation harness.

Volume gaps are part of the record. The Feb 19 – Mar 7, 2026 gap (no scheduled cron, manual triggers only) means our pre-bug baseline for the [Claude April 2026 incident](/research/claude-april-2026) is four days, not a robust statistical floor.

The score lags. Press-cycle echo can drag a model's score below the bug-period score, as it did for Claude on April 11–15 (lowest score, post-fix). The retrospective documents that. The companion piece on [cross-model deltas](/research/cross-model-deltas-march-april-2026) makes the lag pattern visible.

The repo is MIT-licensed. Read it, fork it, run it against your own scraper sources, file a PR if you have a better classifier prompt.
`;

const crossModelBody = `## Reading absolute scores will mislead you

The most common misread of a multi-model dashboard like LLM Vibes is comparing two model scores at a single point in time. *"Claude is 48, ChatGPT is 31, so Claude is better."* That number says less than it looks like.

What it actually says is: at this moment, in the population of posts we scraped, the volume-weighted positive share for Claude is higher than for ChatGPT. Models attract different audiences with different complaint cultures. Reddit's r/ChatGPT runs hotter than r/ClaudeAI on any given day. A snapshot doesn't tell you whether a model is improving, regressing, or holding steady. Only the delta from its own baseline does that.

This is the lesson the [March–April 2026 Claude incident](/research/claude-april-2026) made unmissable.

## The four models, side by side

\`\`\`chart-model
claude
\`\`\`

\`\`\`chart-model
chatgpt
\`\`\`

\`\`\`chart-model
gemini
\`\`\`

\`\`\`chart-model
grok
\`\`\`

These are live charts, not snapshots. Each one shows the model's own daily score against its own history. The Claude chart is shaded with the three Anthropic-confirmed bug windows. The other three are not shaded because their vendors have not published comparable postmortems for the same period.

## The numbers that matter

Across the cache-bug window (March 26 – April 10, 2026), each tracked model's volume-weighted score was:

| Model | Mar 26 – Apr 10 score | Feb baseline | Delta from baseline | Press-cycle echo (Apr 11–15) |
|---|---|---|---|---|
| Claude | 48.2 | ~72 | **−24** | **34** |
| ChatGPT | 31.1 | ~64 | **−33** | 48 |
| Gemini | 36.9 | ~73 | **−36** | 42 |
| Grok | 32.6 | ~65 | **−33** | 24 |

Claude was the highest absolute score in this window. It also had the smallest delta from its own February baseline, and the only post-fix trough that dropped *below* its bug-window score. ChatGPT, Gemini, and Grok all had larger absolute drops but recovered faster.

That's the inverted shape: the model that was actually broken (Claude, per Anthropic's own postmortem) had the *best* absolute score during the breakage and the *worst* relative score after it was fixed. Reading absolute scores would have told you Claude was fine. Reading deltas tells you the truth.

## Why deltas catch what absolute scores miss

Three reasons.

Cohort drift. Each model has a different audience mix. ChatGPT pulls in heavy mainstream traffic from Reddit and Twitter; Claude pulls in a more developer-skewed cohort that's more demanding and more vocal. The volume-weighted score reflects both quality and audience tolerance. Comparing baselines to themselves removes the audience-tolerance variable.

Press-cycle echo. When a story goes mainstream (VentureBeat, Fortune, Hacker News, The Register), the wave of "X is broken" posts arrives *after* the fix. Our scrapers pick up the echo. A naive absolute-score reading flags the post-fix week as worse than the actual-fix week. A delta-from-baseline reading shows the press wave as a smaller deviation than the silent bug period was.

Vendor-wide trends. When all four models drop together, that's industry sentiment, not model quality. Aggregating across the whole tracked set gives you a baseline of baselines: if Claude's delta is −24 while the average across other vendors is −34, Claude is actually doing better than the industry trend, even when its absolute number is also down.

## How to read the dashboard

Three rules worth committing to memory.

1. Compare a model to itself, not to other models, when judging quality changes. Each model card on [the dashboard](/dashboard) shows yesterday's delta in the trend pill. That's the right metric for "is X getting worse?"
2. Watch for divergence from the cross-model average. If three of four tracked models go down by the same magnitude in the same week, the news is industry-wide. If one model's delta is meaningfully larger, that one is the story.
3. Treat a single ≥2σ daily deviation as a watch flag, not a verdict. The [admin Anomalies panel](/admin/scrapers) (dev-only) surfaces these automatically. A first-day regression is rarely the strongest signal. Sustained multi-day drops match what a real engineering bug looks like in user behavior.

## What this means for the next incident

When the next Claude, GPT, Gemini, or Grok regression happens (and it will), the early signal won't be that one model dropped. The early signal will be that one model's *delta from its baseline* is several points larger than the cross-model median for the same week.

That comparison currently requires eyeballing four charts. The next iteration of LLM Vibes should compute it explicitly: a "delta divergence" metric per model per day, surfaced as a new anomaly type. That's not built yet. If you want to read the data yourself in the meantime, the [public CSV](/research/claude-april-2026/data.csv) for the Claude case study has the raw scores; the other three models' scores are queryable via the public Supabase REST endpoint exposed in the repository.

## Caveats

The Feb baseline numbers in the table above (~72, ~64, ~73, ~65) are approximate. The Feb 19 – Mar 7 scraper-volume gap means each model's pre-bug baseline rests on roughly four days of meaningful data, not a statistically robust window. The relative ordering is solid; the precise baseline values are the weakest part of the table.

The lesson from March 2026 was not that LLM Vibes caught Claude breaking. It was that we caught it by reading deltas instead of the leaderboard. Build the same instinct into how you read the dashboard.
`;

export const RESEARCH_POSTS: ResearchPost[] = [
  {
    slug: "claude-april-2026",
    title: "We Caught Claude's March Slide 28 Days Before Anthropic Confirmed It",
    publishedAt: "2026-04-25",
    summary:
      "Independent sentiment data caught Claude Code grumbling on March 26, the day Anthropic shipped the cache bug — 28 days before the postmortem.",
    author: "David Kelly",
    tags: ["claude", "anthropic", "postmortem", "incident", "case-study"],
    relatedModelSlug: "claude",
    body: claudeApril2026Body,
    ogImage: "/research/claude-april-2026/og.png",
    dataset: {
      label: "Daily LLM Vibes scores · Feb 15 – Apr 24, 2026 (CSV)",
      path: "/research/claude-april-2026/data.csv",
      description:
        "Daily volume-weighted sentiment score (0–100) per tracked model with positive / negative / neutral counts and top-complaint label. Source for every chart and number in this analysis.",
      publishedAt: "2026-04-26",
      license: "MIT",
    },
  },
  {
    slug: "how-llm-vibes-classifies-sentiment",
    title: "How LLM Vibes Classifies Sentiment",
    publishedAt: "2026-04-26",
    summary:
      "The full pipeline from scraper to score. Six platforms, 12 complaint categories, a volume-weighted 0–100 score, and the failure modes we've documented but not yet solved.",
    author: "David Kelly",
    tags: ["methodology"],
    body: methodologyBody,
    ogImage: "/research/how-llm-vibes-classifies-sentiment/og.png",
  },
  {
    slug: "cross-model-deltas-march-april-2026",
    title: "When One AI Cracks: Cross-Model Sentiment, March–April 2026",
    publishedAt: "2026-04-26",
    summary:
      "Comparing absolute scores across LLM Vibes models will mislead you. Comparing each model's delta from its own baseline is what caught Claude's March 2026 regression.",
    author: "David Kelly",
    tags: ["cross-model", "case-study", "claude", "chatgpt", "gemini", "grok"],
    body: crossModelBody,
    ogImage: "/research/cross-model-deltas-march-april-2026/og.png",
  },
];

export function getResearchPost(slug: string): ResearchPost | undefined {
  return RESEARCH_POSTS.find((post) => post.slug === slug);
}

export function getResearchPostsForModel(modelSlug: string): ResearchPost[] {
  return RESEARCH_POSTS.filter((post) => post.relatedModelSlug === modelSlug);
}
