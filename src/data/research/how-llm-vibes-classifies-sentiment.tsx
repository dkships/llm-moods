/**
 * Body component for /research/how-llm-vibes-classifies-sentiment.
 *
 * Hand-ported from markdown to JSX so the runtime no longer needs a
 * markdown parser. Visual parity with the previous react-markdown
 * output is preserved by keeping the surrounding `prose prose-invert`
 * wrapper in ResearchPost.tsx.
 */

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
      If you want to verify any of this against the source, every script, query, and prompt referenced here lives
      in the{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods">public repository</ExternalLink>. The classifier
      prompt is in <code>supabase/functions/_shared/classifier.ts</code>. The scoring math is in{" "}
      <code>supabase/functions/_shared/vibes-scoring.ts</code>.
    </p>

    <h2>What gets scraped</h2>
    <p>Six platforms, six edge functions, one orchestrator.</p>
    <p>
      Reddit comes from the Apify <code>trudax~reddit-scraper-lite</code> actor, pulling 40 posts per run from
      five subreddits (r/ClaudeAI, r/ChatGPT, r/LocalLLaMA, r/GoogleGemini, r/artificial). Hacker News uses the
      Algolia API, free and rate-friendly. Bluesky uses the AT Protocol with an authenticated handle. Twitter/X
      uses the Apify <code>apidojo~tweet-scraper</code> actor, four search terms, 50 posts per run. Mastodon uses
      the public API across five instances. Lemmy uses the public API across two instances.
    </p>
    <p>
      A coordinator function (<code>run-scrapers</code>) fires each scraper in batches of three. The schedule
      lives in Supabase <code>pg_cron</code> and runs hourly, but the orchestrator only does a real fetch on
      three Pacific-time windows per day (05:00, 14:00, 21:00). On the other 21 hourly invocations it returns{" "}
      <code>{`{"status":"skipped","reason":"outside_window"}`}</code> in milliseconds, which keeps the cron
      column legible without burning Apify credits.
    </p>
    <p>
      The hourly trigger landed on April 22, 2026. Before that, the orchestrator code shipped without a cron
      schedule for 17 days. That gap is documented in{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods/blob/main/docs/llm-vibes-retrospective-april-2026.md">
        our retrospective
      </ExternalLink>
      .
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
      Every relevant post is sent to <strong>Gemini 3.1 Flash-Lite</strong> via the Google AI API in batches of
      25. The classifier returns six fields per post: <code>relevant</code>, <code>sentiment</code> (positive /
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
        <code>supabase/functions/_shared/vibes-scoring.ts</code> lines 231–325
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
      more than 50% of total weight. If Bluesky alone produces enough volume to dominate a day's score, the cap
      rescales it down. This is the most important guardrail against sentiment shifts that come from one
      platform's local culture rather than a real model-quality change.
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
    <p>Three caveats that anyone reading the dashboard should know.</p>
    <p>
      The classifier vendor is one of the tracked models. Gemini 3.1 Flash-Lite classifies posts about Gemini's
      competitors. There is no evidence of bias in the data (Claude often scores higher than Gemini in the
      windows we've examined, the opposite of what classifier bias toward Gemini would produce), but the
      structural risk is real. We do not yet have a second-model validation harness.
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
    <p>
      The repo is MIT-licensed. Read it, fork it, run it against your own scraper sources, file a PR if you have
      a better classifier prompt.
    </p>
  </>
);

export default HowLlmVibesClassifiesSentimentBody;
