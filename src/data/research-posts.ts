import type { ModelSlug } from "./vendor-events";

export type ResearchTag =
  | "claude"
  | "anthropic"
  | "postmortem"
  | "incident"
  | "methodology"
  | "case-study";

export interface ResearchPostFAQ {
  question: string;
  answer: string;
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
  /** Optional FAQ for FAQPage JSON-LD */
  faq?: ResearchPostFAQ[];
}

const claudeApril2026Body = `## The 28-day gap

On March 26, 2026, Anthropic shipped a thinking-cache regression into Claude Sonnet 4.6 and Opus 4.6. The same day, an LLM Vibes scraper logged a [Bluesky post](https://bsky.app/profile/tetrac-official.bsky.social/post/3mhxg72ka722t) from \`@tetrac-official.bsky.social\` that read, in full: "Restart session, clear conversations, clear claude md, give it specific skill and working examples and it's dumb af. Feels like sonnet 3.5 wtf." Anthropic [confirmed the bug 28 days later](https://www.anthropic.com/engineering/april-23-postmortem), on April 23. We caught the grumbling on day zero. We just couldn't tell you so in real time.

This piece is the receipts: what our data shows, where it lined up with Anthropic's postmortem, and where it didn't.

\`\`\`chart-model
claude
\`\`\`
*Claude's daily sentiment score over the last 30 days. The shaded bands are Anthropic's three confirmed bug windows from the April 23 postmortem.*

## The match-up

Anthropic's [April 23 engineering postmortem](https://www.anthropic.com/engineering/april-23-postmortem) named three bugs that ran between March 4 and April 20. Each one maps directly onto a complaint category our classifier was already tagging.

| Bug | Anthropic window | Stated symptom | LLM Vibes complaint tag | First captured signal |
|---|---|---|---|---|
| Reasoning default high → medium | Mar 4 – Apr 7 | "Less intelligent" | \`reasoning\`, \`general_drop\` | Mar 8 onward (volume gap before) |
| Thinking-cache dropped every turn | Mar 26 – Apr 10 | "Forgetful, repetitive, odd tool choices; usage limits drained faster" | \`context_window\`, \`lazy_responses\`, \`general_drop\` | **Mar 26, same-day** |
| ≤25-word verbosity system prompt | Apr 16 – Apr 20 | ~3% coding-quality drop | \`coding_quality\`, \`general_drop\` | Apr 16, same-day |

For two of three bugs, our scrapers logged matching user-language complaints on the day the bug shipped. The mainstream tech press cycle — VentureBeat, Fortune, Simon Willison, The Register, The Decoder — landed between April 13 and April 24. The cleanest single fingerprint was the cache bug: Anthropic specifically called out faster usage-limit drain, and we had a \`context_window\` spike on March 27, one day after deployment.

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

The first quote is the cleanest. Bug 2 — the thinking-cache regression — shipped on March 26. The post was captured on March 26. The user is comparing Claude's behavior to a model two generations old. Our classifier tagged it \`general_drop\` and \`lazy_responses\`, both of which are the categories Anthropic later mapped to "forgetful and repetitive."

The second quote is the token-drain symptom that Anthropic explicitly admitted to in the postmortem, captured 24 hours after deployment. The user describes the cache bug's exact mechanism in plain English without knowing what it was. The third quote shows the issue spreading into the paid Claude Max tier within three days, well before any tech outlet had filed copy on it.

## What we got right

The same-day capture on March 26 was real. So was the March 27 token-drain spike: our \`context_window\` complaint volume jumps on exactly the day Anthropic later said the cache bug began burning quota. That kind of one-day match between an internal engineering change and an external sentiment pattern is the case for tools like ours existing at all.

The cross-model isolation also held up. During the cache-bug window (March 26 – April 10), Claude scored 48.2, ChatGPT 31.1, Gemini 36.9, Grok 32.6 — Claude was still ahead in absolute terms. The signal was in the *delta from each model's own February baseline*. Claude dropped 24 points. ChatGPT dropped 33, Gemini 36. Then between April 11 and April 15, every other tracked model held flat or rose while Claude alone fell another 14 points to 34. That isolation is the cleanest evidence we have that the issue was Claude-specific, not a vendor-wide vibe shift.

## What we got wrong

Three things, and they're worth naming because the post-fix dip is currently the lowest score on Claude's chart, which would mislead anyone reading the dashboard cold.

The April 11–15 trough — score 34, the lowest single-window number on Claude's history — landed *after* Anthropic fixed the cache bug on April 10 and *before* the verbosity-prompt bug on April 16. That window is press-cycle echo, not silent-bug detection. The Register published on April 13, VentureBeat and Hacker News followed shortly after, and our scrapers captured the resulting wave of "Claude is broken" posts — many of them from users whose actual issues had already been fixed. The dashboard looks more like an early-grumble detector than a clean leading indicator.

The February 19 – March 7 volume gap is on us. The scraper orchestrator code shipped on March 9 but had no cron schedule until April 22. For 17 of the 35 days when Bug 1 was silently active in production, our scrapers ran only on manual triggers. We had no operational alarm telling us post volume had collapsed. That means the "Feb 15–18 baseline" is four days of meaningful data, not a robust statistical floor.

The classifier itself is one of the tracked models. Sentiment runs through Gemini 3.1 Flash-Lite, classifying posts about Gemini's main competitor. There is no evidence of bias in this dataset and the directional movement is consistent across complaint categories and sources, but the structural risk is real and we have no validation harness yet to spot-check.

## What this changes

When SaaS reliability mattered enough, third-party status pages and observability tools — StatusGator, Downdetector, Datadog's third-party monitors — emerged because vendor-published uptime numbers turned out to be a conflict of interest. Frontier-model quality is now in roughly the same position. Anthropic's postmortem is unusually candid by industry standards, but it took 28 days, multiple Hacker News threads, and an international press cycle to produce. The user-side signal was visible the day the bug shipped.

The argument is not that LLM Vibes is correct and Anthropic is wrong. We share a classifier vendor with our subjects, our scrapers are imperfect, and our lowest score landed on the wrong week. The argument is that AI accountability needs *more* sources of telemetry that don't sit inside the lab's CI pipeline. We're one of them. There should be five.

## Methodology

LLM Vibes scrapes posts about four LLM models — Claude, ChatGPT, Gemini, Grok — across six social platforms: Reddit (Apify), Hacker News (Algolia API), Bluesky (AT Protocol), Twitter/X (Apify), Mastodon (5 instances), and Lemmy (2 instances). The orchestrator runs once an hour and the scoring pipeline aggregates a daily 0–100 score per model.

Each post is classified for sentiment and complaint category by Gemini 3.1 Flash-Lite via the Google AI API, in batches of 25. Multi-model posts use a per-model targeted prompt so a sentence like "DeepSeek fixed Gemini's mess" scores correctly for each model. The daily score is volume-weighted negative-vs-positive on a 0–100 scale.

The numbers in this article come from the \`vibes_scores\` and \`scraped_posts\` tables, filtered to days with ≥10 Claude posts. All quoted text is verbatim. The full data analysis lives in the [public repository](https://github.com/dkships/llm-moods) under \`docs/claude-april-2026-degradation-analysis.md\`, and the internal retrospective is at \`docs/llm-vibes-retrospective-april-2026.md\`.

## What you can do next

See the [live Claude chart](/model/claude) — the three Anthropic bug bands are now overlaid on the score history, with annotation arrows on March 26 and April 11.

[Read or fork the source on GitHub](https://github.com/dkships/llm-moods). The classifier prompt, the scraper config, and the anomaly-detection logic are all in \`supabase/functions/_shared/\`.

The next incident write-up will go out within 24 hours of the next ≥3σ score drop on any tracked model. Watch the [dashboard](/dashboard) or follow the [GitHub repo](https://github.com/dkships/llm-moods).
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
    faq: [
      {
        question: "What did Anthropic's April 23 postmortem disclose?",
        answer:
          "Three engineering bugs that degraded Claude Code between March 4 and April 20, 2026: a default reasoning-effort change (Mar 4–Apr 7), a thinking-cache regression that dropped reasoning every turn instead of once (Mar 26–Apr 10), and a system prompt that capped responses at 25 words (Apr 16–Apr 20).",
      },
      {
        question: "When did LLM Vibes first detect user complaints about the bugs?",
        answer:
          "Our scrapers logged a Bluesky post on March 26, 2026 — the same day Anthropic shipped the thinking-cache bug — comparing Claude's behavior to a model two generations old. Token-drain complaints on Reddit followed 24 hours later.",
      },
      {
        question: "Did LLM Vibes claim Claude was broken before Anthropic admitted it?",
        answer:
          "No. We captured user complaints in real time but did not flag a quality regression to readers. The dashboard's lowest Claude score landed in the post-fix press-cycle echo on April 11–15, not during the silent bug period. The article is honest about that limitation.",
      },
    ],
  },
];

export function getResearchPost(slug: string): ResearchPost | undefined {
  return RESEARCH_POSTS.find((post) => post.slug === slug);
}

export function getResearchPostsForModel(modelSlug: string): ResearchPost[] {
  return RESEARCH_POSTS.filter((post) => post.relatedModelSlug === modelSlug);
}
