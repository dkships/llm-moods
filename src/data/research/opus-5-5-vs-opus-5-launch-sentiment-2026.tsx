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

// Relevant posts naming each model, days 1–2 and days 3–6 after launch
// (Pacific; launch day is day 1).
const LAUNCH_TONE_ROWS = [
  { label: "Opus 5.5 · days 1–2", detail: "122 posts", counts: { positive: 91, neutral: 8, negative: 23 } },
  { label: "Opus 5.5 · days 3–6", detail: "208 posts", counts: { positive: 164, neutral: 9, negative: 35 } },
  { label: "Opus 5 · days 1–2", detail: "223 posts", counts: { positive: 132, neutral: 16, negative: 75 } },
  { label: "Opus 5 · days 3–6", detail: "550 posts", counts: { positive: 235, neutral: 60, negative: 255 } },
  { label: "Fable 5.1 · days 1–2", detail: "113 posts", counts: { positive: 62, neutral: 10, negative: 41 } },
  { label: "Fable 5.1 · days 3–6", detail: "129 posts", counts: { positive: 63, neutral: 5, negative: 61 } },
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
  { label: "Opus 5.5 · days 1–2", detail: "23 complaints", counts: { safety: 9, quality: 8, price: 2, other: 4 } },
  { label: "Opus 5.5 · days 3–6", detail: "35 complaints", counts: { safety: 4, quality: 19, price: 3, other: 9 } },
  { label: "Opus 5 · days 1–6", detail: "330 complaints", counts: { safety: 16, quality: 231, price: 25, other: 58 } },
  { label: "Opus 5 · Jul 30 – Sep 21", detail: "1,183 complaints", counts: { safety: 51, quality: 850, price: 53, other: 229 } },
];

// Independent cross-check: every Hacker News post naming the model (Algolia
// API) plus ~230 X posts per window (days 1–2) or ~440 (days 3–6), graded by
// a separate LLM pass that never touched our production classifier.
// Irrelevant posts excluded. Per-post labels are in independent-sample.csv.
const CROSS_CHECK_ROWS = [
  { label: "Opus 5.5 · days 1–2", detail: "311 posts", counts: { positive: 189, neutral: 66, negative: 56 } },
  { label: "Opus 5.5 · days 3–6", detail: "508 posts", counts: { positive: 393, neutral: 77, negative: 38 } },
  { label: "Opus 5 · days 1–2", detail: "321 posts", counts: { positive: 146, neutral: 82, negative: 93 } },
  { label: "Opus 5 · days 3–6", detail: "406 posts", counts: { positive: 181, neutral: 50, negative: 175 } },
  { label: "GPT-5.6 · days 1–2", detail: "250 posts", counts: { positive: 150, neutral: 37, negative: 63 } },
  { label: "GPT-5.6 · days 3–6", detail: "370 posts", counts: { positive: 231, neutral: 56, negative: 83 } },
  { label: "GPT-6 Sol + Luna · days 1–2", detail: "196 posts", counts: { positive: 86, neutral: 38, negative: 72 } },
  { label: "GPT-6 Sol + Luna · days 3–6", detail: "297 posts", counts: { positive: 107, neutral: 51, negative: 139 } },
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
      My hypothesis going in was simple. Everyone is much happier with Opus 5.5 than they were with
      Opus 5, the model before it.
    </p>
    <p>
      The data says I'm mostly right. And the part where I'm wrong is the more useful part. Also, OpenAI
      launched GPT-6 Sol and Luna the same afternoon, and that launch landed flat.
    </p>

    <StatCallout
      stats={[
        { value: "+27 pts", label: "Claude score, week before launch → first six days (38 → 65)" },
        { value: "81%", label: "Opus 5.5 posts that took a side and were positive, days 1–6 (Opus 5: 53%)" },
      ]}
    />

    <h2 id="there-was-no-opus-5-1">Everyone expected Opus 5.1</h2>
    <p>
      <ExternalLink href="https://www.anthropic.com/news/claude-opus-5">Opus 5</ExternalLink> shipped on
      July 24. Within a month, people had a name for the fix they wanted: Opus 5.1. 20 posts between August
      20 and September 21 named it, from leak chatter to outright pleading. Not a wave, but the message is
      consistent: Opus 5 has problems, and people were waiting for a point release to fix them.
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
      The leaks followed the same path, and our <a href="/rumors">rumors radar</a> logged each step. An
      "Opus 5.1" (codename Marshmallow) turned up in third-party apps on August 23. On September 14, reports
      had Claude Code quietly routing Opus 5 traffic to an "Opus 5.2" that was faster and less lazy. On
      September 20, a leaker said the model in testing had been renamed from 5.2 to 5.5.
    </p>
    <p>
      Two days later Anthropic shipped{" "}
      <ExternalLink href="https://www.anthropic.com/news/claude-opus-5-5">Opus 5.5</ExternalLink>, at $4/$20
      per million tokens against Opus 5's $5/$25. There never was an Opus 5.1. My read of the naming is that
      the model in testing turned out good enough that a point release would have undersold it, so it got a
      bigger number. Anthropic hasn't said that, but the version path fits. <strong>People asked for a
      fix-it release and got a bigger jump instead.</strong> So this piece compares Opus 5.5 against Opus 5,
      with Fable 5.1 (September 1) as the other recent Anthropic launch.
    </p>

    <h2 id="the-launch-scorecard">The launch scorecard</h2>
    <p>
      Here's Claude's daily score from mid-July through Opus 5.5's sixth day. The launches are marked.
    </p>

    <EmbeddedModelChart modelSlug="claude" startDate="2026-07-13" endDate="2026-09-27" />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Claude's daily sentiment score, July 13 – September 27, 2026. Opus 5 lands on a rising line and
        holds it for three days. Then the slide. Opus 5.5 lands on the lowest stretch of the summer, climbs
        for four days, and holds there: 55, 61, 67, 71, 69, 67.
      </em>
    </p>
    <p>
      71 on September 25 was Claude's best day since February. Put six Anthropic launches since April side
      by side and nothing else is close. Opus 4.7 had the nearest two-day pop, and by its fifth day the
      score was at 29.
    </p>

    <ResearchTableFrame label="Claude score around six Anthropic launches">
      <table className="w-full">
        <caption className="sr-only">
          Claude daily sentiment score in the week before each launch, over days 1–2 and days 3–6 after it
          (launch day is day 1), and the change from the week before to the six-day average.
        </caption>
        <thead>
          <tr>
            <th scope="col">Launch</th>
            <th scope="col" className="whitespace-nowrap">Week before</th>
            <th scope="col" className="whitespace-nowrap">Days 1–2</th>
            <th scope="col" className="whitespace-nowrap">Days 3–6</th>
            <th scope="col" className="whitespace-nowrap">Change, days 1–6</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="whitespace-nowrap">Opus 5.5 · Sep 22</td>
            <td>38.1</td>
            <td>58.0</td>
            <td>68.5</td>
            <td><strong>+26.9</strong></td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Fable 5.1 · Sep 1</td>
            <td>36.9</td>
            <td>43.5</td>
            <td>44.3</td>
            <td>+7.1</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Opus 4.7 · Apr 17</td>
            <td>38.3</td>
            <td>54.5</td>
            <td>39.0</td>
            <td>+5.9</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Sonnet 5 · Jun 30</td>
            <td>51.3</td>
            <td>49.5</td>
            <td>60.0</td>
            <td>+5.2</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Opus 5 · Jul 24</td>
            <td>52.4</td>
            <td>59.5</td>
            <td>51.3</td>
            <td>+1.6</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Fable 5 · Jun 9</td>
            <td>54.6</td>
            <td>48.5</td>
            <td>48.3</td>
            <td>−6.3</td>
          </tr>
        </tbody>
      </table>
    </ResearchTableFrame>

    <p>
      The daily score covers everything people say about Claude, so a launch gets diluted by every
      unrelated rate-limit gripe. The sharper read is posts that actually name the new model. Here's the
      tone of those posts over each model's first two days, then days three through six.
    </p>

    <ShareBars
      title="Tone of posts naming the new model · days 1–2 vs days 3–6"
      legend={TONE_LEGEND}
      rows={LAUNCH_TONE_ROWS}
      ariaLabel="Share of positive, neutral, and negative posts naming each model. Opus 5.5: 75% positive and 19% negative in days 1–2, 79% positive and 17% negative in days 3–6. Opus 5: 59% and 34%, then 43% and 46%. Fable 5.1: 55% and 36%, then 49% and 47%."
    />

    <p>
      This is the chart I'd point to. Opus 5 and Fable 5.1 both cooled after day two. Opus 5.5 warmed up.
      Of posts that took a side, it went from 80% positive to 82%, while Opus 5 went from 64% to 48% and
      Fable 5.1 from 60% to 51%.
    </p>
    <p>
      The praise is specific, too. Speed, token efficiency, and coding quality, from people on the top plan:
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
    <p>
      By days three through six, the posts sound less like first impressions and more like people who've
      moved their work over. The most-upvoted Reddit post naming it in days three to five was a late
      convert:
    </p>
    <PullQuote
      text="I didn't understand what everybody was talking about, it felt better and stopped pushing back artificially like previous models, but the quality of the code and the model's understanding didn't seem that special... Tonight I was bored and asked it to do a product video for the thing I've been building for a few months and I was shocked by the results."
      handle="r/ClaudeAI · “Aight I get it, Opus 5.5 is actually peak”"
      platform="Reddit"
      timestamp="2026-09-26 00:18 UTC"
      href="https://www.reddit.com/r/ClaudeAI/comments/1wqcara/aight_i_get_it_opus_55_is_actually_peak/"
    />
    <p>
      On day six, the top Reddit post naming it wasn't a review at all. It was a whole Game Boy game, rebuilt
      by the model:
    </p>
    <PullQuote
      text="Pokémon Claude Red: Opus 5.5 remade all of Pokémon Red and drew every pixel in code. No image files, playable in browser"
      handle="r/ClaudeAI"
      platform="Reddit"
      timestamp="2026-09-27 23:10 UTC"
      href="https://www.reddit.com/r/ClaudeAI/comments/1wryjs1/pok%C3%A9mon_claude_red_opus_55_remade_all_of_pok%C3%A9mon/"
    />

    <h2 id="opus-5-launched-well-too">Opus 5 launched well too</h2>
    <p>
      This is where my hypothesis needs a footnote. Opus 5 didn't have a bad launch. Its first two days
      scored 59 and 60, among the best Claude days of July. Posts naming it ran 64% positive.
    </p>
    <p>
      Then it wore out.
    </p>

    <ArticleSeriesChart
      title="Opus 5 · share positive by week since launch"
      data={OPUS5_TONE_WEEKLY}
      valueSuffix="% positive"
      yDomain={[0, 60]}
      ariaLabel="Share of Opus 5 posts that were positive, by week after launch: 52% in week one, 47% in week two, 40% in week three, then 26 to 33% for the rest of August and September."
    />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Share of posts naming Opus 5 that were positive (of those that took a side), in 7-day buckets from
        the July 24 launch. The first bucket already includes the slide that started July 27, which is why it
        starts at 52% and not the 64% of the first two days.
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
      most of late August in the 30s. The complaints weren't about price or refusals. 72% of the 1,183
      negative Opus 5 posts from July 30 to September 21 were some flavor of quality drop: lazy responses, worse code,
      "it got dumber."
    </p>
    <p>
      The turn started fast. By day five, July 28, negative posts naming Opus 5 outnumbered positive ones,
      78 to 72. On day six it was 92 to 55. Opus 5.5's day six, September 27, ran 45 positive to 10
      negative.
    </p>
    <p>
      <strong>Through day two, Opus 5.5's launch looked a lot like Opus 5's. Days three to six are where
      they split.</strong> Opus 5's first 72 hours would have fooled anyone reading them as a verdict. The
      best post in the launch corpus says exactly this:
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
    <p>
      You can see people pricing it in. Seven posts in our pipeline naming Opus 5.5 from September 24 to 26
      used words like "nerf" or "degraded." Only one claimed it had actually happened. The rest were
      conditions:
    </p>
    <PullQuote
      text="Real talk: If Anthropic never nerfs Opus 5.5, I will keep my Max subscription for years..."
      handle="r/ClaudeAI"
      platform="Reddit"
      timestamp="2026-09-25 03:30 UTC"
      href="https://www.reddit.com/r/ClaudeAI/comments/1wpluhu/real_talk_if_anthropic_never_nerfs_opus_55_i_will/"
    />
    <PullQuote
      text="I'm doing Codex $200 and Claude $100 but will be switching those numbers if Opus 5.5 doesn't get nerfed."
      handle="@Kyle_Wolt"
      platform="X"
      timestamp="2026-09-24 16:04 UTC"
      href="https://x.com/Kyle_Wolt/status/2103153604571853308"
    />

    <h2 id="the-rumblings">The rumblings: safeguards first, then comparisons</h2>
    <p>
      Opus 5.5's complaints are few. 58 negative posts named it across six days, against 330 for Opus 5
      over the same stretch. But they have a different shape from anything Opus 5 produced.
    </p>

    <ShareBars
      title="What negative posts complain about"
      legend={COMPLAINT_LEGEND}
      rows={COMPLAINT_ROWS}
      ariaLabel="Complaint mix in negative posts: Opus 5.5 days 1–2 39% refusals and safeguards, 35% quality; Opus 5.5 days 3–6 11% refusals, 54% quality; Opus 5 days 1–6 5% refusals, 70% quality; Opus 5 after that 4% refusals, 72% quality."
    />

    <p>
      In the first two days, refusals and safeguards were 39% of Opus 5.5's complaints, against 4–5% of
      Opus 5's. That's 9 posts, so treat the percentage loosely. But it has a clear cause. Anthropic says Opus 5.5 is comparable to
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
      showed up within 48 hours of launch and never came back down to baseline. Opus 5.5 is, so far, the
      opposite. Safeguard complaints fell to 4 of 35 in days three to six. Across all relevant Claude posts,
      refusal and flagging language went from 2.8% the week before launch to 5.1% in the first two days,
      then back to 2.8%, right where it started.
    </p>
    <p>
      It hasn't gone away, though, and the false positives that remain are hard to defend:
    </p>
    <PullQuote
      text="Task paused: Opus 5.5's safety measures flagged this message for sensitive topics. To continue, switch to a different model. Details: [reasoning_extraction] Tasks are extremely mundane - like “help me order food from this menu”, “create a new excel for sales commissions” or “find the best VPN” etc"
      handle="r/ClaudeAI"
      platform="Reddit"
      timestamp="2026-09-25 03:36 UTC"
      href="https://www.reddit.com/r/ClaudeAI/comments/1wplz0c/hitting_claudes_ridiculous_filters/"
    />
    <p>
      In days three to six, quality took over as the biggest bucket: 19 of 35 complaints. Those aren't
      "it got dumber" posts, though. They're specific gripes (it repeats itself, it does too much without
      explaining what it did) and head-to-heads with OpenAI's GPT-6 Astra on long agentic tasks. On Hacker
      News, a newer complaint is length. That's worth watching, because the way Opus 5 wrote was exactly
      what this release was supposed to fix:
    </p>
    <PullQuote
      text="today I'm really fed up with Opus 5.5. Yes, it's the best model right now if you want cheaper than Astra, but they increased the verbosity again! It just keeps dumping whole novels on me. … It's been three days since Tuesday and I'm already tired of Opus 5.5."
      handle="User43928"
      platform="Hacker News"
      timestamp="2026-09-25 21:41 UTC"
      href="https://news.ycombinator.com/item?id=49850356"
    />
    <p>
      The other rumbling is usage limits. Anthropic raised five-hour limits and added a saved reset at
      launch. On launch day, the most-liked negative post was about exactly that:
    </p>
    <PullQuote
      text="no matter how good opus 5.5 is it just doesnt make sense to have $200/m claude code plans anymore. you only get 1.7x usage, NOT 20x!!"
      handle="@ashen_one"
      platform="X"
      timestamp="2026-09-22 16:05 UTC"
      href="https://x.com/ashen_one/status/2102429046558609669"
    />
    <p>
      Then the limits conversation flipped. The week before launch, 35 of the 52 Claude posts about usage
      limits were negative. In days three to six, 32 of 40 were positive. People were noticing how slowly
      their usage moved:
    </p>
    <PullQuote
      text="IF YOU THINK YOU CANNOT AFFORD OPUS 5.5 please try using Opus 5.5 and see. Compared even to Opus 5 the new model appears to *sip* tokens. I can't believe how slowly my usage is ticking up."
      handle="@jefferyharrell.bsky.social"
      platform="Bluesky"
      timestamp="2026-09-25 19:41 UTC"
      href="https://bsky.app/profile/jefferyharrell.bsky.social/post/3mwejnprhf22a"
    />
    <p>
      By day six that had become a point about the cheapest plan, and the competition:
    </p>
    <PullQuote
      text="The best part about Opus 5.5 is that the $20 Claude plan feels usable. And it will force OpenAI to actually care about their $20 Plus users again."
      handle="@ishuagra02"
      platform="X"
      timestamp="2026-09-27 23:42 UTC"
      href="https://x.com/ishuagra02/status/2104356143199867328"
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
      Not really. Compared with July, the two companies traded places.
    </p>

    <ResearchTableFrame label="ChatGPT and Claude scores around each generation's launch">
      <table className="w-full">
        <caption className="sr-only">
          Daily sentiment score in the week before each launch, over days 1–2 and days 3–6 after it, and the
          change to the six-day average, for the two OpenAI and two Anthropic launches compared in this
          article.
        </caption>
        <thead>
          <tr>
            <th scope="col">Launch</th>
            <th scope="col" className="whitespace-nowrap">Week before</th>
            <th scope="col" className="whitespace-nowrap">Days 1–2</th>
            <th scope="col" className="whitespace-nowrap">Days 3–6</th>
            <th scope="col" className="whitespace-nowrap">Change, days 1–6</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="whitespace-nowrap">GPT-5.6 · Jul 9</td>
            <td>33.9</td>
            <td>54.5</td>
            <td>49.0</td>
            <td><strong>+16.9</strong></td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">GPT-6 Sol + Luna · Sep 22</td>
            <td>58.7</td>
            <td>54.5</td>
            <td>60.8</td>
            <td><strong>0.0</strong></td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Opus 5 · Jul 24</td>
            <td>52.4</td>
            <td>59.5</td>
            <td>51.3</td>
            <td>+1.6</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Opus 5.5 · Sep 22</td>
            <td>38.1</td>
            <td>58.0</td>
            <td>68.5</td>
            <td>+26.9</td>
          </tr>
        </tbody>
      </table>
    </ResearchTableFrame>

    <p>
      In July, GPT-5.6 got the big launch pop. In September, Opus 5.5 got it and ChatGPT's score didn't
      move: a small dip over the first two days, then back to a touch above where it was.
    </p>

    <EmbeddedModelChart modelSlug="chatgpt" startDate="2026-07-01" endDate="2026-09-27" />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        ChatGPT's daily sentiment score, July 1 – September 27, 2026, with the GPT-5.6, GPT-6 Astra and GPT-6
        Sol launches marked. GPT-5.6 lifts it out of the 30s. GPT-6 Sol arrives near the summer high and
        stays there.
      </em>
    </p>
    <p>
      The daily score is flat. The posts that name GPT-6 Sol or Luna aren't warm, though. Of the ones that
      took a side, 48% were positive in days one and two, and 49% in days three to six. GPT-5.6 had opened
      at 65%.
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

    <h2 id="an-independent-check">An independent check: 3,700 posts, graded separately</h2>
    <p>
      Our pipeline samples. It keeps a slice of each platform, and on launch days the slices get thin: 22
      relevant posts named GPT-6 Sol or Luna in its first two days. So I pulled a bigger sample and graded it
      outside the pipeline entirely. Every Hacker News comment and story naming each model in its first six
      days, plus 230 to 470 X posts per window, 3,690 posts in all. A separate LLM pass labeled each one
      positive, neutral, negative or irrelevant toward the named model, with no access to our classifier's
      labels.
    </p>

    <ShareBars
      title="Independent sample · tone toward the named model · days 1–2 vs days 3–6"
      legend={TONE_LEGEND}
      rows={CROSS_CHECK_ROWS}
      ariaLabel="Independent sample of Hacker News and X posts. Opus 5.5: 61% positive and 18% negative in days 1–2, 77% and 7% in days 3–6. Opus 5: 45% and 29%, then 45% and 43%. GPT-5.6: 60% and 25%, then 62% and 22%. GPT-6 Sol and Luna: 44% and 37%, then 36% and 47%."
    />

    <p>
      Same story, bigger sample. Among posts that took a side, Opus 5.5 went from 77% positive in days one
      and two to 91% in days three to six. Opus 5 went from 61% to 51%. GPT-6 Sol and Luna slipped from 54%
      to 44%, while GPT-5.6 had held at 70–74%.
    </p>
    <p>
      One place the two methods disagree: GPT-5.6's days three to six. Our pipeline had it cooling to 49%,
      on just 56 posts, right after our July 10 pipeline overhaul. The bigger sample says it held. Every other
      direction matches.
    </p>
    <p>
      The complaint shapes held up too. In the first two days, safeguards were the biggest single complaint
      about Opus 5.5 (16 of 56 negative posts, all of them on Hacker News). In days three to six they
      dropped to 6 of 38, and quality became the biggest bucket at 18. For GPT-6 Sol and Luna, quality was
      94 of 139 complaints in days three to six, and a recurring version was still "5.6 was better."
    </p>
    <p>
      Split by platform, the most interesting move is Hacker News. It was the cooler audience on Opus 5.5 at
      launch, 53% positive of posts that took a side. By days three to six it was 76%. X was already at 93%
      and stayed there. On GPT-6, the launch-day split between the two platforms didn't last. In days one and two, Hacker News
      liked GPT-6 Sol and Luna <em>more</em> than GPT-5.6 (25 positive to 14 negative, against 39 to 31).
      By days three to six, Hacker News had mostly stopped talking about them: 24 posts named GPT-6 Sol or
      Luna, against 110 for GPT-5.6 over the same stretch of its launch.
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
      <strong>The first two days are the least informative days.</strong> Opus 5 and Opus 5.5 both opened
      strong. Days three to six already told them apart, and what separated Opus 5's reputation from its
      benchmarks was weeks 2 through 4. If I owned this launch, the number I'd put on the wall is the tone
      of Opus 5.5 posts on day 14, next to Opus 5's 40%.
    </p>
    <p>
      <strong>Safeguard friction is the new quality complaint.</strong> For Opus 5, 71% of complaints were
      "it got worse." For Opus 5.5, the loudest launch-day complaint was "it won't let me." It faded by day
      three, but the false positives that remain are the kind you can count straight from public posts.
      Different fix, different team.
    </p>
    <p>
      <strong>Skipping a version is a promise.</strong> People asked for a 5.1 to fix 5. They got 5.5, a
      price cut, and a writing style they already like. That's a bigger promise, and weeks 2 through 4 are
      when it gets graded.
    </p>

    <h2 id="confounds">Confounds</h2>
    <p>
      Three, and I'd rather name them than bury them.
    </p>
    <p>
      <strong>We changed our classifier the day after launch.</strong> LLM Vibes moved from GPT-5.6 Terra to
      GPT-6 Sol on September 23, so about two-thirds of that day's Claude posts went through the new model,
      and every day after it is all Sol. I checked whether that moved the number. Among September 23 posts,
      Terra rated 61.4% positive and Sol 62.7%. That's noise, not a shift. Launch day itself (September 22)
      is all Terra.
    </p>
    <p>
      <strong>The OpenAI comparison has its own seams.</strong> GPT-5.6's second day, July 10, is the day we
      shipped a pipeline overhaul (new sources and a scoring change), so its +17.7 is partly our instrument
      moving; its launch day alone went from a 33.9 weekly average to 52. And from September 23 our classifier
      is GPT-6 Sol, grading posts about itself. It didn't flatter itself: posts naming GPT-6 Sol or Luna
      stayed at 48% positive after the switch, and the independent sample above doesn't use our classifier
      at all.
    </p>
    <p>
      <strong>Six days is still six days.</strong> Opus 5.5's windows are small: 330 relevant posts naming
      it, 58 of them negative. The direction is clear. The exact percentages will move. OpenAI also shipped
      GPT-6 Sol the same day, so some Opus 5.5 posts are head-to-head comparisons, not standalone
      reactions. And the window stops at September 27 on purpose: Anthropic shipped Sonnet 5.5 the next
      day, and every Claude number after that mixes two launches. Leaks about it were already circulating
      on the 27th, but only one relevant post in our pipeline mentioned it that day.
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
      Launch windows use full Pacific days, with launch day as day 1; the current, still-filling day is
      never counted. "Week before" is the seven daily scores before launch day.
      Complaint groups combine the classifier's categories: quality drop is general drop, lazy responses,
      coding quality, reasoning and hallucinations; refusals and safeguards is refusals plus censorship.
      Limits share is a text match (<code>usage limit</code>, <code>rate limit</code>, <code>5-hour</code> and
      similar) over relevant Claude posts; refusal language likewise (<code>refus</code>, <code>flagged</code>,{" "}
      <code>safeguard</code>, <code>classifier</code>, <code>fallback</code> and similar). Sonnet 5 shipped the day before Fable 5 came back from its suspension, so
      its row is muddied by that news.
    </p>
    <p>
      The independent sample pulled every Hacker News story and comment matching each model name in its
      window from the public Algolia API, plus latest-sorted X searches for each day (UTC)
      through the same Apify actor the pipeline uses, deduplicated with retweets dropped. Each post was
      graded by Claude Sonnet 5 reading it in full against a fixed rubric; announcement relays, leak posts and
      spam were marked irrelevant. Posts from the labs' own staff were not filtered out, which nudges every
      window slightly positive.
    </p>
    <p>
      Download the{" "}
      <a href="/research/opus-5-5-vs-opus-5-launch-sentiment-2026/data.csv">dataset</a> (daily Claude score
      plus positive and negative mention counts for Opus 5, Opus 5.5 and Fable 5.1, July 13 – September
      27), the <a href="/research/opus-5-5-vs-opus-5-launch-sentiment-2026/chatgpt-launches.csv">ChatGPT
      launch series</a>, the{" "}
      <a href="/research/opus-5-5-vs-opus-5-launch-sentiment-2026/independent-sample.csv">3,690 graded posts</a>{" "}
      from the independent check, or{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods">fork the pipeline on GitHub</ExternalLink>.
      The <a href="/model/claude">live Claude chart</a> will show whether Opus 5.5 holds past day 14.
    </p>

    <AuthorBio />
  </>
);

export default OpusLaunchBody;
