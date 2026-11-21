/**
 * Body component for /research/claude-april-2026.
 * Hand-ported from markdown to JSX. EmbeddedModelChart renders inline.
 * Footnote uses a sup link to a #note-1 anchor at the end.
 */

import EmbeddedModelChart from "@/components/research/EmbeddedModelChart";
import AuthorBio from "@/components/research/AuthorBio";
import PullQuote from "@/components/research/PullQuote";
import StatCallout from "@/components/research/StatCallout";
import ResearchTableFrame from "@/components/research/ResearchTableFrame";

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

const ClaudeApril2026Body = () => (
  <>
    <h2 id="the-28-day-gap">The 28-day gap</h2>
    <p>
      On March 26, 2026, a Bluesky user posted: "Restart session, clear conversations, clear claude md, give it
      specific skill and working examples and it's dumb af. Feels like sonnet 3.5 wtf…"{" "}
      <ExternalLink href="https://bsky.app/profile/tetrac-official.bsky.social/post/3mhxg72ka722t">
        That post
      </ExternalLink>{" "}
      went up the same day Anthropic shipped a thinking-cache regression into Claude Sonnet 4.6 and Opus 4.6.
      Anthropic{" "}
      <ExternalLink href="https://www.anthropic.com/engineering/april-23-postmortem">
        confirmed the bug 28 days later
      </ExternalLink>
      , on April 23. LLM Vibes logged the grumbling on day zero. I just couldn't tell you so in real time.
    </p>
    <p>
      This piece compares my data with Anthropic's postmortem: where they line up, and where they don't.
    </p>

    <StatCallout
      stats={[
        { value: "20 points", label: "Claude's daily score, six-day average before the bug shipped (58) → the day after (38)" },
        { value: "28 days", label: "Until Anthropic confirmed the bug" },
      ]}
    />

    <EmbeddedModelChart modelSlug="claude" startDate="2026-03-10" endDate="2026-04-25" />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Claude's daily sentiment score, March 10 through April 25, 2026 (the publication window). Shaded bands
        are Anthropic's three confirmed bug windows from the April 23 postmortem. The amber line marks March
        27, the user-visible inflection day.
      </em>
    </p>

    <h2 id="the-match-up">The match-up</h2>
    <p>
      Anthropic's{" "}
      <ExternalLink href="https://www.anthropic.com/engineering/april-23-postmortem">
        April 23 engineering postmortem
      </ExternalLink>{" "}
      named three bugs running March 4 – April 20. The LLM Vibes classifier had already tagged complaints for
      all three.
    </p>
    <ResearchTableFrame label="Anthropic confirmed bugs matched to LLM Vibes complaint categories">
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
    </ResearchTableFrame>
    <p>
      For two of three bugs, the scrapers logged matching user-language complaints on the day the bug shipped.
      The mainstream tech press cycle (VentureBeat, Fortune, Simon Willison, The Register, The Decoder) landed
      between April 13 and April 24. The clearest match was the cache bug. Anthropic specifically called out
      faster usage-limit drain, and the second quote below is a user describing exactly that on March 27, one
      day after deployment.
    </p>

    <h2 id="the-receipts">The receipts</h2>
    <p>
      Three posts from the <code>scraped_posts</code> table, paired with the postmortem dates.
    </p>
    <PullQuote
      text="Restart session, clear conversations, clear claude md, give it specific skill and working examples and it's dumb af. Feels like sonnet 3.5 wtf…"
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
      href="https://www.reddit.com/r/ClaudeAI/comments/1s5hfa4/27_of_the_5hour_tokens_usage_consumed_in_an/"
    />
    <PullQuote
      text="Paying for Claude Max 20x and the token limits still tank mid-session on heavy coding work. If you're selling a premium tier for power users, actually build for power users. …"
      handle="@mkalkere"
      platform="X"
      timestamp="2026-03-29 23:55 UTC"
      href="https://x.com/mkalkere/status/2038404677000216624"
      archivedHref="https://web.archive.org/web/2026/https://x.com/mkalkere/status/2038404677000216624"
    />
    <p>
      Bug 2 (thinking-cache) shipped March 26. The first quote arrived same-day, comparing Claude to a model
      two generations old. The classifier tagged it <code>general_drop</code> and <code>lazy_responses</code>.
      Anthropic's postmortem later described the cache bug's symptoms as "forgetfulness, repetition, and odd
      tool choices."
    </p>
    <p>
      The second quote is the token-drain symptom from the postmortem, posted a day after deployment. A jump
      to 27% right at the window rollover is the kind of usage drain Anthropic later attributed to the cache
      bug. I can't prove this user hit that bug. The third quote is a Max 20x subscriber three days in. It's
      one post, but it's two weeks before the first press coverage on April 13.
    </p>

    <h2 id="what-we-got-right">What the data got right</h2>
    <p>
      Same-day capture on March 26: an LLM Vibes scraper logged @tetrac-official's "feels like sonnet 3.5"
      post on the day Anthropic shipped the cache change. The score moved with it. Over the six days before
      the bug shipped (March 20–25), Claude's daily score averaged 58. On March 26 it was 48, and on March 27
      it was 38.
    </p>
    <p>
      One caution on that drop. The highest day in the run-up, a 70 on March 24, was followed by a 55 on
      March 25, the day before the bug shipped. So some of the fall from the peak is ordinary day-to-day
      swing. The 20 points I'm counting is from the six-day average, not from the peak.
    </p>
    <p>
      The other three models help here. During the cache-bug window (March 26 – April 10), Claude averaged
      47.6, down about 11 points from its six days before. ChatGPT went the other way, from 25.5 to 32.0.
      Grok was flat (33.5 to 34.6). Gemini slipped from 46.2 to 38.4, on about a third of Claude's post
      volume. Claude was the only well-covered model that fell when the bug shipped. My read is that this is
      the strongest evidence the problem was Claude's and not a bad news week for every model.
    </p>
    <p>
      After the fix on April 10, Claude's score dropped again, to an average of 36 for April 11–15, while
      ChatGPT rose to 46. Then Claude recovered to the high 40s (48.8 for April 16–20).
    </p>

    <h2 id="what-we-got-wrong">What the data got wrong</h2>
    <p>
      Four things, in order of how much they undercut the dashboard.
    </p>
    <p>
      The April 11–15 trough (single-day low of 29, window average 36, the lowest stretch on Claude's chart
      with real post volume) landed <em>after</em> Anthropic fixed the cache bug on April 10 and{" "}
      <em>before</em> the verbosity-prompt bug on April 16. My read is that this window is an echo of the
      press cycle and not a hidden bug. The Register published on April 13, VentureBeat and Hacker News
      followed, and the scrapers captured the resulting wave of "Claude is broken" posts. Many of those came
      from users whose actual issues had already been fixed. So the lowest score landed on the wrong week.
    </p>
    <p>
      The "before" is only six days. LLM Vibes started scraping on March 8, ran on manual triggers until an
      hourly schedule landed on April 22, and didn't collect steady daily volume for Claude until March 20.
      That was six days before the cache bug shipped. An earlier version of this article compared the bug
      window against a "February baseline." Those February rows were placeholder data from the app's first
      build, not scraped posts. I've removed every number that depended on them, and the downloadable
      dataset now starts on March 8.
    </p>
    <p>
      The score is all of Claude. The postmortem says the bugs affected Claude Code, the Agent SDK and
      Cowork, and that the API was not impacted. The first quote above is about Claude in general, not Claude
      Code. I split the same window by product surface in{" "}
      <a href="/research/surface-segmentation-march-may-2026">a later piece</a>.
    </p>
    <p>
      The classifier came from one of the tracked labs. When these posts were scored, sentiment ran through
      a Google Gemini Flash model, classifying posts about Gemini alongside Claude, ChatGPT and Grok.
      <sup id="ref-1">
        <a href="#note-1" className="inline-flex min-h-6 min-w-6 items-center justify-center" aria-label="[1] See footnote 1">
          [1]
        </a>
      </sup>{" "}
      The structural risk is real: the classifier could have favored Gemini.
    </p>

    <h2 id="what-this-changes">What this changes</h2>
    <p>
      When SaaS reliability mattered enough, third-party status pages and observability tools (StatusGator,
      Downdetector, Datadog's third-party monitors) emerged because vendor-published uptime numbers turned out
      to be a conflict of interest. Frontier-model quality is now in roughly the same position. Anthropic
      published its postmortem 28 days after the bug shipped. The user-side signal was visible the day the
      bug shipped.
    </p>
    <p>
      For a frontier-model team, an outside signal is useful even when the score is noisy, because it comes
      from somewhere other than the lab. Internal evals measure what the model can do on curated tasks. A
      public-grumble dataset measures what users feel when those tasks meet their workflows. They answer
      different questions. If the two disagree for a week, I'd treat that as a bug report.
    </p>
    <p>
      LLM Vibes is one outside source, and an imperfect one. The classifier came from a lab it was grading,
      the scrapers had gaps, and the lowest score landed on the wrong week. I'd like to see more sources like
      it, built by other people.
    </p>

    <h2 id="methodology">Methodology</h2>
    <p>
      During this article's window, LLM Vibes scraped posts about four LLM models (Claude, ChatGPT, Gemini, Grok) across five social platforms:
      Reddit (Apify), Hacker News (Algolia API), Bluesky (AT Protocol), Twitter/X (Apify), and Mastodon (5
      instances). The scrapers ran on manual triggers until April 22, which is why some days are thin, and
      the scoring pipeline aggregated a daily 0–100 score per model.
    </p>
    <p>
      Each post was classified for sentiment and complaint category by a Gemini Flash model, in batches.
      Multi-model posts used a per-model targeted prompt so a sentence like "Claude fixed what Gemini broke"
      scored correctly for each model. The daily score was volume-weighted negative-vs-positive on a 0–100
      scale. The pipeline has changed since; the{" "}
      <a href="/research/how-llm-vibes-classifies-sentiment">methodology page</a> describes the current one.
    </p>
    <p>
      The numbers in this article come from the <code>vibes_scores</code> table as it stands today, and the{" "}
      <a href="/research/claude-april-2026/data.csv">downloadable dataset</a> is the same rows, March 8 –
      April 24. Window figures are plain averages of the daily scores. Quoted text is verbatim, with cuts
      marked. The full data analysis lives in the{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods">public repository</ExternalLink> under{" "}
      <code>docs/claude-april-2026-degradation-analysis.md</code>, and the internal retrospective is at{" "}
      <code>docs/llm-vibes-retrospective-april-2026.md</code>.
    </p>

    <h2 id="what-you-can-do-next">What you can do next</h2>
    <p>
      See the <a href="/model/claude">live Claude chart</a> for current sentiment. The Anthropic bug windows
      from this article are marked as shaded bands on the embedded charts above.
    </p>
    <p>
      <ExternalLink href="https://github.com/dkships/llm-moods">Read or fork the source on GitHub</ExternalLink>.
      The classifier prompt, the scraper config, and the anomaly-detection logic are all in{" "}
      <code>supabase/functions/_shared/</code>.
    </p>
    <p>
      One open item. The comparison that mattered here was Claude against the other three models over the
      same days, and the dashboard still doesn't show that as its own number. It should.
    </p>

    <h2 id="notes">Notes</h2>
    <p id="note-1" className="scroll-mt-24 text-sm text-text-secondary">
      <a
        href="#ref-1"
        className="inline-flex min-h-6 min-w-6 items-center justify-center font-bold no-underline hover:underline"
        aria-label="[1] Back to reference 1"
      >
        [1]
      </a>{" "}
      Self-bias risk on the classifier. When this article's posts were scored, a Gemini Flash model did the
      classification, and Gemini is one of the four tracked models, so the risk ran toward favoring Gemini.
      In April 2026 I reran a sample of labels through Claude Sonnet 4.6 and the two graders agreed on
      sentiment about 92% of the time. That suggests the grader's vendor wasn't the main driver of the
      label. It doesn't prove neutrality. The production classifier has changed several times since.
    </p>

    <AuthorBio />
  </>
);

export default ClaudeApril2026Body;
