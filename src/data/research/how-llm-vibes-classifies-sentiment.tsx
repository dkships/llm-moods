/**
 * Body component for /research/how-llm-vibes-classifies-sentiment.
 *
 * Hand-ported from markdown to JSX so the runtime no longer needs a
 * markdown parser. Visual parity with the previous react-markdown
 * output is preserved by keeping the surrounding `prose prose-invert`
 * wrapper in ResearchPost.tsx.
 */

import AuthorBio from "@/components/research/AuthorBio";

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

const HowLlmVibesClassifiesSentimentBody = () => (
  <>
    <h2>Why a methodology post</h2>
    <p>
      LLM Vibes is two things at once: a public sentiment dashboard, and an argument that frontier-model
      accountability needs telemetry that doesn't sit inside a vendor's CI pipeline. The dashboard only carries
      the argument if the methodology is legible. This post walks through the full pipeline: what we scrape, how
      we score it, how we flag anomalies, and which failure modes we've documented but not yet solved.
    </p>
    <p>
      Every script, query, and prompt referenced here lives in the{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods">public repository</ExternalLink>. Specific paths
      are linked inline as each component comes up.
    </p>

    <h2>What gets scraped</h2>
    <p>Five platforms, five edge functions, five independent cron schedules.</p>
    <p>
      Reddit comes from the Apify <code>harshmaur/reddit-scraper</code> actor (HTML-parsing on residential
      proxies, adopted after Reddit shut down its public <code>.json</code> API in May 2026 and broke the
      previous actor). It runs once per subreddit across eleven communities spanning the four models
      (r/ClaudeAI, r/ClaudeCode, r/ChatGPT, r/OpenAI, r/ChatGPTPro, r/GoogleGemini, r/GeminiAI, r/GoogleGeminiAI,
      r/grok, plus r/LocalLLaMA and r/artificial) and pulls both posts and their top comments. Hacker News uses
      the Algolia API, free and rate-friendly. Bluesky uses the AT Protocol with an authenticated handle. Twitter/X
      uses the Apify <code>apidojo~tweet-scraper</code> actor, one combined latest-search query, 50 posts per run.
      Mastodon uses the public API across five instances.
    </p>
    <p>
      Each scraper has its own Supabase <code>pg_cron</code> row, firing three times a day at the same
      Pacific-time windows (05:00, 14:00, 21:00) and staggered by a couple of minutes so they never contend.
      Classification is decoupled: scrapers insert posts as <code>pending</code>, a separate cron drains the
      classification queue every two minutes, and a third refreshes aggregate scores every 30 minutes. No
      orchestrator, no shared failure domain — a Reddit timeout can't take Mastodon down with it.
    </p>
    <p>
      It didn't start that way. The original design ran a single orchestrator function
      (<code>run-scrapers</code>), committed in early March 2026 on manual triggers, with an hourly cron
      schedule landing April 22 — that gap is documented in{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods/blob/main/docs/llm-vibes-retrospective-april-2026.md">
        our retrospective
      </ExternalLink>
      . On May 8, 2026 the merged pipeline blew the edge-function time budget and was decomposed into the
      independent crons described above; the orchestrator stays in the repo as a manual debug tool only.
    </p>

    <h2>How posts get attributed to a model</h2>
    <p>
      Two-stage matching, both deterministic. First, lexical: a list of keywords per model (<code>Claude</code>,{" "}
      <code>Sonnet</code>, <code>Opus</code>, <code>Haiku</code>, <code>ChatGPT</code>, <code>GPT-5</code>, etc.)
      loaded from the <code>model_keywords</code> table at runtime. Tier-1 keywords match outright. Tier-2
      keywords (<code>gpt</code>, <code>openai</code>) only match in the presence of explicit context words, and
      not when the post mentions local-model markers (<code>gpt-oss</code>, <code>ollama</code>,{" "}
      <code>huggingface.co/openai/gpt-oss</code>). That disambiguation alone removed a meaningful share of false
      ChatGPT attributions to self-hosted runs.
    </p>
    <p>
      Second, source-aware: each Reddit post inherits a hint from its subreddit (r/ClaudeAI implies Claude). The
      hint augments but doesn't override the keyword match. Multi-model posts can still attribute to multiple
      models simultaneously.
    </p>
    <p>
      A single post can match multiple models. When it does, downstream classification uses a per-model targeted
      prompt so a sentence like <em>"DeepSeek fixed Gemini's mess"</em> scores positive for DeepSeek and
      negative for Gemini independently. There are two classifier prompts in the codebase: a single-model batch
      prompt for posts that match one slug, and a targeted batch prompt for posts that match more than one.
    </p>

    <h2>How sentiment gets classified</h2>
    <p>
      Every relevant post is sent to <strong>Claude Haiku 4.5</strong> via the Anthropic Messages API in
      batches. The classifier returns six fields per post: <code>relevant</code>, <code>sentiment</code> (positive /
      negative / neutral), <code>complaint_category</code> (one of 12 if negative), <code>praise_category</code>{" "}
      (one of 10 if positive), <code>confidence</code> (0.0–1.0), and a translation if the post is non-English.
    </p>
    <p>
      The 12 complaint categories are: <code>lazy_responses</code>, <code>hallucinations</code>,{" "}
      <code>refusals</code>, <code>coding_quality</code>, <code>speed</code>, <code>general_drop</code>,{" "}
      <code>pricing_value</code>, <code>censorship</code>, <code>context_window</code>,{" "}
      <code>api_reliability</code>, <code>multimodal_quality</code>, and <code>reasoning</code>. They are
      deliberately coarse. A public dashboard rewards stable category labels readers can recognize over time.
    </p>
    <p>
      Non-English posts are translated by the same prompt and stored alongside the original. Original-language
      text stays in <code>content</code>; the translation goes into <code>translated_content</code>. The
      detected ISO code goes into <code>original_language</code>. There is no separate translation API call.
    </p>

    <h2>How a daily score gets computed</h2>
    <p>
      The score is volume-weighted and source-capped. The relevant code is at{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods/blob/main/supabase/functions/_shared/vibes-scoring.ts">
        <code>supabase/functions/_shared/vibes-scoring.ts</code> (<code>computeScore</code>)
      </ExternalLink>
      .
    </p>
    <p>For each eligible post in a 24-hour Pacific-local window:</p>
    <pre>
      <code>{`weight = confidence × log(engagement + 1) × content_multiplier
content_multiplier = 0.6 if title-only else 1.0`}</code>
    </pre>
    <p>
      Eligibility means <code>confidence &gt;= 0.65</code>. Below that floor the classifier says it's a weak
      signal; we drop it.
    </p>
    <p>
      Each source (<code>reddit</code>, <code>bluesky</code>, <code>twitter</code>, etc.) is then capped at no
      more than 50% of total weight. If Bluesky alone produces enough volume to dominate a day's score, the
      cap rescales it down. This is the deliberate trade-off: less reactive to local Bluesky or Reddit
      subculture shifts, more robust to a single platform's sudden moderation policy change. We picked the
      second.
    </p>
    <p>After capping, the per-day score is:</p>
    <pre>
      <code>{`effective_positive = positive_weight + 0.3 × neutral_weight
score = round((effective_positive / total_weight) × 100)`}</code>
    </pre>
    <p>
      The 0.3 coefficient on neutral weight is a soft hand: a day full of <em>"meh"</em> posts scores around 30,
      not 0. Empty days (zero eligible posts) default to 50, the visual midpoint, so the chart line doesn't dive
      on missing data.
    </p>
    <p>The top-complaint label per day is the highest-weighted complaint category from negative posts that day.</p>

    <h2>How anomaly detection works</h2>
    <p>
      The anomaly hook (
      <ExternalLink href="https://github.com/dkships/llm-moods/blob/main/src/hooks/useScoreAnomalies.ts">
        <code>src/hooks/useScoreAnomalies.ts</code>
      </ExternalLink>
      ) runs entirely in the browser over the last 30 days of <code>vibes_scores</code>. For each row it
      computes a 14-day trailing baseline (mean and sample standard deviation), then a z-score:
    </p>
    <pre>
      <code>z = (today_score - baseline_mean) / baseline_stddev</code>
    </pre>
    <p>The thresholds:</p>
    <ul>
      <li>
        <code>|z| ≥ 3</code> → <strong>breach</strong> (≈0.3% false-positive rate against a normal distribution)
      </li>
      <li>
        <code>|z| ≥ 2</code> → <strong>watch</strong> (≈5% false-positive rate)
      </li>
      <li>otherwise → normal, hidden</li>
    </ul>
    <p>
      Rows where the baseline window has fewer than 7 days of data are skipped. The stddev is too noisy to be
      useful. Today's anomaly view is admin-only at <code>/admin/scrapers</code> (gated to dev builds via{" "}
      <code>import.meta.env.DEV</code> so production bundles physically exclude the route).
    </p>
    <p>
      The same anomaly stream feeds the status-correlation chip on each model's{" "}
      <a href="/model/claude">Official Status</a> card. When a vendor publishes a status incident, we
      cross-reference its date against any breach or watch anomalies for that model within ±2 days and surface
      the match inline.
    </p>

    <h2>What this analysis assumes</h2>
    <p>Four caveats that anyone reading the dashboard should know.</p>
    <p>
      The pipeline has changed underneath. Several classifier transitions happened in 2026: a switch
      from the Lovable AI gateway to the Google Gemini API on March 20, an upgrade through 2.5 Flash-Lite and
      3.1 Flash-Lite Preview in the following days, a move to 2.5 Flash on April 25, and a switch to Anthropic's
      Claude Haiku 4.5 on June 1. Each transition
      produced a visible step-change in the positive / negative / neutral mix — most dramatically a one-week,
      roughly 25-percentage-point drop in neutral share across all four tracked models the week of the API
      switch. Numbers cited in the{" "}
      <a href="/research/claude-april-2026">Claude April 2026</a> and{" "}
      <a href="/research/cross-model-deltas-march-april-2026">cross-model deltas</a> articles use reclassified
      posts from the post-stabilization pipeline (May 2026), so they're internally consistent within each
      article's window. Sentiment ratios reported pre-March-20 reflect a different classifier and aren't
      directly comparable to anything in the live dashboard.
    </p>
    <p>
      The classifier vendor is one of the tracked models. Claude Haiku 4.5 now grades all four models,
      including Claude itself, so pro-Claude bias is the measurement risk. An April 2026 comparison between the
      Gemini and Claude classifiers found about 92% agreement on sentiment, and a June 2026 run on the live
      Claude Haiku 4.5 classifier put agreement with an independent Gemini grader at 88.9% — which suggests
      vendor identity isn't the main driver of scores, but neither is a substitute for an ongoing cross-vendor
      check. The check
      fixture lives at <code>supabase/functions/check-gemini-self-bias</code>. It samples up to 150 recent
      stored posts from the past 21 days that are unclassified, low-confidence, or missing a negative complaint
      category, then reruns them through Gemini as an independent second grader and compares those
      labels against the stored Claude labels. It reports sentiment-match and complaint-match rates without
      writing public scores. The check isn't on a schedule today; we run it before trusting a classifier change.
    </p>
    <p>
      Volume gaps are part of the record. The Feb 19 – Mar 7, 2026 gap (no scheduled cron, manual triggers only)
      means our pre-bug baseline for the{" "}
      <a href="/research/claude-april-2026">Claude April 2026 incident</a> is four days, not a robust statistical
      floor.
    </p>
    <p>
      The score lags. Press-cycle echo can drag a model's score below the bug-period score, as it did for Claude
      on April 11–15 (lowest score, post-fix). The retrospective documents that. The companion piece on{" "}
      <a href="/research/cross-model-deltas-march-april-2026">cross-model deltas</a> makes the lag pattern
      visible.
    </p>
    <p>The repo is MIT-licensed. Read it, fork it, file a PR if you have a better classifier prompt.</p>
    <p>
      The longer goal is the same one frontier labs have for safety: telemetry that doesn't sit inside the
      system it's measuring.
    </p>

    <AuthorBio />
  </>
);

export default HowLlmVibesClassifiesSentimentBody;
