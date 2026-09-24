/**
 * Body component for /research/opus-5-5-vs-opus-5-launch-sentiment-2026.
 * Charts: live EmbeddedModelChart (Claude score, launch markers from
 * vendor-events.ts), a static ArticleSeriesChart (Opus 5 mention tone by
 * week), and two ShareBars (launch-window tone, complaint mix). Every
 * number is a frozen snapshot matching the CSV.
 */

import EmbeddedModelChart from "@/components/research/EmbeddedModelChart";
import ArticleSeriesChart from "@/components/research/ArticleSeriesChart";
import AuthorBio from "@/components/research/AuthorBio";
import PullQuote from "@/components/research/PullQuote";
import ResearchTableFrame from "@/components/research/ResearchTableFrame";
import ShareBars from "@/components/research/ShareBars";
import StatCallout from "@/components/research/StatCallout";
import { getVibeStatus } from "@/lib/vibes";

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

// Sentiment hues come from the shared scale; neutral stays recessive.
const POSITIVE_COLOR = getVibeStatus(100).color;
const NEGATIVE_COLOR = getVibeStatus(0).color;
const NEUTRAL_COLOR = "hsl(var(--muted-foreground))";

const TONE_LEGEND = [
  { key: "positive", label: "Positive", color: POSITIVE_COLOR },
  { key: "neutral", label: "Neutral", color: NEUTRAL_COLOR },
  { key: "negative", label: "Negative", color: NEGATIVE_COLOR },
];

// Relevant posts naming each model, launch day + the next day (Pacific).
const LAUNCH_TONE_ROWS = [
  { label: "Opus 5.5 · Sep 22–23", detail: "122 posts", counts: { positive: 91, neutral: 8, negative: 23 } },
  { label: "Opus 5 · Jul 24–25", detail: "223 posts", counts: { positive: 132, neutral: 16, negative: 75 } },
  { label: "Fable 5.1 · Sep 1–2", detail: "113 posts", counts: { positive: 62, neutral: 10, negative: 41 } },
];

// Negative posts naming the model, grouped from the classifier's complaint
// categories. Quality = general_drop + lazy_responses + coding_quality +
// reasoning + hallucinations. Safety = refusals + censorship.
const COMPLAINT_LEGEND = [
  { key: "safety", label: "Refusals & safeguards", color: "hsl(var(--warning))" },
  { key: "quality", label: "Quality drop", color: NEGATIVE_COLOR },
  { key: "price", label: "Price & value", color: NEUTRAL_COLOR },
  { key: "other", label: "Other", color: "hsl(var(--muted-foreground) / 0.4)" },
];

const COMPLAINT_ROWS = [
  { label: "Opus 5.5 · first 60 hours", detail: "23 complaints", counts: { safety: 9, quality: 8, price: 2, other: 4 } },
  { label: "Opus 5 · launch, Jul 24–26", detail: "101 complaints", counts: { safety: 8, quality: 69, price: 12, other: 12 } },
  { label: "Opus 5 · Jul 27 – Sep 21", detail: "1,412 complaints", counts: { safety: 59, quality: 1012, price: 66, other: 275 } },
];

// Independent cross-check: every Hacker News post naming the model (Algolia
// API) plus ~230 X posts per window, graded by a separate LLM pass that never
// touched our production classifier. Launch day + next day. Irrelevant posts
// excluded. Per-post labels are in independent-sample.csv.
const CROSS_CHECK_ROWS = [
  { label: "Opus 5.5 · Sep 22–23", detail: "311 posts", counts: { positive: 189, neutral: 66, negative: 56 } },
  { label: "Opus 5 · Jul 24–25", detail: "321 posts", counts: { positive: 146, neutral: 82, negative: 93 } },
  { label: "GPT-5.6 · Jul 9–10", detail: "250 posts", counts: { positive: 150, neutral: 37, negative: 63 } },
  { label: "GPT-6 Sol + Luna · Sep 22–23", detail: "196 posts", counts: { positive: 86, neutral: 38, negative: 72 } },
];

// Share of Opus 5 posts that took a side (positive / (positive + negative)),
// in 7-day buckets counted from the Jul 24 launch.
const OPUS5_TONE_WEEKLY: { day: string; value: number | null }[] = [
  { day: "2026-07-24", value: 51.7 },
  { day: "2026-07-31", value: 47.1 },
  { day: "2026-08-07", value: 40.4 },
  { day: "2026-08-14", value: 26.2 },
  { day: "2026-08-21", value: 29.8 },
  { day: "2026-08-28", value: 32.7 },
  { day: "2026-09-04", value: 33.1 },
  { day: "2026-09-11", value: 28.1 },
  { day: "2026-09-18", value: 33.3 },
];

const OpusLaunchBody = () => (
  <>
    <p>
      My hypothesis going in was simple. Everyone is much happier with Opus 5.5 than they were with the
      model before it.
    </p>
    <p>
      The data says I'm mostly right. And the part where I'm wrong is the more useful part. Also, OpenAI
      launched GPT-6 Sol and Luna the same afternoon, and that launch went the other way.
    </p>

    <StatCallout
      stats={[
        { value: "+20 pts", label: "Claude score, week before launch → first two days (38 → 58)" },
        { value: "80%", label: "Opus 5.5 posts that took a side and were positive (Opus 5: 64%)" },
      ]}
    />

    <h2 id="there-was-no-opus-5-1">There was no Opus 5.1</h2>
    <p>
      First, a correction to my own question. I went in to compare Opus 5.5 against Opus 5.1. That model
      doesn't exist. Anthropic went from{" "}
      <ExternalLink href="https://www.anthropic.com/news/claude-opus-5">Opus 5</ExternalLink> on July 24
      straight to <ExternalLink href="https://www.anthropic.com/news/claude-opus-5-5">Opus 5.5</ExternalLink>{" "}
      on September 22. Fable 5.1 shipped in between, on September 1.
    </p>
    <p>
      But "Opus 5.1" is all over our corpus anyway. 20 posts between August 20 and September 21 named it,
      from leak chatter to outright pleading. Not a wave, but the message is consistent: Opus 5 has problems, and people were waiting for a
      point release to fix them.
    </p>
    <PullQuote
      text="Opus 5.1 would heal people guys. I'm not kidding. Opus 5 ruined Claude for a lot of us. It made working with it far harder than it should be."
      handle="@rohit3a"
      platform="X"
      timestamp="2026-09-13 15:50 UTC"
      href="https://x.com/rohit3a/status/2099163839992578137"
    />
    <PullQuote
      text="Opus 5.1 really can't come soon enough. 5 feels annoying in terms of how it writes and seems too susceptible to going on long tangents in the workflow."
      handle="@pmwwp.givesky.social"
      platform="Bluesky"
      timestamp="2026-09-17 02:11 UTC"
      href="https://bsky.app/profile/pmwwp.givesky.social/post/3mvolas7dn22v"
    />
    <p>
      Our own <a href="/rumors">rumors radar</a> logged the leaks. An "Opus 5.1" (codename Marshmallow)
      turned up in third-party apps on August 23. "Opus 5.2" canary routing inside Claude Code got reported
      on September 14. Two days before launch, a leaker said the model in testing had been renamed from 5.2
      to 5.5. Whatever the internal story, the public one is clear. <strong>Anthropic skipped the
      fix-it release everyone was asking for and shipped a bigger jump instead.</strong> So the real
      comparison is Opus 5.5 against Opus 5, with Fable 5.1 as the other recent Anthropic launch.
    </p>

    <h2 id="the-launch-scorecard">The launch scorecard</h2>
    <p>
      Here's Claude's daily score from mid-July through the day after Opus 5.5 shipped. The launches are
      marked.
    </p>

    <EmbeddedModelChart modelSlug="claude" startDate="2026-07-13" endDate="2026-09-23" />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Claude's daily sentiment score, July 13 – September 23, 2026. Opus 5 lands on a rising line and
        holds it for three days. Then the slide. Opus 5.5 lands on the lowest stretch of the summer and
        jumps.
      </em>
    </p>
    <p>
      Put six Anthropic launches since April side by side and Opus 5.5 comes out on top. Only Opus 4.7
      is close.
    </p>

    <ResearchTableFrame label="Claude score around six Anthropic launches">
      <table className="w-full">
        <caption className="sr-only">
          Claude daily sentiment score in the week before each launch, on launch day and the day after, and the
          change between them.
        </caption>
        <thead>
          <tr>
            <th scope="col">Launch</th>
            <th scope="col" className="whitespace-nowrap">Week before</th>
            <th scope="col" className="whitespace-nowrap">First two days</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="whitespace-nowrap">Opus 5.5 · Sep 22</td>
            <td>38.1</td>
            <td>58.0</td>
            <td><strong>+19.9</strong></td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Opus 4.7 · Apr 17</td>
            <td>38.3</td>
            <td>54.5</td>
            <td>+16.2</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Opus 5 · Jul 24</td>
            <td>52.4</td>
            <td>59.5</td>
            <td>+7.1</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Fable 5.1 · Sep 1</td>
            <td>36.9</td>
            <td>43.5</td>
            <td>+6.6</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Sonnet 5 · Jun 30</td>
            <td>51.3</td>
            <td>49.5</td>
            <td>−1.8</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Fable 5 · Jun 9</td>
            <td>54.6</td>
            <td>48.5</td>
            <td>−6.1</td>
          </tr>
        </tbody>
      </table>
    </ResearchTableFrame>

    <p>
      The daily score covers everything people say about Claude, so a launch gets diluted by every
      unrelated rate-limit gripe. The sharper read is posts that actually name the new model. Here's the
      tone of those posts over each model's first two days.
    </p>

    <ShareBars
      title="Tone of posts naming the new model · launch day + next day"
      legend={TONE_LEGEND}
      rows={LAUNCH_TONE_ROWS}
      ariaLabel="Share of positive, neutral, and negative posts naming each model in its first two days: Opus 5.5 75% positive and 19% negative, Opus 5 59% positive and 34% negative, Fable 5.1 55% positive and 36% negative."
    />

    <p>
      Opus 5.5 drew roughly half the posts Opus 5 did, and a far smaller share of them were negative. The
      praise is specific, too. Speed, token efficiency, and coding quality, from people on the top plan:
    </p>
    <PullQuote
      text="Been working non stop since release and has barely made a dent on my 20X Max usage. Quality so far has been better than Fable 5.1 in my workflow and ITS SO FAST."
      handle="r/ClaudeCode"
      platform="Reddit"
      timestamp="2026-09-23 02:09 UTC"
      href="https://www.reddit.com/r/ClaudeCode/comments/1wnt4d3/they_fucking_cooked_yo_opus_55_is_a_massive/"
    />
    <p>
      And the writing change Anthropic promised, "puts the most important information up front," goes
      straight at a complaint Opus 5 users kept making. It landed:
    </p>
    <PullQuote
      text="after a few hours use, my impression is that Opus 5.5 writes like gemini. drastic improvement over all opus 5.1's claudeisms."
      handle="notatoad"
      platform="Hacker News"
      timestamp="2026-09-22 23:39 UTC"
      href="https://news.ycombinator.com/item?id=49809761"
    />
    <p>
      Note the "opus 5.1." Even the people praising the upgrade remember a release that never shipped.
    </p>

    <h2 id="opus-5-launched-well-too">Opus 5 launched well too</h2>
    <p>
      This is where my hypothesis needs a footnote. Opus 5 didn't have a bad launch. Its first two days
      scored 59 and 60, among the best Claude days of July. Posts naming it ran 64% positive.
    </p>
    <p>
      Then it wore out.
    </p>

    <ArticleSeriesChart
      data={OPUS5_TONE_WEEKLY}
      valueSuffix="% positive"
      yDomain={[0, 60]}
      ariaLabel="Share of Opus 5 posts that were positive, by week after launch: 52% in week one, 47% in week two, 40% in week three, then 26 to 33% for the rest of August and September."
    />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Share of posts naming Opus 5 that were positive (of those that took a side), in 7-day buckets from
        the July 24 launch. The first bucket already includes the July 27–30 turn, which is why it starts at
        52% and not the 64% of the first two days.
      </em>
    </p>
    <p>
      One X user captured the whole arc in about 20 hours. Their first-day take was that Opus 5 "solved the
      biggest problems Fable 5 has - cost and speed… this is clearly going to be the daily driver." The next
      evening:
    </p>
    <PullQuote
      text="opus 5 is a VERY interesting release for a few reasons 1. it showed that the general benchmarks we use today are almost completely useless now opus 5 is nowhere near fable in practical use, not even close."
      handle="@kunchenguid"
      platform="X"
      timestamp="2026-07-25 21:11 UTC"
      href="https://x.com/kunchenguid/status/2081125298050060694"
    />
    <p>
      Three weeks in, positive share had halved. The Claude score bottomed at 32 on August 26 and spent
      most of late August in the 30s. The complaints weren't about price or refusals. 72% of the 1,412
      negative Opus 5 posts after launch week were some flavor of quality drop: lazy responses, worse code,
      "it got dumber."
    </p>
    <p>
      <strong>Opus 5.5's launch week looks a lot like Opus 5's launch week.</strong> Better, clearly. But
      Opus 5's first 72 hours would have fooled anyone reading them as a verdict. The best post in the
      launch corpus says exactly this:
    </p>
    <PullQuote
      text="Claude's biggest problem has never been launch-day quality. The problem is what happens 1–2 weeks later, when demand ramps up and the model starts feeling noticeably degraded. Opus 5 was great when it first launched too… Opus 5.5 is excellent today. The real test is whether it's still this good two weeks from now."
      handle="@jordan_ligren"
      platform="X"
      timestamp="2026-09-23 16:05 UTC"
      href="https://x.com/jordan_ligren/status/2102791558051590241"
    />
    <p>
      Our data can't tell you whether Opus 5 actually degraded or whether the novelty wore off and the
      complaints caught up. Both produce the same curve. What it can tell you is that the curve happened,
      when, and that people remember it. That memory is now the bar Opus 5.5 gets graded against.
    </p>

    <h2 id="the-rumblings">The rumblings: safeguards, not quality</h2>
    <p>
      Opus 5.5's complaints are few. Just 23 negative posts named it in the first 60 hours. But they have a
      different shape from anything Opus 5 produced.
    </p>

    <ShareBars
      title="What negative posts complain about"
      legend={COMPLAINT_LEGEND}
      rows={COMPLAINT_ROWS}
      ariaLabel="Complaint mix in negative posts: Opus 5.5 first 60 hours 39% refusals and safeguards, 35% quality; Opus 5 launch 8% refusals, 68% quality; Opus 5 after launch week 4% refusals, 72% quality."
    />

    <p>
      Refusals and safeguards went from 4–8% of Opus 5's complaints to 39% of Opus 5.5's. That's 9 posts,
      so treat the percentage loosely. But it has a clear cause. Anthropic says Opus 5.5 is comparable to
      Mythos 5.1 in biology and cybersecurity, so it ships with safeguards similar to Fable 5.1's, and
      flagged tasks fall back to an older model. Fable users already know how that goes.
    </p>
    <PullQuote
      text="I literally can't talk with Opus 5.5 about my article lmao. the safety monitors just go off"
      handle="@scaling01"
      platform="X"
      timestamp="2026-09-23 13:00 UTC"
      href="https://x.com/scaling01/status/2102744825531359669"
    />
    <PullQuote
      text="Opus 5.5 is powerful, but its safeguard is stupid. flagging my session with cybersecurity. isnt everything related to codes are cybersecurity?"
      handle="r/ClaudeCode"
      platform="Reddit"
      timestamp="2026-09-24 00:41 UTC"
      href="https://www.reddit.com/r/ClaudeCode/comments/1wonbh8/opus_55_is_powerful_but_its_safeguard_is_stupid/"
    />
    <p>
      I wrote about the same pattern in the{" "}
      <a href="/research/fable-5-lifecycle-june-july-2026">Fable 5 lifecycle</a> piece: refusal complaints
      showed up within 48 hours of launch and never came back down to baseline. The difference now is
      reach. Fable was the expensive model people opted into. Opus 5.5 is priced for everyday work.
    </p>
    <p>
      The other rumbling is usage limits. Anthropic raised five-hour limits and added a saved reset at
      launch. Posts mentioning limits still ran 5.6% of Claude chatter in the first two days, about where
      they were the week before (5.1%). The most-liked negative post of launch day asked for exactly that
      reset. The gap here is between what people want and what
      $200 a month buys, and a better model doesn't close it.
    </p>
    <PullQuote
      text="no matter how good opus 5.5 is it just doesnt make sense to have $200/m claude code plans anymore. you only get 1.7x usage, NOT 20x!!"
      handle="@ashen_one"
      platform="X"
      timestamp="2026-09-22 16:05 UTC"
      href="https://x.com/ashen_one/status/2102429046558609669"
    />

    <h2 id="openai-went-the-other-way">Same day, other direction: GPT-6 Sol and Luna</h2>
    <p>
      Opus 5.5 didn't launch alone. OpenAI shipped{" "}
      <ExternalLink href="https://siliconangle.com/2026/09/22/anthropic-releases-claude-opus-5-5-and-openai-counters-with-two-cheaper-gpt-6-models/">
        GPT-6 Sol and GPT-6 Luna
      </ExternalLink>{" "}
      the same afternoon, at half the price of the GPT-5.6 Sol and Luna they replace. So the natural question
      for OpenAI is the same one I asked about Anthropic: did people like the new generation more than the
      last one?
    </p>
    <p>
      No. And the two companies basically traded places.
    </p>

    <ResearchTableFrame label="ChatGPT and Claude scores around each generation's launch">
      <table className="w-full">
        <caption className="sr-only">
          Daily sentiment score in the week before each launch and over launch day plus the next day, for the
          two OpenAI and two Anthropic launches compared in this article.
        </caption>
        <thead>
          <tr>
            <th scope="col">Launch</th>
            <th scope="col" className="whitespace-nowrap">Week before</th>
            <th scope="col" className="whitespace-nowrap">First two days</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="whitespace-nowrap">GPT-5.6 · Jul 9</td>
            <td>33.9</td>
            <td>54.5</td>
            <td><strong>+20.6</strong></td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">GPT-6 Sol + Luna · Sep 22</td>
            <td>58.7</td>
            <td>50.0</td>
            <td><strong>−8.7</strong></td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Opus 5 · Jul 24</td>
            <td>52.4</td>
            <td>59.5</td>
            <td>+7.1</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Opus 5.5 · Sep 22</td>
            <td>38.1</td>
            <td>58.0</td>
            <td>+19.9</td>
          </tr>
        </tbody>
      </table>
    </ResearchTableFrame>

    <p>
      In July, GPT-5.6 got the 20-point launch pop. In September, Opus 5.5 got it and ChatGPT lost 9 points
      on launch day plus the next. Same size swing, opposite company.
    </p>

    <EmbeddedModelChart modelSlug="chatgpt" startDate="2026-07-01" endDate="2026-09-23" />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        ChatGPT's daily sentiment score, July 1 – September 23, 2026, with the GPT-5.6, GPT-6 Astra and GPT-6
        Sol launches marked. GPT-5.6 lifts it out of the 30s. GPT-6 Sol arrives near the summer high and
        dips.
      </em>
    </p>

    <p>
      The complaints are about the model itself, and the model it replaced keeps coming up. People liked
      GPT-5.6 Sol, and GPT-6 Sol reads to them as cheaper rather than better:
    </p>
    <PullQuote
      text="I think it's safe to say that GPT-6 Sol came in below expectations. Anthropic wins the day"
      handle="@synthwavedd"
      platform="X"
      timestamp="2026-09-22 18:50 UTC"
      href="https://x.com/synthwavedd/status/2102470593744605594"
    />
    <PullQuote
      text={'I\'m sad man. GPT-6-Sol has no soul, no humour, just a mechanical robot compared to GPT-5.6-Sol. I\'m going to really miss 5.6-Sol when they retire it. I can now sympathize with the "Bring Back 4o" crowd.'}
      handle="@migtissera"
      platform="X"
      timestamp="2026-09-23 16:01 UTC"
      href="https://x.com/migtissera/status/2102790471567454676"
    />
    <PullQuote
      text="API pricing looks great, but in Codex my real usage tells a different story. GPT-6 Luna Max is consuming far more of my 5h limit than GPT-5.6 Luna Max on similar tasks — often 10–15%+ vs ~3% before"
      handle="@mostafa_najee"
      platform="X"
      timestamp="2026-09-23 04:03 UTC"
      href="https://x.com/mostafa_najee/status/2102609762131268092"
    />
    <p>
      It isn't all negative. Peter Yang's take, relayed on Techmeme, is probably the fairest one-line summary
      of launch day: "GPT 6 Sol definitely feels better than GPT 5.6 and I still prefer ChatGPT as my harness
      but in my humble opinion Opus 5.5 is the best model available right now." Better than its
      predecessor, and still not the model people were talking about.
    </p>
    <p>
      <strong>Price cuts don't read as upgrades.</strong> Opus 5.5 cut price and still felt like a jump.
      GPT-6 Sol cut price by more and felt like a trade: half the cost, some of the personality gone, and
      at least some Codex users reporting that their limits burn faster. When the same-day comparison is a model people call
      the best available, "cheaper" loses.
    </p>

    <h2 id="an-independent-check">An independent check: 1,500 posts, graded separately</h2>
    <p>
      Our pipeline samples. It keeps a slice of each platform, and on launch days the slices get thin: 22
      relevant posts named GPT-6 Sol or Luna in its first two days. So I pulled a bigger sample and graded it
      outside the pipeline entirely. Every Hacker News comment and story naming each model in its launch
      window, plus about 230 X posts per window, 1,499 posts in all. A separate LLM pass labeled each one
      positive, neutral, negative or irrelevant toward the named model, with no access to our classifier's
      labels.
    </p>

    <ShareBars
      title="Independent sample · tone toward the named model · launch day + next day"
      legend={TONE_LEGEND}
      rows={CROSS_CHECK_ROWS}
      ariaLabel="Independent sample of Hacker News and X posts: Opus 5.5 61% positive and 18% negative, Opus 5 45% positive and 29% negative, GPT-5.6 60% positive and 25% negative, GPT-6 Sol and Luna 44% positive and 37% negative."
    />

    <p>
      Same story, bigger sample. Among posts that took a side, Opus 5.5 ran 77% positive against Opus 5's
      61%, and GPT-6 Sol and Luna ran 54% against GPT-5.6's 70%. Our pipeline had 80%, 64%, 65% and 48%.
      Every direction matches.
    </p>
    <p>
      The complaint shapes held up too. Safeguards were the biggest single complaint about Opus 5.5 (16 of
      56 negative posts, all of them on Hacker News),
      against 12 of 93 for Opus 5. For GPT-6 Sol and Luna, 60 of 72 complaints were about
      quality, and a recurring version was "5.6 was better."
    </p>
    <p>
      One wrinkle worth keeping. Split by platform, Hacker News liked GPT-6 Sol and Luna <em>more</em> than
      GPT-5.6 (25 positive to 14 negative, against 39 to 31). The GPT-6 disappointment is an X story, where
      it went from 111-to-32 positive for GPT-5.6 to an even 61-to-58. Hacker News reads price-performance
      tables. X reads vibes. Both are real audiences, and they disagreed.
    </p>

    <h2 id="what-i-would-watch">What I'd watch if I shipped this model</h2>
    <p>
      Nick Turley, head of ChatGPT,{" "}
      <ExternalLink href="https://www.youtube.com/watch?v=ixY2PvQJ0To">said it plainly on Lenny's Podcast</ExternalLink> last year:
      most users "don't look at the academic benchmarks. They don't look at evaluations. They try the model
      and see what it feels like." Anthropic's Dianne Penn{" "}
      <ExternalLink href="https://www.lennysnewsletter.com/p/anthropics-first-technical-pm-on">
        described her team's job
      </ExternalLink>{" "}
      as finding "the right user feedback, the evals that then can be a personification of that user
      need."
    </p>
    <p>
      Public chatter is a noisy version of that feedback. Read over time, not on launch day, it works like
      an eval that runs itself. Three things from this one:
    </p>
    <p>
      <strong>Launch week is the least informative week.</strong> Opus 5 and Opus 5.5 both opened strong.
      What separated Opus 5's reputation from its benchmarks was weeks 2 through 4. If I owned this launch,
      the number I'd put on the wall is the tone of Opus 5.5 posts on day 14, next to Opus 5's 40%.
    </p>
    <p>
      <strong>Safeguard friction is the new quality complaint.</strong> For Opus 5, 72% of complaints were
      "it got worse." For Opus 5.5, the loudest early complaint is "it won't let me." Different fix, different
      team, and a false-positive rate you can measure straight from public posts.
    </p>
    <p>
      <strong>Skipping a version is a promise.</strong> People asked for a 5.1 to fix 5. They got 5.5, a
      price cut, and a writing style they already like. That's a bigger promise, and weeks 2 through 4 are
      when it gets graded.
    </p>

    <h2 id="confounds">Confounds</h2>
    <p>
      Two, and I'd rather name them than bury them.
    </p>
    <p>
      <strong>We changed our classifier the day after launch.</strong> LLM Vibes moved from GPT-5.6 Terra to
      GPT-6 Sol on September 23, so about two-thirds of that day's Claude posts went through the new model.
      I checked whether that moved the number. Among September 23 posts, Terra rated 61.4% positive and Sol
      62.7%. That's noise, not a shift. Launch day itself (September 22) is all Terra.
    </p>
    <p>
      <strong>The OpenAI comparison has its own seams.</strong> GPT-5.6's second day, July 10, is the day we
      shipped a pipeline overhaul (new sources and a scoring change), so its +20.6 is partly our instrument
      moving; its launch day alone went from a 33.9 weekly average to 52. And from September 23 our classifier
      is GPT-6 Sol, grading posts about itself. It didn't flatter itself: 19 of the 22 GPT-6 Sol and Luna
      posts in the pipeline window were graded by the outgoing Terra model anyway, and the independent
      sample above doesn't use our classifier at all.
    </p>
    <p>
      <strong>Two days is two days.</strong> Opus 5.5's windows are small: 122 relevant posts naming it,
      23 of them negative. The direction is clear. The exact percentages will move. OpenAI also shipped
      GPT-6 Sol the same day, so some Opus 5.5 posts are head-to-head comparisons, not standalone
      reactions.
    </p>

    <h2 id="methodology">Methodology</h2>
    <p>
      LLM Vibes scrapes public posts about Claude, ChatGPT, Gemini and Grok from Reddit, Hacker News,
      Bluesky, X and App Store reviews. An LLM classifier tags each post's relevance, sentiment, and complaint
      or praise category, and a volume-weighted daily score runs 0–100 (
      <a href="/research/how-llm-vibes-classifies-sentiment">full method</a>).
    </p>
    <p>
      "Posts naming the model" match <code>opus 5</code> (not followed by a decimal), <code>opus 5.5</code>, or{" "}
      <code>fable 5.1</code> in the title or body, among Claude posts the classifier kept as relevant.
      Launch windows use Pacific days. "Week before" is the seven daily Claude scores before launch day.
      Complaint groups combine the classifier's categories: quality drop is general drop, lazy responses,
      coding quality, reasoning and hallucinations; refusals and safeguards is refusals plus censorship.
      Limits share is a text match (<code>usage limit</code>, <code>rate limit</code>, <code>5-hour</code> and
      similar) over relevant Claude posts. Sonnet 5 shipped the day before Fable 5 came back from its suspension, so
      its row is muddied by that news.
    </p>
    <p>
      The independent sample pulled every Hacker News story and comment matching each model name in its
      window from the public Algolia API, plus two latest-sorted X searches per window (one per day, UTC)
      through the same Apify actor the pipeline uses, deduplicated with retweets dropped. Each post was
      graded by Claude Sonnet 5 reading it in full against a fixed rubric; announcement relays, leak posts and
      spam were marked irrelevant. Posts from the labs' own staff were not filtered out, which nudges every
      window slightly positive.
    </p>
    <p>
      Download the{" "}
      <a href="/research/opus-5-5-vs-opus-5-launch-sentiment-2026/data.csv">dataset</a> (daily Claude score
      plus positive and negative mention counts for Opus 5, Opus 5.5 and Fable 5.1, July 13 – September
      23), the <a href="/research/opus-5-5-vs-opus-5-launch-sentiment-2026/chatgpt-launches.csv">ChatGPT
      launch series</a>, the{" "}
      <a href="/research/opus-5-5-vs-opus-5-launch-sentiment-2026/independent-sample.csv">1,499 graded posts</a>{" "}
      from the independent check, or{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods">fork the pipeline on GitHub</ExternalLink>.
      The <a href="/model/claude">live Claude chart</a> will show whether Opus 5.5 holds past day 14.
    </p>

    <AuthorBio />
  </>
);

export default OpusLaunchBody;
