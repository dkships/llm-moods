/**
 * Body component for /research/surface-segmentation-march-may-2026.
 * Per-(model, surface) sentiment slice over Mar 15 – May 14, 2026.
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

const SurfaceSegmentationBody = () => (
  <>
    <h2 id="the-19-point-split">The 19-point split</h2>
    <p>
      On March 27, 2026, a day after Anthropic shipped a thinking-cache regression into Claude Sonnet 4.6 and
      Opus 4.6, Theo Browne posted on Bluesky: "Claude Code is kind of like if Codex was drunk. Fun, friendly,
      bit more creative, makes really dumb mistakes, probably shouldn't be trusted with prod." The dashboard's
      daily Claude score moved that week. Our scrapers captured the grumbling. The score did not tell us which
      Claude was being grumbled about.
    </p>
    <p>
      Over the 16 days of the cache bug, the average score for posts about Claude Code fell from 63.6 to 44.9.
      Over the same 16 days, the average for everything else our scrapers caught about Claude fell from 56.3 to
      52.5. Same model, same week, two very different stories.
    </p>

    <StatCallout
      stats={[
        { value: "19 points", label: "Claude Code drop, cache-bug window" },
        { value: "4 points", label: "Non-Claude-Code Claude drop, same window" },
      ]}
    />

    <PullQuote
      text="Claude Code is kind of like if Codex was drunk. Fun, friendly, bit more creative, makes really dumb mistakes, probably shouldn't be trusted with prod."
      handle="@theo-t3gg"
      platform="Bluesky"
      timestamp="2026-03-27 03:10 UTC"
      href="https://bsky.app/profile/theo-t3gg.bsky.social/post/3mhz6rvi2z42g"
      archivedHref="https://web.archive.org/web/2026/https://bsky.app/profile/theo-t3gg.bsky.social/post/3mhz6rvi2z42g"
    />

    <p>
      Aggregate model scores treat each frontier model as one product. Users don't. A "Claude is bad this week"
      headline almost always means "Claude Code is bad this week," because Claude Code is where the public
      conversation about Claude actually happens. This piece is what the data looks like when you slice the
      same scoring pipeline by product surface instead of by model.
    </p>

    <h2 id="what-the-data-actually-says">What the data actually says</h2>
    <p>
      Across the 60-day window of March 15 to May 14, 2026, we ran every Claude, ChatGPT, Gemini, and Grok post
      our scrapers captured through a lexical surface detector. The detector lives at{" "}
      <code>src/lib/product-surface.ts</code> and matches plain-language references like "Claude Code,"
      "claude.ai," "Anthropic API," "ChatGPT mobile," "Codex," "Gemini app," and so on, model by model. Posts
      that don't match a named surface stay in an <code>unknown</code> bucket.
    </p>

    <div className="my-6 overflow-x-auto rounded-lg border border-border">
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
            <td>ChatGPT.com / app</td>
            <td className="whitespace-nowrap">4,077</td>
            <td className="whitespace-nowrap">38.1</td>
            <td><code>hallucinations</code></td>
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
            <td><code>hallucinations</code></td>
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
            <td><code>hallucinations</code></td>
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
            <td><code>other</code></td>
          </tr>
        </tbody>
      </table>
    </div>

    <p>
      Two patterns to notice. First, for Claude and ChatGPT, one surface dominates the named conversation. Of
      the 1,321 Claude posts that named a surface, 92% named Claude Code. Of the 4,286 ChatGPT posts that
      named a surface, 95% named ChatGPT.com or the mobile app. The Anthropic and OpenAI APIs together
      contributed 20 posts in 60 days. SDK posts: zero. The API isn't where the public conversation happens.
    </p>
    <p>
      Second, for Gemini and Grok, almost no posts name a surface at all. The detector matched 5.5% of Gemini
      posts and 0.5% of Grok posts. We don't think that's because Gemini and Grok users only use one surface.
      We think it's a mix of two things: the detector has blind spots (no patterns for "Gemini Code Assist,"
      "Google AI Studio" matches but its users may call it something else), and the social conversation about
      those two vendors runs at the brand level rather than the surface level. Either way, we can't
      surface-segment them at this volume. We'll come back to that in the methodology section.
    </p>

    <h2 id="claude-during-the-cache-bug">Claude during the cache bug</h2>
    <p>
      The match-up looks cleaner once you zoom in on the cache-bug window. Anthropic's{" "}
      <ExternalLink href="https://www.anthropic.com/engineering/april-23-postmortem">
        April 23 postmortem
      </ExternalLink>{" "}
      named a thinking-cache regression running March 26 to April 10. The user-facing symptom Anthropic later
      described was forgetfulness, token-drain, and odd tool choices. That is a Claude Code complaint shape,
      not a claude.ai complaint shape. Sustained agentic sessions hit the cache hardest, and sustained
      agentic sessions live in Claude Code.
    </p>

    <EmbeddedModelChart modelSlug="claude" startDate="2026-03-15" endDate="2026-05-14" caption="Claude · daily score · Mar 15 – May 14, 2026" />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Claude's aggregate daily sentiment score across the window. Shaded band is Anthropic's confirmed
        cache-bug window (March 26 – April 10). The post-bug trough through April 11 – 15 is press-cycle echo,
        documented in our{" "}
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
    <PullQuote
      text="yeah my sense is compared to actually using claude code directly, it's quite dumb in its approach, doesn't really problem solve very hard and is fairly limited in its available tooling"
      handle="@goose.art"
      platform="Bluesky"
      timestamp="2026-03-29 03:06 UTC"
      href="https://bsky.app/profile/goose.art/post/3mi664nkv2s2l"
      archivedHref="https://web.archive.org/web/2026/https://bsky.app/profile/goose.art/post/3mi664nkv2s2l"
    />

    <p>
      Both posts land mid-cache-bug. Both name Claude Code as the surface. The first is operational
      (Claude Code's git behavior was destroying uncommitted work, with a linked GitHub issue), the second is
      quality (the model's reasoning felt thinner than direct API use). The classifier tagged them{" "}
      <code>api_reliability</code> and <code>reasoning</code> respectively. Both feed the Claude Code line,
      not the claude.ai line, not the API line.
    </p>

    <StatCallout
      stats={[
        { value: "52 points", label: "Claude Code vs other-Claude score gap, April 10" },
        { value: "16 of 16", label: "Days the gap held, cache-bug window" },
      ]}
    />

    <p>
      The cleanest single-day datapoint is April 10, the day Anthropic shipped the cache fix. Claude Code's
      score that day was 16 out of 100. The score for everything else captured about Claude was 68. Same
      model, same calendar day, 52-point gap. The fix landed, and bad Claude Code experiences kept driving
      the day's grumbling. By April 12 the two lines converged again. The dashboard's aggregate Claude score
      averaged the two, and the day-by-day Claude Code shape disappeared into a calmer middle.
    </p>

    <h2 id="chatgpt-shows-the-same-shape">ChatGPT shows the same shape</h2>
    <p>
      The dominant-surface pattern holds for ChatGPT too. Of the 4,286 ChatGPT posts that named a product
      surface, 4,090 named ChatGPT.com or the mobile app. Codex (OpenAI's coding agent) had 193 lifetime
      mentions across the 60 days, which is too thin to chart daily and barely enough for a window aggregate.
      The OpenAI API had three mentions.
    </p>
    <PullQuote
      text="Decided to ask ChatGPT about something (ran out of Claude credits) and I got really grossed out by its default voice of lame LinkedIn influencer"
      handle="@solarboi.com"
      platform="Bluesky"
      timestamp="2026-05-05 18:02 UTC"
      href="https://bsky.app/profile/solarboi.com/post/3ml4rh4ddnk2p"
      archivedHref="https://web.archive.org/web/2026/https://bsky.app/profile/solarboi.com/post/3ml4rh4ddnk2p"
    />
    <p>
      The complaint is product-surface specific in a way that wouldn't translate to the API. The API doesn't
      have a default voice; the chatbot does. The ChatGPT.com average over the window is 38.1, lower than
      Claude Code's 52.1, and the top complaint category is <code>hallucinations</code> rather than{" "}
      <code>general_drop</code>. Different surface, different complaint shape, even when you control for the
      vendor.
    </p>

    <h2 id="what-we-cant-see-about-gemini-and-grok">What we can't see about Gemini and Grok</h2>
    <p>
      We can't tell you the same story about Gemini and Grok at this volume. The detector matched 126 Gemini
      posts and 10 Grok posts over the 60 days. That's not enough to build a per-surface score for either.
    </p>
    <p>
      Two honest hypotheses. The first is that the detector has blind spots: there's no pattern for "Gemini
      Code Assist" (Google's developer integration), the "AI Studio" pattern requires the literal phrase, and
      Grok's surfaces are mostly named after the X integration, not as standalone products. Widening the
      patterns would catch more, but doing it after the fact would let us pick patterns that flatter the
      story. The second hypothesis is that the public conversation about Gemini and Grok runs at the brand
      level. People post about "Gemini" or "Grok," not about "the Gemini app" or "Grok in X." A vendor that
      ships one or two consumer surfaces with thin developer communities will look that way on social.
    </p>
    <p>
      We don't know the ratio. The methodology section lists the per-vendor coverage rates so a reader can
      decide for themselves. Widening the detector deliberately, with test cases, is on the queue.
    </p>

    <h2 id="how-a-pm-reads-this">How a PM reads this</h2>
    <p>
      The dashboard's headline score is fine for "is something broken." It's the wrong instrument for "who
      owns the next response." Three concrete re-read rules came out of this slice:
    </p>
    <p>
      One: when the Claude score moves and Claude Code volume is the dominant share of the day's matched
      posts, suspect a tooling regression. Anthropic's cache bug fit this shape. So would a Claude Code
      release that changed defaults. So would a CLI installer breakage.
    </p>
    <p>
      Two: when the ChatGPT score moves and ChatGPT.com volume is the dominant share, suspect a
      consumer-visible change. UI changes, voice-tone changes, the model picker switching defaults: these
      are the things that drive a ChatGPT.com grumble wave. The API isn't where that signal lives.
    </p>
    <p>
      Three: when the score moves and matched-surface volume is low, the change is probably brand-level
      rather than product-level. Pricing news, a leadership departure, a competitor launch, a viral
      benchmark. The score is responding to talking-about rather than using.
    </p>
    <p>
      Routing is the point. The cache bug's reliability signal belonged on the Claude Code team's desk. The
      ChatGPT.com voice complaints belong with the consumer product team. The API teams should expect a
      different signal entirely, or none, from public scrapers, and need their own telemetry to compensate.
      One aggregate score per model can't make that routing call.
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
      Window-wide coverage rates were 32.2% for Claude, 78.8% for ChatGPT, 5.5% for Gemini, and 0.5% for
      Grok. ChatGPT's high rate is mostly because the patterns are loose for it (any post containing
      "chatgpt" matches). Claude's rate is honest: about a third of Claude posts name a specific surface,
      most of those name Claude Code. Gemini's and Grok's rates are too low to surface-segment, as discussed
      above.
    </p>
    <p>
      Per-surface scores in the table and the cache-bug analysis use a simplified formula:{" "}
      <code>score = 100 × (positive + 0.3 × neutral) / (positive + negative + neutral)</code>, with posts
      filtered to <code>confidence ≥ 0.65</code> and a (model, surface, day) cell skipped when eligible
      posts &lt; 5. The production dashboard score in <code>supabase/functions/_shared/vibes-scoring.ts</code>{" "}
      adds source-share capping and engagement weighting we don't replicate here. The downloadable CSV ships
      raw counts so a reader can recompute either way.
    </p>
    <p>
      Sentiment runs through Claude Haiku 4.5 via the Anthropic API, classifying posts about its competitors.
      <sup id="ref-1">
        <a href="#note-1" aria-label="See footnote 1">
          [1]
        </a>
      </sup>{" "}
      May 7 was a near-blackout day during a cron architecture rebuild — only 11 posts cleared classification
      across all four models that day, so most (model, surface) cells were skipped. It shows up as a single
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
      <a href="/model/chatgpt">live ChatGPT chart</a>. The dashboard still shows aggregate per-model scores;
      the next iteration will widen the surface detector (Gemini and Grok need real coverage before they're
      useful here) and promote per-surface scoring to a first-class metric on the model pages. The repo is
      open. PRs welcome.
    </p>

    <h2 id="notes">Notes</h2>
    <p id="note-1" className="scroll-mt-24 text-sm text-text-secondary">
      <a
        href="#ref-1"
        className="font-bold no-underline hover:underline"
        aria-label="Back to reference"
      >
        [1]
      </a>{" "}
      Classifier self-bias risk. Claude Haiku 4.5 classifies posts about its three competitors and itself, so
      the risk to watch is a pro-Claude tilt. We cross-check a sample of recent uncertain posts against an
      independent free-tier Gemini grader around classifier changes. The cross-check doesn't prove neutrality,
      and the surface-coverage numbers are a separate axis: Gemini's low surface-coverage rate could look like
      classifier sandbagging if you squint at it. It isn't. Posts simply don't name Gemini's surfaces in plain
      English often enough for the detector to bucket them.
    </p>

    <AuthorBio />
  </>
);

export default SurfaceSegmentationBody;
