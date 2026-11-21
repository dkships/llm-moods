/**
 * Body component for /research/surface-segmentation-march-may-2026.
 * Per-(model, surface) sentiment slice over Mar 15 – May 14, 2026.
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

const SurfaceSegmentationBody = () => (
  <>
    <h2 id="the-19-point-split">The 19-point split</h2>
    <p>
      On March 27, 2026, a day after Anthropic shipped a thinking-cache regression into Claude Sonnet 4.6 and
      Opus 4.6, Theo Browne posted on X (a bot account mirrored it to Bluesky): "Claude Code is kind of like if
      Codex was drunk. Fun, friendly, bit more creative, makes really dumb mistakes, probably shouldn't be
      trusted with prod." The dashboard's daily Claude score moved that week. The scrapers captured the
      grumbling, but the score didn't say which Claude people were grumbling about.
    </p>
    <p>
      Over the 16 days of the cache bug, the average score for posts about Claude Code fell from 63.6 to 44.9.
      Over the same 16 days, the average for everything else the scrapers caught about Claude fell from 56.3 to
      52.5. Same model, same week, two very different stories.
    </p>
    <p>
      The baseline for Claude Code is the five scored days from March 20 to 24 (66, 44, 71, 37 and 100), and the
      100 on March 24 rests on 16 posts. The baseline for everything else is the six scored days from March 20
      to 25. Weighting each day by its post count, Claude Code fell about 20 points (63.7 to 43.6) and the rest
      of Claude fell about 5.5 (57.5 to 51.9).
    </p>

    <StatCallout
      stats={[
        { value: "19 points", label: "Claude Code drop, cache-bug window" },
        { value: "4 points", label: "Non-Claude-Code Claude drop, same window" },
      ]}
    />

    <PullQuote
      text="Claude Code is kind of like if Codex was drunk. Fun, friendly, bit more creative, makes really dumb mistakes, probably shouldn't be trusted with prod."
      handle="@theo (mirrored by theo.xmirror.bot)"
      platform="Bluesky"
      timestamp="2026-03-27 03:10 UTC"
      href="https://bsky.app/profile/theo.xmirror.bot/post/3mhz6rvi2z42g"
      archivedHref="https://web.archive.org/web/2026/https://bsky.app/profile/theo.xmirror.bot/post/3mhz6rvi2z42g"
    />

    <p>
      Aggregate model scores treat each frontier model as one product, but people use different parts of it.
      Claude Code was 1,183 of the 3,962 Claude posts in the table below (30%), and 98.8% of the Claude posts
      that named a surface. So a bad week for Claude Code can move the Claude score without telling you anything
      about claude.ai. This piece slices the same scoring pipeline by product surface instead of by model.
    </p>

    <h2 id="what-the-data-actually-says">What the data actually says</h2>
    <p>
      Across the two months from March 15 to May 14, 2026, I ran every Claude, ChatGPT, Gemini, and Grok post
      the scrapers captured through a lexical surface detector. The detector lives at{" "}
      <code>src/lib/product-surface.ts</code> and matches plain-language references like "Claude Code,"
      "claude.ai," "Anthropic API," "ChatGPT mobile," "Codex," "Gemini app," and so on, model by model. Posts
      that don't match a named surface stay in an <code>unknown</code> bucket.
    </p>

    <ResearchTableFrame label="Sentiment scores by model and product surface from March 15 to May 14, 2026">
      <table className="w-full">
        <caption className="sr-only">
          Per-model, per-product-surface window-aggregate sentiment scores from LLM Vibes scraped_posts,
          March 15 to May 14, 2026.
        </caption>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Surface</th>
            <th scope="col" className="whitespace-nowrap">Posts captured</th>
            <th scope="col" className="whitespace-nowrap">Avg score</th>
            <th scope="col">Top complaint</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Claude</td>
            <td>Claude Code (CLI)</td>
            <td className="whitespace-nowrap">1,183</td>
            <td className="whitespace-nowrap">52.1</td>
            <td><code>general_drop</code></td>
          </tr>
          <tr>
            <td>Claude</td>
            <td>claude.ai (web)</td>
            <td className="whitespace-nowrap">14</td>
            <td className="whitespace-nowrap">— thin</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Claude</td>
            <td>Unknown</td>
            <td className="whitespace-nowrap">2,765</td>
            <td className="whitespace-nowrap">48.2</td>
            <td><code>general_drop</code></td>
          </tr>
          <tr>
            <td>ChatGPT</td>
            <td>Posts that say "ChatGPT"</td>
            <td className="whitespace-nowrap">4,077</td>
            <td className="whitespace-nowrap">38.1</td>
            <td><code>general_drop</code></td>
          </tr>
          <tr>
            <td>ChatGPT</td>
            <td>Codex (CLI)</td>
            <td className="whitespace-nowrap">33</td>
            <td className="whitespace-nowrap">— thin</td>
            <td>—</td>
          </tr>
          <tr>
            <td>ChatGPT</td>
            <td>Unknown</td>
            <td className="whitespace-nowrap">1,086</td>
            <td className="whitespace-nowrap">26.1</td>
            <td><code>general_drop</code></td>
          </tr>
          <tr>
            <td>Gemini</td>
            <td>Any named surface</td>
            <td className="whitespace-nowrap">126</td>
            <td className="whitespace-nowrap">— thin</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Gemini</td>
            <td>Unknown</td>
            <td className="whitespace-nowrap">2,124</td>
            <td className="whitespace-nowrap">38.6</td>
            <td><code>general_drop</code></td>
          </tr>
          <tr>
            <td>Grok</td>
            <td>Any named surface</td>
            <td className="whitespace-nowrap">10</td>
            <td className="whitespace-nowrap">— thin</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Grok</td>
            <td>Unknown</td>
            <td className="whitespace-nowrap">1,858</td>
            <td className="whitespace-nowrap">34.6</td>
            <td><code>general_drop</code></td>
          </tr>
        </tbody>
      </table>
    </ResearchTableFrame>

    <p>
      Two patterns to notice. First, for Claude, one surface dominates the named conversation. Of the 1,197
      Claude posts that named a surface, 98.8% named Claude Code. API and SDK mentions never cleared the
      five-post daily floor, so they don't appear in the dataset at all. That means there were too few API and
      SDK posts to chart, and I can't say more than that. ChatGPT's 4,110 named-surface posts are mostly posts
      that contain the word "ChatGPT", which I come back to below.
    </p>
    <p>
      Second, for Gemini and Grok, almost no posts name a surface at all. The detector matched 126 Gemini
      posts (5.6%) and 10 Grok posts (0.5%) across the whole window, every one in a cell too thin to chart.
      I come back to why below.
    </p>

    <h2 id="claude-during-the-cache-bug">Claude during the cache bug</h2>
    <p>
      The match-up looks cleaner once you zoom in on the cache-bug window. Anthropic's{" "}
      <ExternalLink href="https://www.anthropic.com/engineering/april-23-postmortem">
        April 23 postmortem
      </ExternalLink>{" "}
      named a thinking-cache regression running March 26 to April 10. The user-facing symptom Anthropic later
      described was forgetfulness, token drain, and odd tool choices. Those show up in long agentic sessions,
      and most long agentic sessions with Claude happen in Claude Code. That fits Claude Code moving more than
      the rest of Claude, though I haven't tested it directly.
    </p>
    <p>
      The postmortem also lists an earlier Claude Code change, a lower default reasoning effort from March 4 to
      April 7, which overlapped this window. The data can't separate that change from the cache bug.
    </p>

    <EmbeddedModelChart modelSlug="claude" startDate="2026-03-15" endDate="2026-05-14" caption="Claude · daily score · Mar 15 – May 14, 2026" />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Claude's aggregate daily sentiment score across the window. Shaded band is Anthropic's confirmed
        cache-bug window (March 26 – April 10). The post-bug trough through April 11 – 15 is press-cycle echo,
        documented in my{" "}
        <a href="/research/claude-april-2026">earlier piece on the 28-day gap</a>. May 7 is a one-day
        cron-rebuild blackout, not a score drop.
      </em>
    </p>

    <PullQuote
      text="Claude Code Silently Runs git reset --hard origin/main Every 10 Minutes — Destroys Uncommitted Work. Claude Code v2.1.87 (latest) is performing git fetch + git reset --hard origin/main on user project repos every 10 minutes..."
      handle="@agentwyre.ai"
      platform="Bluesky"
      timestamp="2026-03-30 05:09 UTC"
      href="https://bsky.app/profile/agentwyre.ai/post/3miavi3f2lk2e"
      archivedHref="https://web.archive.org/web/2026/https://bsky.app/profile/agentwyre.ai/post/3miavi3f2lk2e"
    />

    <p>
      That post is from an automated account relaying a separate Claude Code bug report from the same week (a
      git reset problem, GitHub issue #40710). It isn't about the thinking-cache bug. It's the only quote I'm
      using from this window, so the quote evidence here is thin, and the case rests on the daily numbers.
    </p>

    <StatCallout
      stats={[
        { value: "52 points", label: "Claude Code vs other-Claude score gap, April 10" },
        { value: "16 vs 68", label: "Claude Code vs everything else, April 10" },
      ]}
    />

    <p>
      The cleanest single-day datapoint is April 10, the day Anthropic shipped the cache fix. Claude Code's
      score that day was 16 out of 100. The score for everything else captured about Claude was 68. Same
      model, same calendar day, 52-point gap.
    </p>
    <p>
      The two series tracked each other until early April. From March 26 to April 5, Claude Code averaged 52.2
      and everything else 49.9. From April 6 to 10, Claude Code averaged 29.0 and everything else 58.2, and
      Claude Code scored below the rest on four of those five days. Across the full 16 days it scored below on 8.
      By April 12 the two lines were back together (31 and 29). The dashboard's aggregate Claude score averaged
      the two, so the Claude Code drop got diluted.
    </p>

    <h2 id="chatgpt-and-the-detector">ChatGPT and the detector</h2>
    <p>
      The ChatGPT rows in the table don't compare surfaces. The detector's ChatGPT app pattern matches any post
      containing "chatgpt", so the 4,077-post row is the posts that say "ChatGPT", and the Unknown row (1,086
      posts) is posts about ChatGPT that don't use the word. That's two ways of writing about one product.
      The detector can't separate ChatGPT's surfaces yet, so I'm not reading anything into the 38.1 versus 26.1
      gap.
    </p>
    <p>
      Codex (OpenAI's coding agent) had 33 mentions across the two months, too thin to chart daily. The OpenAI
      API never cleared the floor. Here is one example of what the "ChatGPT" bucket holds:
    </p>
    <PullQuote
      text="Decided to ask ChatGPT about something (ran out of Claude credits) and I got really grossed out by its default voice of lame LinkedIn influencer"
      handle="@solarboi.com"
      platform="Bluesky"
      timestamp="2026-05-05 18:02 UTC"
      href="https://bsky.app/profile/solarboi.com/post/3ml4rh4ddnk2p"
      archivedHref="https://web.archive.org/web/2026/https://bsky.app/profile/solarboi.com/post/3ml4rh4ddnk2p"
    />

    <h2 id="what-i-cant-see-about-gemini-and-grok">What I can't see about Gemini and Grok</h2>
    <p>
      I can't tell the same story about Gemini and Grok at this volume. The detector matched 126 Gemini
      posts and 10 Grok posts over the two months. That's not enough to build a per-surface score for either.
    </p>
    <p>
      Two honest hypotheses. The first is that the detector has blind spots: there's no pattern for "Gemini
      Code Assist" (Google's developer integration), the "AI Studio" pattern requires the literal phrase, and
      Grok's surfaces are mostly named after the X integration, not as standalone products. Widening the
      patterns would catch more, but doing it after the fact would let me pick patterns that flatter the
      story. The second hypothesis is that the public conversation about Gemini and Grok runs at the brand
      level. People post about "Gemini" or "Grok," not about "the Gemini app" or "Grok in X." A vendor that
      ships one or two consumer surfaces with thin developer communities will look that way on social.
    </p>
    <p>
      I don't know the ratio. The methodology section lists the per-vendor coverage rates so a reader can
      decide for themselves. Widening the detector deliberately, with test cases, is on the queue.
    </p>

    <h2 id="how-a-pm-reads-this">How a PM reads this</h2>
    <p>
      The dashboard's headline score tells you whether something is broken. It doesn't tell you who should
      respond. Here are three ways I'd read a move in the score after working through this slice.
    </p>
    <p>
      When the Claude score moves and Claude Code is a large share of the day's matched posts, a tooling
      problem is a good first guess. The cache bug looked like that. A Claude Code release that changed
      defaults or a broken CLI installer would too.
    </p>
    <p>
      I can't apply the same check to ChatGPT yet, because the detector can't separate its surfaces. Once it
      can, a consumer-visible change such as a UI update, a tone change or a new default in the model picker
      is what I'd look for when the app's share of posts is high.
    </p>
    <p>
      When the score moves and few posts name a surface, my guess is that the cause is brand-level: a pricing
      announcement, a leadership departure, a competitor launch or a popular benchmark. People are reacting to
      news more than to using the product.
    </p>
    <p>
      The point is routing. The cache-bug complaints belong on the Claude Code team's desk. Public scrapers say
      little about API users, so API teams need their own data. One score per model can't tell you which team
      should respond.
    </p>

    <h2 id="methodology">Methodology</h2>
    <p>
      Surface attribution runs through <code>detectProductSurface(modelSlug, text)</code> in{" "}
      <code>src/lib/product-surface.ts</code>. The function runs a per-model ordered regex list against the
      post's title concatenated with its content. Patterns are deliberately conservative: they require an
      explicit named reference like "Claude Code," "claude.ai," "Anthropic API," "ChatGPT," "Codex," "Gemini
      app," "AI Studio," or one of the named SDKs. Posts that don't match a pattern land in{" "}
      <code>unknown</code>.
    </p>
    <p>
      Window-wide coverage rates were 30.2% for Claude, 79.1% for ChatGPT, 5.6% for Gemini, and 0.5% for
      Grok. ChatGPT's 79.1% says little about surfaces, because its pattern matches any post containing
      "chatgpt". Claude's 30.2% is a fair number: about 3 in 10 Claude posts name a specific surface, and
      98.8% of those name Claude Code. Gemini's and Grok's rates are too low to surface-segment, as discussed
      above.
    </p>
    <p>
      Per-surface scores in the table and the cache-bug analysis use a simplified formula:{" "}
      <code>score = 100 × (positive + 0.3 × neutral) / (positive + negative + neutral)</code>, with posts
      filtered to <code>confidence ≥ 0.65</code> and a (model, surface, day) cell skipped when eligible
      posts &lt; 5. As of May 2026, the production dashboard score in{" "}
      <code>supabase/functions/_shared/vibes-scoring.ts</code> added source-share capping and engagement
      weighting that I didn't replicate here. (The production formula's
      neutral coefficient moved from 0.3 to 0.5 in July 2026; this article's dataset and per-surface numbers
      predate that change and keep the 0.3 they were computed with.) The downloadable CSV ships
      the per-cell raw counts behind every charted number; cells below the five-post floor are omitted, so
      window totals computed from the CSV reflect chartable volume, not raw scrape volume.
    </p>
    <p>
      During this window, sentiment ran through Google's Gemini 2.5 Flash, classifying posts about Gemini
      and its three competitors.
      <sup id="ref-1">
        <a href="#note-1" className="inline-flex min-h-6 min-w-6 items-center justify-center" aria-label="[1] See footnote 1">
          [1]
        </a>
      </sup>{" "}
      May 7 was a near-blackout day during a cron architecture rebuild: only one (model, surface) cell
      cleared the five-post floor that day, so the rest were skipped. It shows up as a single
      day's gap in the chart, not as a sustained shift.
    </p>

    <h2 id="what-you-can-do-next">What you can do next</h2>
    <p>
      The full dataset behind every number in this piece is the{" "}
      <a href="/research/surface-segmentation-march-may-2026/data.csv">downloadable CSV</a> at the top of the
      page. One row per (date, model, surface) with raw counts, the simplified score, and the top complaint
      category for that cell. MIT-licensed.
    </p>
    <p>
      See the <a href="/model/claude">live Claude chart</a> and{" "}
      <a href="/model/chatgpt">live ChatGPT chart</a>. The dashboard still shows one score per model. Widening
      the surface detector (Gemini and Grok need real coverage first) and putting per-surface scores on the
      model pages are both still open. The repo is open too. PRs welcome.
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
      Classifier self-bias risk. Gemini 2.5 Flash classified posts about its three competitors and itself, so
      the risk to watch was a pro-Gemini tilt. In April 2026 I reran a sample of its labels through Claude
      Sonnet 4.6 and the two agreed on sentiment about 92% of the time. That check didn't prove neutrality.
      The surface-coverage numbers are a separate question: Gemini's low surface-coverage rate has nothing to
      do with the classifier. Posts don't name Gemini's surfaces in plain English often enough for the
      detector to bucket them.
    </p>

    <AuthorBio />
  </>
);

export default SurfaceSegmentationBody;
