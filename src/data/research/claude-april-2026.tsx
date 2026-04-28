/**
 * Body component for /research/claude-april-2026.
 * Hand-ported from markdown to JSX. EmbeddedModelChart renders inline.
 * Footnote uses a sup link to a #note-1 anchor at the end.
 */

import EmbeddedModelChart from "@/components/research/EmbeddedModelChart";
import AuthorBio from "@/components/research/AuthorBio";
import PullQuote from "@/components/research/PullQuote";
import StatCallout from "@/components/research/StatCallout";

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

const ClaudeApril2026Body = () => (
  <>
    <h2 id="the-28-day-gap">The 28-day gap</h2>
    <p>
      On March 26, 2026, Anthropic shipped a thinking-cache regression into Claude Sonnet 4.6 and Opus 4.6. The
      same day, an LLM Vibes scraper logged a{" "}
      <ExternalLink href="https://bsky.app/profile/tetrac-official.bsky.social/post/3mhxg72ka722t">
        Bluesky post
      </ExternalLink>{" "}
      from <code>@tetrac-official.bsky.social</code> that read, in full: "Restart session, clear conversations,
      clear claude md, give it specific skill and working examples and it's dumb af. Feels like sonnet 3.5 wtf."
      Anthropic{" "}
      <ExternalLink href="https://www.anthropic.com/engineering/april-23-postmortem">
        confirmed the bug 28 days later
      </ExternalLink>
      , on April 23. We logged the grumbling on day zero. We just couldn't tell you so in real time.
    </p>
    <p>
      This piece is the receipts. What our data shows, where it lined up with Anthropic's postmortem, and where
      it didn't.
    </p>

    <StatCallout
      stats={[
        { value: "32 points", label: "Daily score drop, Mar 24 → Mar 27" },
        { value: "28 days", label: "Until Anthropic confirmed the bug" },
      ]}
    />

    <EmbeddedModelChart modelSlug="claude" daysBack={46} />
    <p className="mt-2 text-sm text-foreground/65">
      <em>
        Claude's daily sentiment score, March 14 through today. Shaded bands are Anthropic's three confirmed
        bug windows from the April 23 postmortem. The amber line marks March 27, the user-visible inflection
        day.
      </em>
    </p>

    <h2 id="the-match-up">The match-up</h2>
    <p>
      Anthropic's{" "}
      <ExternalLink href="https://www.anthropic.com/engineering/april-23-postmortem">
        April 23 engineering postmortem
      </ExternalLink>{" "}
      named three bugs running March 4 – April 20. Our classifier had already tagged complaints for all three.
    </p>
    <div className="my-6 overflow-x-auto rounded-lg border border-border">
      <table className="w-full">
        <caption className="sr-only">
          Anthropic's three confirmed bugs from the April 23 postmortem matched to LLM Vibes complaint
          categories.
        </caption>
        <thead>
          <tr>
            <th scope="col">Bug</th>
            <th scope="col" className="whitespace-nowrap">Anthropic window</th>
            <th scope="col">Stated symptom</th>
            <th scope="col">LLM Vibes complaint tag</th>
            <th scope="col" className="whitespace-nowrap">First captured signal</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Reasoning default high → medium</td>
            <td className="whitespace-nowrap">Mar 4 – Apr 7</td>
            <td>"Less intelligent"</td>
            <td>
              <code>reasoning</code>, <code>general_drop</code>
            </td>
            <td>Mar 8 onward (volume gap before)</td>
          </tr>
          <tr>
            <td>Thinking-cache dropped every turn</td>
            <td className="whitespace-nowrap">Mar 26 – Apr 10</td>
            <td>"Forgetful, repetitive, odd tool choices; usage limits drained faster"</td>
            <td>
              <code>context_window</code>, <code>lazy_responses</code>, <code>general_drop</code>
            </td>
            <td className="whitespace-nowrap">
              <strong>Mar 26, same-day</strong>
            </td>
          </tr>
          <tr>
            <td>≤25-word verbosity system prompt</td>
            <td className="whitespace-nowrap">Apr 16 – Apr 20</td>
            <td>~3% coding-quality drop</td>
            <td>
              <code>coding_quality</code>, <code>general_drop</code>
            </td>
            <td className="whitespace-nowrap">Apr 16, same-day</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      For two of three bugs, our scrapers logged matching user-language complaints on the day the bug shipped.
      The mainstream tech press cycle (VentureBeat, Fortune, Simon Willison, The Register, The Decoder) landed
      between April 13 and April 24. The clearest match was the cache bug. Anthropic specifically called out
      faster usage-limit drain, and we had an <code>api_reliability</code> spike on March 27, one day after
      deployment.
    </p>

    <h2 id="the-receipts">The receipts</h2>
    <p>
      Verbatim from our <code>scraped_posts</code> table, paired with the postmortem dates.
    </p>
    <PullQuote
      text="Restart session, clear conversations, clear claude md, give it specific skill and working examples and it's dumb af. Feels like sonnet 3.5 wtf."
      handle="@tetrac-official"
      platform="Bluesky"
      timestamp="2026-03-26 10:42 UTC"
      href="https://bsky.app/profile/tetrac-official.bsky.social/post/3mhxg72ka722t"
      archivedHref="https://web.archive.org/web/2026/https://bsky.app/profile/tetrac-official.bsky.social/post/3mhxg72ka722t"
    />
    <PullQuote
      text="I just experienced something weird, and I'm not sure if it's been like this the entire time or just a bug. I was having a long session with Claude Code, probably consumed about 80% of the 1M tokens (haven't paying attention), I've reached 90% of the 5h tokens usage limit, and then, the 5h window has ended, and right when the next window started, I noticed that it jumps straight to 27% usage..."
      handle="r/ClaudeAI"
      platform="Reddit"
      timestamp="2026-03-27 21:36 UTC"
      href="https://www.reddit.com/r/ClaudeAI/comments/1s5hfa4/"
      archivedHref="https://web.archive.org/web/2026/https://www.reddit.com/r/ClaudeAI/comments/1s5hfa4/"
    />
    <PullQuote
      text="Paying for Claude Max 20x and the token limits still tank mid-session on heavy coding work. If you're selling a premium tier for power users, actually build for power users."
      handle="@mkalkere"
      platform="X"
      timestamp="2026-03-29 23:55 UTC"
      href="https://x.com/mkalkere/status/2038404677000216624"
      archivedHref="https://web.archive.org/web/2026/https://x.com/mkalkere/status/2038404677000216624"
    />
    <p>
      Bug 2 (thinking-cache) shipped March 26. The first quote arrived same-day, comparing Claude to a model
      two generations old. Our classifier tagged it <code>general_drop</code> and <code>lazy_responses</code>,
      the categories Anthropic later mapped to "forgetful and repetitive."
    </p>
    <p>
      The second quote is the token-drain symptom Anthropic admitted to in the postmortem, captured 24 hours
      after deployment. The user describes the cache bug's exact mechanism in plain English without knowing what
      it was. The third quote shows the issue spreading into the paid Claude Max tier within three days, well
      before any tech outlet had filed copy on it.
    </p>

    <h2 id="what-we-got-right">What we got right</h2>
    <p>
      Same-day capture on March 26: an LLM Vibes scraper logged @tetrac-official's "feels like sonnet 3.5"
      post on the day Anthropic shipped the cache change. Over the same 72 hours our daily score for Claude
      fell 32 points, 70 → 38, March 24 → 27. Same-day capture again on March 27: our{" "}
      <code>api_reliability</code> complaint volume jumped on the day Anthropic later said the cache bug
      began burning quota. A one-day match between an internal engineering change and an external sentiment
      pattern is the case for tools like ours existing at all.
    </p>
    <p>
      The cross-model isolation also held up, but not in the way the bug-window numbers alone would tell you.
      During the cache-bug window (March 26 – April 10), Claude scored 48.2, ChatGPT 31.1, Gemini 36.9, Grok
      32.6. Claude was still ahead in absolute terms. Bug-window deltas don't differentiate it either: Claude
      dropped 23, ChatGPT dropped 50, Gemini dropped 39, Grok dropped 16. By that read, ChatGPT looked far
      worse than Claude. The signal that singled Claude out is the <em>post-fix recovery shape</em>. Between
      April 11 and April 15, ChatGPT moved back toward its baseline (31 → 48), Gemini also recovered
      (37 → 42), and Claude fell another 14 points to 34. (Grok kept sliding on much thinner post volume;
      Claude's drop is the only one with high-volume support.) That post-fix divergence is the strongest
      evidence we have that the underlying issue was Claude-specific rather than the press cycle hitting every
      model.
    </p>

    <h2 id="what-we-got-wrong">What we got wrong</h2>
    <p>
      Three things, in order of how much they undercut the dashboard.
    </p>
    <p>
      The April 11–15 trough (score 34, the lowest single-window average on Claude's chart through April 24)
      landed{" "}
      <em>after</em> Anthropic fixed the cache bug on April 10 and <em>before</em> the verbosity-prompt bug on
      April 16. That window is press-cycle echo, not silent-bug detection. The Register published on April 13,
      VentureBeat and Hacker News followed, and our scrapers captured the resulting wave of "Claude is broken"
      posts. Many of those came from users whose actual issues had already been fixed. The dashboard looks more
      like an early-grumble detector than a clean leading indicator.
    </p>
    <p>
      The February 19 – March 7 volume gap is on us. The scraper orchestrator was committed in early March
      but ran on manual triggers only; the hourly cron schedule landed April 22. For 14 of the 35 days when
      Bug 1 was silently active in production, our scrapers captured fewer than 10 Claude posts per day. We
      had no operational alarm telling us post volume had collapsed. That means the "Feb 15–18 baseline" is
      four days of meaningful data, not a robust statistical floor.
    </p>
    <p>
      The classifier itself is one of the tracked models. Sentiment runs through Gemini 2.5 Flash, classifying
      posts about its competitors, Claude included.
      <sup id="ref-1">
        <a href="#note-1" aria-label="See footnote 1">
          [1]
        </a>
      </sup>{" "}
      In this dataset Claude often outscored Gemini, the opposite of what self-favoritism would produce, but
      the structural risk is real and we have no validation harness yet.
    </p>

    <h2 id="what-this-changes">What this changes</h2>
    <p>
      When SaaS reliability mattered enough, third-party status pages and observability tools (StatusGator,
      Downdetector, Datadog's third-party monitors) emerged because vendor-published uptime numbers turned out
      to be a conflict of interest. Frontier-model quality is now in roughly the same position. Anthropic
      published its postmortem 28 days after the bug shipped. That lag, from internal detection to external
      confirmation, is the gap independent telemetry fills. The user-side signal was visible the day the bug
      shipped.
    </p>
    <p>
      AI accountability needs more sources of telemetry that don't sit inside the lab's CI pipeline. We share
      a classifier vendor with our subjects, our scrapers are imperfect, and our lowest score landed on the
      wrong week. We're one source. There should be five.
    </p>

    <h2 id="methodology">Methodology</h2>
    <p>
      LLM Vibes scrapes posts about four LLM models (Claude, ChatGPT, Gemini, Grok) across five social platforms:
      Reddit (Apify), Hacker News (Algolia API), Bluesky (AT Protocol), Twitter/X (Apify), and Mastodon (5
      instances). The orchestrator runs once an hour and the scoring pipeline aggregates a daily 0–100 score per
      model.
    </p>
    <p>
      Each post is classified for sentiment and complaint category by Gemini 2.5 Flash via the Google AI
      API, in batches of 25. Multi-model posts use a per-model targeted prompt so a sentence like "DeepSeek
      fixed Gemini's mess" scores correctly for each model. The daily score is volume-weighted negative-vs-
      positive on a 0–100 scale.
    </p>
    <p>
      The numbers in this article come from the <code>vibes_scores</code> and <code>scraped_posts</code> tables,
      filtered to days with ≥10 total Claude posts (matching the methodology in the public retrospective). All
      quoted text is verbatim. The full data analysis lives in the{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods">public repository</ExternalLink> under{" "}
      <code>docs/claude-april-2026-degradation-analysis.md</code>, and the internal retrospective is at{" "}
      <code>docs/llm-vibes-retrospective-april-2026.md</code>.
    </p>

    <h2 id="what-you-can-do-next">What you can do next</h2>
    <p>
      See the <a href="/model/claude">live Claude chart</a>. The three Anthropic bug bands are overlaid on the
      score history, with annotation arrows on March 26 and April 11.
    </p>
    <p>
      <ExternalLink href="https://github.com/dkships/llm-moods">Read or fork the source on GitHub</ExternalLink>.
      The classifier prompt, the scraper config, and the anomaly-detection logic are all in{" "}
      <code>supabase/functions/_shared/</code>.
    </p>
    <p>
      The next iteration of LLM Vibes will compute recovery-shape divergence as a first-class metric: a single
      number that flags when one model keeps falling while peers recover. The repo is open; PRs welcome.
    </p>

    <h2 id="notes">Notes</h2>
    <p id="note-1" className="scroll-mt-24 text-sm text-foreground/80">
      <a
        href="#ref-1"
        className="font-bold no-underline hover:underline"
        aria-label="Back to reference"
      >
        [1]
      </a>{" "}
      Self-bias risk on the classifier. Gemini 2.5 Flash is the model performing classification and is
      also one of the four tracked models. We have no second-model validation harness yet. Mitigating evidence:
      across the windows examined, Claude often outscored Gemini, the opposite of what classifier bias toward
      Gemini would produce. The risk is structural, and disclosing it is the obligation; spot-checking it is
      the next build item.
    </p>

    <AuthorBio />
  </>
);

export default ClaudeApril2026Body;
