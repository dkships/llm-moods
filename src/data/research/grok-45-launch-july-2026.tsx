/**
 * Body component for /research/grok-45-launch-july-2026.
 * Charts: live EmbeddedModelChart for the Grok score window, static
 * ArticleSeriesChart for share-of-voice (frozen snapshot, matches the CSV).
 */

import EmbeddedModelChart from "@/components/research/EmbeddedModelChart";
import ArticleSeriesChart from "@/components/research/ArticleSeriesChart";
import AuthorBio from "@/components/research/AuthorBio";
import PullQuote from "@/components/research/PullQuote";
import StatCallout from "@/components/research/StatCallout";
import ResearchTableFrame from "@/components/research/ResearchTableFrame";

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

// 7-day trailing share of Grok rows among all model-classified rows in our
// corpus, Jun 1 – Jul 16. Frozen snapshot; the per-day raw counts are in the
// downloadable CSV.
const GROK_SOV_7D: { day: string; value: number | null }[] = [
  { day: "2026-06-01", value: 11.4 }, { day: "2026-06-02", value: 11.3 }, { day: "2026-06-03", value: 10.0 },
  { day: "2026-06-04", value: 9.9 }, { day: "2026-06-05", value: 9.2 }, { day: "2026-06-06", value: 10.0 },
  { day: "2026-06-07", value: 10.4 }, { day: "2026-06-08", value: 9.5 }, { day: "2026-06-09", value: 8.6 },
  { day: "2026-06-10", value: 8.4 }, { day: "2026-06-11", value: 8.0 }, { day: "2026-06-12", value: 9.8 },
  { day: "2026-06-13", value: 8.7 }, { day: "2026-06-14", value: 8.2 }, { day: "2026-06-15", value: 8.6 },
  { day: "2026-06-16", value: 9.3 }, { day: "2026-06-17", value: 10.2 }, { day: "2026-06-18", value: 10.8 },
  { day: "2026-06-19", value: 9.1 }, { day: "2026-06-20", value: 9.5 }, { day: "2026-06-21", value: 9.3 },
  { day: "2026-06-22", value: 9.5 }, { day: "2026-06-23", value: 8.9 }, { day: "2026-06-24", value: 7.9 },
  { day: "2026-06-25", value: 7.5 }, { day: "2026-06-26", value: 7.2 }, { day: "2026-06-27", value: 6.2 },
  { day: "2026-06-28", value: 6.0 }, { day: "2026-06-29", value: 6.1 }, { day: "2026-06-30", value: 5.8 },
  { day: "2026-07-01", value: 6.0 }, { day: "2026-07-02", value: 5.6 }, { day: "2026-07-03", value: 5.8 },
  { day: "2026-07-04", value: 5.8 }, { day: "2026-07-05", value: 5.4 }, { day: "2026-07-06", value: 4.7 },
  { day: "2026-07-07", value: 5.0 }, { day: "2026-07-08", value: 5.8 }, { day: "2026-07-09", value: 8.0 },
  { day: "2026-07-10", value: 9.7 }, { day: "2026-07-11", value: 10.8 }, { day: "2026-07-12", value: 12.5 },
  { day: "2026-07-13", value: 14.5 }, { day: "2026-07-14", value: 15.0 }, { day: "2026-07-15", value: 15.1 },
  { day: "2026-07-16", value: 14.5 },
];

const Grok45LaunchBody = () => (
  <>
    <h2 id="the-launch-pop">The launch pop</h2>
    <p>
      On July 6, Grok's share of the AI-model chatter we track hit its lowest point in our dataset: 4.7% of
      posts, on a 7-day trailing basis. Two days later xAI{" "}
      <ExternalLink href="https://techcrunch.com/2026/07/08/spacexai-releases-grok-4-5-which-elon-describes-as-an-opus-class-model/">
        shipped Grok 4.5
      </ExternalLink>
      , and by July 13 that share had tripled to 14.5%. It was still there on July 16.
    </p>
    <p>
      The sentiment story is shorter. Grok's daily score averaged 29.6 over the thirty days before launch. On
      launch day it hit 57 — tied for its best day since early June — and held an average of 55.5 through July
      11. Then it faded: 42.5 across July 13–16. The pop lasted about five days. The audience it pulled in
      didn't leave.
    </p>

    <StatCallout
      stats={[
        { value: "3×", label: "Share of tracked chatter, Jul 6 → Jul 13" },
        { value: "5 days", label: "How long the sentiment pop held" },
      ]}
    />

    <EmbeddedModelChart modelSlug="grok" startDate="2026-06-01" endDate="2026-07-16" />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Grok's daily sentiment score, June 1 – July 16, 2026. The launch line is July 9 (Musk announced July
        8; Cursor users got it a day early). Post volume went from 13.5 posts/day pre-launch to 55.9 after,
        peaking at 93 on July 13.
      </em>
    </p>

    <h2 id="attention-is-the-metric-that-moved">Attention is the metric that moved</h2>
    <p>
      At 13 posts a day, Grok's pre-launch daily score bounced between 15 and 49 on sample noise alone. I
      trust the direction of that line, not any single day of it. Share of voice is the series I'd actually
      defend, and it moved decisively.
    </p>

    <ArticleSeriesChart
      data={GROK_SOV_7D}
      valueSuffix="%"
      ariaLabel="Grok's share of tracked AI-model chatter, 7-day trailing, June 1 to July 16 2026: roughly 10% through mid-June, declining to 4.7% on July 6, then tripling to about 15% after the July 8 Grok 4.5 launch."
      events={[{ startDay: "2026-07-08", color: "hsl(200 70% 60%)", title: "Grok 4.5 launch" }]}
    />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Grok's share of all model-classified posts in our corpus, 7-day trailing. The dashed line is July 8.
        Raw daily counts are in the CSV.
      </em>
    </p>
    <p>
      Two things make me trust this series across a messy week (more on the messiness below). The climb
      starts July 8–9, two days before our own pipeline changed. And share of voice is a ratio — a pipeline
      change that ingests more posts for every model doesn't move it much. Attention is roughly zero-sum,
      and the week after launch the loser was ChatGPT: its share of our corpus went from 40% the week of June
      22 to 26% the week of July 13. Claude held 42% — the Fable 5 access drama was its own attention magnet
      that same week.
    </p>

    <h2 id="what-launch-week-sounded-like">What launch week actually sounded like</h2>
    <p>
      The dominant theme wasn't capability. It was price. On July 9, 29% of the Grok posts we ingested used
      pricing or value language ("cheap," "$2/M," "cost"), against a low-single-digit norm. The Decoder's
      launch summary,{" "}
      <ExternalLink href="https://bsky.app/profile/ainieuwtjes.bsky.social/post/3mq5wdedtva2p">
        reposted widely
      </ExternalLink>
      , put the thesis in one line: "Grok 4.5 is so cheap compared to Fable 5 and GPT 5.5 that benchmark gaps
      may not matter much."
    </p>
    <PullQuote
      text="Grok 4.5 first impressions: 1/ definitely far better than Composer 2.5 2/ not as good as Opus/Fable for frontend designs 3/ pretty good with other tasks, felt more like GPT-5.5 4/ reasonably priced ($2/MTok input, $6/MTok output) 5/ and it's much faster than Opus/GPT latest models"
      handle="@deepakness.bsky.social"
      platform="Bluesky"
      timestamp="2026-07-08 19:45 UTC"
      href="https://bsky.app/profile/deepakness.bsky.social/post/3mq5v2lgdty2e"
      archivedHref="https://web.archive.org/web/2026/https://bsky.app/profile/deepakness.bsky.social/post/3mq5v2lgdty2e"
    />
    <PullQuote
      text="First Day Vibes - Grok 4.5 vs GPT 5.6. Grok 4.5 - great for easy coding, can spin a lot for complex coding. cost optimized… Fable 5 - still the best model we have around but can get vastly better. performance optimzied"
      handle="@bindureddy"
      platform="X"
      timestamp="2026-07-11 04:06 UTC"
      href="https://x.com/bindureddy/status/2075793737536385426"
      archivedHref="https://web.archive.org/web/2026/https://x.com/bindureddy/status/2075793737536385426"
    />
    <p>
      That pair is the launch reception in miniature: solid, fast, cheap, and second place on quality. The
      negative posts weren't about the model either — they were about capacity. Day-one complaints in our
      sample were rate limits ("
      <ExternalLink href="https://x.com/HO8M21319/status/2074827326550925592">
        impossible to even chat with Grok without hitting the weekly limit
      </ExternalLink>
      ") and app bugs, the complaints of a product straining under demand rather than failing on output.
    </p>

    <h2 id="the-switching-story">The switching story is mostly a media story</h2>
    <p>
      The tech-press framing of this launch was defection: users abandoning Claude and ChatGPT for the
      cheaper model. I went looking for it. Across 16,724 unique posts in our 90-day corpus, explicit
      switching statements — "switched to Grok," "cancelled my Claude subscription," "moved to Grok," and a
      dozen pattern variants — matched <strong>three posts</strong>.
    </p>
    <PullQuote
      text="opus 5 will be a crippled version of fable 5 - Anthropic is massively compute constrained - I have cancelled and moved to grok 4.5 and codex, never looking back"
      handle="@mobile14u"
      platform="X"
      timestamp="2026-07-14 20:37 UTC"
      href="https://x.com/mobile14u/status/2077130372148539557"
      archivedHref="https://web.archive.org/web/2026/https://x.com/mobile14u/status/2077130372148539557"
    />
    <p>
      One real defection post, and its stated reason is Anthropic's pricing and capacity, not Grok's quality.
      What the corpus has instead of switching is <em>comparison</em>: nearly half the posts that name Grok
      4.5 were classified under a different model, because they're side-by-side posts — build-offs,
      benchmark threads, "which one for my stack" questions. The pattern in those posts is remarkably
      consistent: Fable 5 holds the quality crown, Grok 4.5 wins on price, and the poster keeps both
      opinions in the same breath.
    </p>
    <p>
      Two honest caveats. Our scrapers search broad model terms, not switching phrases, so a migration wave
      happening outside our sampled queries could be invisible to us — absence of evidence here is weak
      evidence of absence. And subscription decisions lag sentiment: the Fable 5 free-access window (extended
      to July 19 as I write this) means the cancel-or-keep moment for a lot of Claude users hasn't arrived
      yet. If a defection wave shows up, my money is on it showing up in the week after that deadline, not
      launch week.
    </p>

    <h2 id="the-worst-measurement-week">Untangling the worst possible measurement week</h2>
    <p>
      Grok 4.5 launched into a 72-hour pileup: GPT-5.6 shipped July 9, and on July 10 we deployed our own
      accuracy-audit fixes — a Bluesky query rebalance, new sources, and a scoring change that rescored
      neutral posts. Every cross-model claim in this article has to survive that pileup, so here's the
      damage report.
    </p>
    <ResearchTableFrame label="Which July signals survive the three-event pileup">
      <table className="w-full">
        <caption className="sr-only">
          Signals from the July 8 to 10 window and whether they can be attributed to the Grok 4.5 launch.
        </caption>
        <thead>
          <tr>
            <th scope="col">Signal</th>
            <th scope="col">What it shows</th>
            <th scope="col">Trustworthy?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Grok share of voice 3×</td>
            <td>Climb starts Jul 8–9, before our deploy; ratios resist ingestion changes</td>
            <td>
              <strong>Yes</strong>
            </td>
          </tr>
          <tr>
            <td>Grok post volume 4×</td>
            <td>Jul 8–9 jump predates the deploy; later days partly inflated by new sources</td>
            <td>Mostly — direction yes, magnitude inflated</td>
          </tr>
          <tr>
            <td>Grok launch-day score pop (57)</td>
            <td>Jul 8–9 scores predate the deploy and sit on 40 posts/day</td>
            <td>Yes for Jul 8–9; later days mix in the scoring change</td>
          </tr>
          <tr>
            <td>ChatGPT score +16 after Jul 8</td>
            <td>GPT-5.6 launched Jul 9 AND the scoring change lifted news-heavy days</td>
            <td>
              <strong>No</strong> — hopelessly confounded, we don't cite it
            </td>
          </tr>
          <tr>
            <td>Any pre/post-Jul-10 score delta</td>
            <td>Neutral posts rescored 0.3 → 0.5 in the deploy</td>
            <td>No — not comparable without reprocessing</td>
          </tr>
        </tbody>
      </table>
    </ResearchTableFrame>
    <p>
      This is why the article leans on share-of-voice, volume direction, and post text rather than score
      deltas across July 10. Every model's average score is higher after July 8 — Gemini's rose 13 points and
      nobody launched a Gemini. When everything goes up, the instrument moved, and the honest move is to say
      so.<sup id="ref-1">
        <a href="#note-1" className="inline-flex min-h-6 min-w-6 items-center justify-center" aria-label="[1] See footnote 1">
          [1]
        </a>
      </sup>
    </p>

    <h2 id="the-conversation-flip">The launch changed what Grok chatter is about</h2>
    <p>
      The most interesting number in the dataset isn't sentiment. Before launch, Grok's feed in our corpus
      was politics-adjacent: 18% of Grok posts from June 1 to July 7 mentioned Musk or Elon by name, and only
      10% used product language — coding, API, benchmarks, pricing, agents. After launch those proportions
      flipped hard: 9% Musk, 61% product.
    </p>
    <p>
      That flip is why Grok's baseline score sat in the high 20s all June while every other model lived in
      the 30s and 40s. Grok's chatter wasn't unhappy users; it was people arguing about its owner. The launch
      pulled a different crowd into the conversation — builders benchmarking a tool — and for at least a
      week, product-Grok decoupled from politics-Grok. Whether that lasts is the question I'd watch. The
      biggest{" "}
      <ExternalLink href="https://news.ycombinator.com/item?id=48835111">
        Hacker News launch thread
      </ExternalLink>{" "}
      (776 points, 1,504 comments) spent much of its length on exactly that tension: strong price-performance
      reviews interleaved with distrust of the vendor.
    </p>

    <h2 id="methodology">Methodology</h2>
    <p>
      LLM Vibes scrapes posts about four LLM models (Claude, ChatGPT, Gemini, Grok) across six sources:
      Reddit and Twitter/X via Apify, Hacker News stories and comments via Algolia, Bluesky, Mastodon, and
      App Store reviews. Each post is classified for per-model sentiment and complaint category by Claude
      Haiku 4.5 via the Anthropic API. The daily 0–100 score is confidence- and engagement-weighted; the full
      scoring code is public in <code>supabase/functions/_shared/vibes-scoring.ts</code>.
    </p>
    <p>
      This article's corpus is 18,746 model-classified rows (16,724 unique posts — multi-model posts produce
      one row per model) spanning April 13 – July 17, exported via the public{" "}
      <code>get_public_recent_chatter</code> RPC. Share of voice counts model-rows, so a Grok-vs-Fable
      comparison post counts toward both models — that's deliberate, it's chatter about both. Keyword and
      switching-phrase matching is regex over title + content; the patterns are listed in the repo. Daily
      scores come from <code>get_public_vibes_history</code>. Where scores cross our July 10 pipeline
      deploy, they're flagged as non-comparable rather than adjusted.
    </p>
    <p>
      The classifier is a Claude model scoring posts about Claude's competitors, including this article's
      subject. The self-bias check we run against an independent Gemini grader (88.9% sentiment agreement on
      the June run of the live classifier) is described in{" "}
      <a href="/research/how-llm-vibes-classifies-sentiment">How LLM Vibes classifies sentiment</a>.
    </p>

    <h2 id="what-you-can-do-next">What you can do next</h2>
    <p>
      Watch the <a href="/model/grok">live Grok chart</a> — the launch window in this article is marked, and
      the next few weeks answer the retention question. The July 19 Fable 5 deadline is the other date to
      watch; if the switching wave exists, that's when it becomes measurable.
    </p>
    <p>
      Download the <a href="/research/grok-45-launch-july-2026/data.csv">dataset</a> (daily scores, volumes,
      share of voice, and mention counts for all four models, June 1 – July 16), or{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods">fork the pipeline on GitHub</ExternalLink>.
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
      The July 10 deploy rescored neutral posts from 0.3 to 0.5 on the positive-negative axis, after our
      accuracy audit found the old weighting punished models on launch-news days — exactly the kind of day
      this article is about. The fix was right and its timing was terrible for this analysis. We're
      reprocessing the historical window under the current formula; until then, cross-boundary score deltas
      stay out of our claims.
    </p>

    <AuthorBio />
  </>
);

export default Grok45LaunchBody;
