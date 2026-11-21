/**
 * Body component for /research/how-llm-vibes-classifies-sentiment.
 *
 * Hand-ported from markdown to JSX so the runtime no longer needs a
 * markdown parser. Visual parity with the previous react-markdown
 * output is preserved by keeping the surrounding `prose prose-invert`
 * wrapper in ResearchPost.tsx.
 */

import AuthorBio from "@/components/research/AuthorBio";
import ResearchTableFrame from "@/components/research/ResearchTableFrame";

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

const HowLlmVibesClassifiesSentimentBody = () => (
  <>
    <h2>Why a methodology post</h2>
    <p>
      LLM Vibes gives Claude, ChatGPT, Gemini and Grok a score from 0 to 100 each day. It's built from what
      people post about them on Reddit, Hacker News, Bluesky, X and the App Store. A language model labels each
      post positive, negative or neutral, and the score is the weighted share of positive posts, with neutral
      counting as half.
    </p>
    <p>
      This post walks through each step: what I scrape, how a post gets tied to a model and graded, how the
      daily number is computed, how anomalies get flagged, and the limitations I know about. Every script,
      query and prompt referenced here lives in the{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods">public repository</ExternalLink>. Specific paths
      are linked inline as each component comes up.
    </p>

    <h2>What gets scraped</h2>
    <p>Five sources feed the score, each with its own edge function and its own cron schedule.</p>
    <ResearchTableFrame label="LLM Vibes sources as of November 2026">
      <table className="w-full">
        <caption className="sr-only">The five scored sources with access method and cadence.</caption>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">How</th>
            <th scope="col" className="whitespace-nowrap">Cadence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Reddit</td>
            <td>
              Apify <code>harshmaur/reddit-scraper-pro</code>, the newest 20 posts from each of 7 subreddits
            </td>
            <td className="whitespace-nowrap">1×/day</td>
          </tr>
          <tr>
            <td>Hacker News</td>
            <td>Algolia API: stories (with Ask HN bodies) plus up to 60 comments per run that name a model</td>
            <td className="whitespace-nowrap">3×/day</td>
          </tr>
          <tr>
            <td>Bluesky</td>
            <td>AT Protocol search over 9 configured terms plus active rumor terms; link shares and noisy accounts skipped</td>
            <td className="whitespace-nowrap">3×/day</td>
          </tr>
          <tr>
            <td>X</td>
            <td>
              Apify <code>xquik/x-tweet-scraper</code>, 5 query lanes, up to 250 posts per run
            </td>
            <td className="whitespace-nowrap">2×/day</td>
          </tr>
          <tr>
            <td>App Store</td>
            <td>Apple's free US review RSS for the four iOS apps, up to 15 reviews per app per run</td>
            <td className="whitespace-nowrap">3×/day</td>
          </tr>
        </tbody>
      </table>
    </ResearchTableFrame>
    <p>
      The seven subreddits are r/ChatGPT, r/ChatGPTPro and r/codex for ChatGPT, r/ClaudeAI and r/ClaudeCode for
      Claude, r/GeminiAI and r/grok. The scraper reads each one's <code>/new</code> listing page, because the
      actor's default subreddit mode ignored sort order and returned mostly days-old posts. I moved to the
      harshmaur actors after Reddit's public <code>.json</code> API started returning 403s in May 2026, and to
      the cheaper <code>-pro</code> version of the same actor in October. Reddit runs once a day and X twice
      because both go through a $29/month Apify plan, which ran out around day 17 in August 2026 and left both
      sources dark for two weeks.
    </p>
    <p>
      The five X lanes are ChatGPT, Claude and Gemini together, Grok, rumored models, and a roundup of known
      leakers and tech press. The last two exist mainly for the{" "}
      <a href="/rumors">rumors radar</a>. Bluesky's search terms live in a config table, so I can change them on a
      model launch without a deploy.
    </p>
    <p>
      Four other feeds exist in the repo and don't feed the score. OpenRouter's public model list runs three
      times a day for the rumors radar only, and the classifier drops its rows as announcements. Mastodon was
      unscheduled on August 22, 2026, after 83% of its classified posts came back irrelevant. GitHub issues ran
      from August 22 to September 1. Bug reports can only be negative, they pulled Claude down about 10 to 13
      points a day, and the source is now excluded from scoring in code. A Threads scraper was built on November
      17 and never scheduled: a trial found 4 relevant posts out of 45, about $3 per 100 relevant posts against
      $0.20 to $0.79 for the sources above.
    </p>
    <p>
      Classification is decoupled from scraping. Scrapers insert posts as <code>pending</code>, a separate cron
      drains the classification queue every two minutes, and another recomputes the last seven days of scores
      every 30 minutes. There's no orchestrator and no shared failure domain, so a Reddit timeout can't stop the
      Bluesky run.
    </p>
    <p>
      It didn't start that way. The original design ran a single orchestrator function
      (<code>run-scrapers</code>), committed in early March 2026 on manual triggers, with an hourly cron
      schedule landing April 22; that gap is documented in{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods/blob/main/docs/llm-vibes-retrospective-april-2026.md">
        my retrospective
      </ExternalLink>
      . On May 8, 2026 the merged pipeline blew the edge-function time budget and was split into the
      independent crons described above. The old orchestrators were deleted on August 22.
    </p>

    <h2>How posts get attributed to a model</h2>
    <p>
      Matching is deterministic and keyword-based, using the <code>model_keywords</code> table loaded at
      runtime. Specific names match outright: <code>ChatGPT</code>, <code>GPT-6</code>, <code>Claude Code</code>,{" "}
      <code>Gemini 3 Pro</code>, <code>SuperGrok</code>. Bare names that also mean other things only match next to
      a context word. <code>Claude</code> needs a word like "model", "prompt" or "coding" nearby, and{" "}
      <code>Grok</code> needs "xAI" or "Elon Musk". <code>gpt</code> and <code>openai</code> also don't match
      ChatGPT when the post points at a self-hosted model (<code>gpt-oss</code>, <code>ollama</code>,{" "}
      <code>huggingface.co/openai/gpt-oss</code>).
    </p>
    <p>
      Some sources attribute by where the post lives. A post in a model's own subreddit is attributed to that
      model even if it never names it, and keyword matches can add other models. App Store reviews are
      attributed by app. The classifier sees the post prefixed with "(posted in r/ClaudeAI)", so a post that
      says "it just deleted my whole repo" still counts as being about Claude.
    </p>
    <p>
      A post that matches more than one model is graded separately for each, with a prompt that names the
      target model. In <em>"I switched from ChatGPT to Claude and it's so much better"</em>, the post is
      positive for Claude and negative for ChatGPT. That example is in the prompt itself. The repo still holds two
      older prompts that don't name a target; production uses only the targeted one.
    </p>

    <h2>How sentiment gets classified</h2>
    <p>
      Every attributed post goes to <strong>GPT-6.2 Sol</strong> (<code>gpt-6.2-sol</code>) through OpenAI's
      Chat Completions API, in batches of 20, at low reasoning effort, with the first 2,000 characters of each
      post. The provider is a config switch. <code>CLASSIFIER_MODEL</code> routes <code>claude-*</code> ids to
      Anthropic, <code>gpt-*</code> ids to OpenAI and anything else to Gemini, so changing the classifier needs
      no deploy. When an OpenAI call fails with a transient error, the drain retries those posts through Gemini
      2.5 Flash so the queue doesn't stall.
    </p>
    <p>
      The classifier returns seven fields per post: <code>relevant</code>, <code>sentiment</code> (positive /
      negative / neutral), <code>complaint_category</code> (if negative), <code>praise_category</code> (one of 10
      if positive), <code>confidence</code> (0.0–1.0), <code>language</code>, and an{" "}
      <code>english_translation</code> if the post isn't in English.
    </p>
    <p>
      The prompt offers 12 complaint categories: <code>lazy_responses</code>, <code>hallucinations</code>,{" "}
      <code>refusals</code>, <code>coding_quality</code>, <code>speed</code>, <code>general_drop</code>,{" "}
      <code>pricing_value</code>, <code>censorship</code>, <code>context_window</code>,{" "}
      <code>api_reliability</code>, <code>multimodal_quality</code>, and <code>reasoning</code>. A negative post
      that fits none of them is stored as <code>other</code>, the 13th value the schema allows. They are
      deliberately coarse. A public dashboard rewards stable category labels readers can recognize over time.
    </p>
    <p>
      The relevance test is strict on purpose. The prompt asks whether the author is expressing satisfaction or
      frustration with the model itself, based on using it, and says to default to not relevant when unsure.
      News, launch announcements, benchmark reports, outage posts, ads and commentary about AI in general are
      dropped. Over the 14 days to November 17, the share of classified posts kept as relevant was 8.5% on
      Bluesky, 17% on X, 34% on Hacker News, about 39% on Reddit and 84% on the App Store.
    </p>
    <p>
      Non-English posts are translated by the same call and stored alongside the original. Original-language
      text stays in <code>content</code>; the translation goes into <code>translated_content</code>. The
      detected ISO code goes into <code>original_language</code>. There is no separate translation API call.
    </p>

    <h2>How a daily score gets computed</h2>
    <p>
      The published score holds each source at its usual share of a model's weight. The code is at{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods/blob/main/supabase/functions/_shared/vibes-scoring.ts">
        <code>supabase/functions/_shared/vibes-scoring.ts</code> (<code>computeFixedMixScore</code>)
      </ExternalLink>
      .
    </p>
    <p>
      I built it this way because the mix of sources behind a model's day is set mostly by my scrapers, and App
      Store reviews run 78–93% positive for every model. Under the older pooled formula, a day with few reviews
      read as a drop. On November 16, ChatGPT's pooled score fell from 50 to 42 with no App Store reviews in the
      sample and every other source flat. Since November 17 the published score works like this:
    </p>
    <pre>
      <code>{`score = Σ over sources: share × (n × today + 5 × usual) / (n + 5)
n = eligible posts from that source today`}</code>
    </pre>
    <p>
      <code>share</code> and <code>usual</code> come from the model's trailing 28 days: each source's share of
      the model's weight in that window (after the caps below), and its score in that window. A source needs at
      least 10 eligible posts in the window to count. A source with only a few posts today is pulled toward its
      usual level, and a source with none counts at that level, so only a change in how people talk on a source
      moves the number. A model without enough history on any source falls back to the pooled score.
    </p>
    <p>
      Recomputed over the 51 days from September 28, the change kept every model's average within a point and
      cut day-to-day movement by 30–50%. The pooled score is still computed and stored beside it as{" "}
      <code>pooled_score</code>. Days before September 28, including every chart pinned in my research posts,
      are as stored.
    </p>
    <p>
      The fixed-mix number is then blended with the previous day's published score. A day with 10 or more
      eligible posts gets 70% of the weight. Thinner days lean more on yesterday, down to 20% for a day with
      one post. I chose stability over speed here: a lasting shift shows up 70% on the first day and about 90%
      by the second.
    </p>
    <p>
      Each source's level, today and in the trailing window, is built from per-post weights. For each eligible
      post in a Pacific-time calendar day:
    </p>
    <pre>
      <code>{`weight = confidence × engagement × content_multiplier
engagement = clamp(ln(upvotes + 1), 1.0, ln(1001))
content_multiplier = 0.6 if title-only else 1.0`}</code>
    </pre>
    <p>
      I added the engagement clamp in July 2026 after an accuracy audit. The raw <code>ln(score + 1)</code> made
      a 1-upvote post weigh <em>less</em> than a 0-upvote post, and an uncapped value let one viral tweet supply
      most of a day's weight. Floored at 1 and capped at ln(1001), engagement is monotonic and bounded.
    </p>
    <p>
      Eligibility means <code>confidence &gt;= 0.65</code>. Below that floor the classifier is unsure, so I drop
      the post. GitHub issues are excluded before any of this runs.
    </p>
    <p>
      No source may hold more than 50% of a model's weight, and App Store reviews no more than 35%. I set the
      App Store cap lower in September 2026 because those reviews are mostly star ratings of the app ("cool app
      for image editing") and were 55–80% of Gemini's and Grok's relevant volume. The caps apply in full once
      the other sources together carry 3.0 units of weight (about three confident posts), and loosen toward no
      cap below that, so a day with one real source isn't scaled against nothing. The trade-off is deliberate:
      the score reacts less to one community's mood and is less exposed to one platform's moderation change.
    </p>
    <p>Within a source, after capping, the level is:</p>
    <pre>
      <code>{`effective_positive = positive_weight + 0.5 × neutral_weight
score = round((effective_positive / total_weight) × 100)`}</code>
    </pre>
    <p>
      Neutral posts count as exactly score-neutral: a day full of <em>"meh"</em> posts scores 50, matching the
      empty-day default, so the chart line doesn't dive on missing data. The coefficient was 0.3 until July 10,
      2026, so an all-neutral day used to score 30, which dragged scores down on launch and news days when
      factual comparison posts spike. Recomputing every June and July model-day under the new formula moved
      stored scores by about 1 point on average, because neutral share runs only about 6% after the relevance
      gate, so I left those days as stored.
    </p>
    <p>
      The headline number on each model card skips the current Pacific day while it has fewer than 5 eligible
      posts and shows the last settled day instead. Charts draw today as a dashed provisional tail, and any day
      with fewer than 5 high-confidence posts gets a hollow marker and a "limited sample" note.
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
      The baseline only uses fully measured days with at least 5 eligible posts, and a row is skipped if fewer
      than 3 such days exist. The day being tested is skipped too if it has fewer than 5 eligible posts or under
      80% of its posts classified. The standard deviation is floored at 1, so a very quiet model doesn't flag a
      3-point move as a breach. The full anomaly list is admin-only at <code>/admin/scrapers</code> (gated to dev
      builds via <code>import.meta.env.DEV</code> so production bundles physically exclude the route).
    </p>
    <p>
      The same anomaly stream feeds the status-correlation chip on each model's{" "}
      <a href="/model/claude">Official Status</a> card. When a vendor publishes a status incident, the card
      cross-references its date against any breach or watch anomalies for that model within ±2 days and shows
      the match inline.
    </p>

    <h2>What this analysis assumes</h2>
    <p>These are the limitations anyone reading the dashboard should know.</p>
    <p>
      One model grades everything. Every label comes from a single classifier, so its mistakes move every
      score, and a classifier change shifts the mix. When GPT-6 Sol replaced GPT-5.6 Terra in September, the
      first 84 Hacker News posts Sol graded came back 72.6% irrelevant, against 55.8% for Terra over the 28
      hours before, because Sol is stricter about relevance.
    </p>
    <p>
      The classifier vendor is one of the tracked models. GPT-6.2 Sol is an OpenAI model grading posts about
      ChatGPT, so a pro-ChatGPT lean is the risk I watch most. From June to August the grader was Claude Haiku
      4.5, which pointed the same risk at Claude. Before switching to GPT-6.2 Sol, I ran 240 posts (60 per model,
      all five sources) through it and compared the labels against Claude Opus 5.5 as a reference. They agreed
      on sentiment for 90.8% of posts. That sample covers all four models, so it tests accuracy more than
      self-preference.
    </p>
    <p>
      The closer test came with the{" "}
      <a href="/research/gpt-6-2-astra-launch-claims-vs-reception-2026">GPT-6.2 launch article</a>. Claude Sonnet
      regraded 99 relevant posts about GPT-6.2 that GPT-6.2 Sol had graded, and the two agreed on sentiment for
      94, with no post flipping between positive and negative. That's one check on one launch. It doesn't prove
      the grader is neutral about ChatGPT in general.
    </p>
    <p>
      The reusable harness lives at <code>supabase/functions/check-gemini-self-bias</code>. It draws a
      stratified sample of up to 300 classified posts from the past 21 days (75 per model by default, with
      minimums for non-English and multi-model posts) and runs them through candidate models and a reference
      grader (Gemini 2.5 Pro by default), or compares against the stored production labels. It reports sentiment
      and complaint agreement without writing public scores. Neither it nor the batch eval
      (<code>classifier-eval-batch</code>) runs on a schedule; I run them before trusting a classifier change.
    </p>
    <p>
      The platform mix shapes each model's score. Platforms differ in tone: in mid-November, r/grok and
      r/GeminiAI posts that took a side were 27% positive and r/ClaudeAI posts 61%. The fixed mix stops a change
      in the mix from moving the number, but each model's usual mix still differs. In the 14 days to November 17, Hacker News produced 728
      relevant Claude posts and 6 relevant Grok posts, and Bluesky barely discusses Grok. Grok's score rests
      mostly on App Store reviews, r/grok and X.
    </p>
    <p>
      Samples are small for Grok and often for Gemini. At noon Pacific, Grok's current day often holds 1 to 3
      eligible posts, which is why the headline skips thin current days and why the smoothing leans on the
      previous day.
    </p>
    <p>
      The sources lean English. The X lanes filter to English, and App Store reviews come from the US store.
      Bluesky and Hacker News aren't filtered by language, and 27% of Bluesky's relevant posts in one September
      check were Japanese. Non-English posts are translated and scored, but the communities I sample are mostly
      English-speaking.
    </p>
    <p>
      Recent days can still move. Each score refresh recomputes the last seven days, so a post that's
      classified late, or scraped the morning after it was written, can change yesterday's number.
    </p>
    <p>
      Volume gaps are part of the record. The Feb 19 – Mar 7, 2026 gap (no scheduled cron, manual triggers only)
      means the pre-bug baseline for the{" "}
      <a href="/research/claude-april-2026">Claude April 2026 incident</a> is four days, not a solid statistical
      floor.
    </p>
    <p>
      The score lags. Press-cycle echo can drag a model's score below the bug-period score, as it did for Claude
      on April 11–15 (lowest score, post-fix). The retrospective documents that. The companion piece on{" "}
      <a href="/research/cross-model-deltas-march-april-2026">cross-model deltas</a> makes the lag pattern
      visible.
    </p>

    <h2>How the pipeline has changed</h2>
    <p>
      Older charts were built under different classifiers and rules. The changes that affect how to read them:
    </p>
    <ul>
      <li>
        March 20, 2026: classification moved from the Lovable AI gateway to the Google Gemini API (2.5
        Flash-Lite, then 3.1 Flash-Lite Preview). Neutral share fell 22 to 37 percentage points across the four
        models that week.
      </li>
      <li>April 25: Gemini 2.5 Flash.</li>
      <li>May 8: the orchestrator was split into independent crons.</li>
      <li>June 1: Claude Haiku 4.5.</li>
      <li>
        July 10: neutral counted as 0.5 instead of 0.3, the engagement clamp, Hacker News comments, and App Store
        reviews.
      </li>
      <li>August 8: GPT-5.6 Terra.</li>
      <li>August 22: Mastodon unscheduled; Reddit cut to once a day and X to twice.</li>
      <li>September 1: GitHub issues excluded and unscheduled; the 35% App Store cap.</li>
      <li>September 20: the headline skips a thin current day.</li>
      <li>
        September 23: GPT-6 Sol, which matched a reference grader's complaint category on 82% of negative posts
        against Terra's 68%, and dropped more borderline posts as irrelevant.
      </li>
      <li>October 7: GPT-6.1 Sol.</li>
      <li>
        November 17: GPT-6.2 Sol, and the fixed-mix score, recomputed back to September 28.
      </li>
    </ul>
    <p>
      The <a href="/research/claude-april-2026">Claude April 2026</a> and{" "}
      <a href="/research/cross-model-deltas-march-april-2026">cross-model deltas</a> articles were corrected
      on November 21, 2026. Their original "February baseline" came from placeholder rows left by the app's
      first build, not from scraped posts. Both now use the stored daily scores from March 8 on, and compare
      against the six days before the bug shipped. Scores from before March 20 rest on very few posts.
    </p>
    <p>The repo is MIT-licensed. Read it, fork it, file a PR if you have a better classifier prompt.</p>
    <p>
      Next on my list is re-measuring each source's yield after the November changes, including whether
      r/ChatGPTPro's early 59% relevance holds up past its first two weeks.
    </p>

    <AuthorBio />
  </>
);

export default HowLlmVibesClassifiesSentimentBody;
