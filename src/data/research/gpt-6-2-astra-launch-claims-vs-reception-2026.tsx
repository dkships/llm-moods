/**
 * Body component for /research/gpt-6-2-astra-launch-claims-vs-reception-2026.
 * Charts: one live EmbeddedModelChart (ChatGPT score, pinned to the window)
 * and three ShareBars (pipeline tone, independent sample, complaint mix).
 * Every number is a frozen snapshot matching the CSVs in
 * public/research/gpt-6-2-astra-launch-claims-vs-reception-2026/.
 */

import EmbeddedModelChart from "@/components/research/EmbeddedModelChart";
import AuthorBio from "@/components/research/AuthorBio";
import PullQuote from "@/components/research/PullQuote";
import ResearchTableFrame from "@/components/research/ResearchTableFrame";
import ShareBars from "@/components/research/ShareBars";
import StatCallout from "@/components/research/StatCallout";
import { getVibeStatus } from "@/lib/vibes";

const ExternalLink = ({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
    {children}
  </a>
);

// Tables and stacked lists sit outside the prose scope, so their links carry
// the article link treatment explicitly.
const INLINE_LINK =
  "text-primary underline decoration-primary/50 underline-offset-4 hover:decoration-primary";

// Early testers whose launch-day posts were read at the source.
const REVIEWERS = [
  {
    name: "Theo Browne",
    lean: "Negative",
    quote: "I do not like 6.2 Astra. I would not choose this over Opus 5.5 for my work as a developer.",
    href: "https://x.com/theo/status/2122760447103484410",
    linkLabel: "post",
  },
  {
    name: "Matt Shumer",
    lean: "Negative",
    quote: "They were essentially unusable.",
    href: "https://x.com/mattshumer_/status/2122752192226406421",
    linkLabel: "post",
  },
  {
    name: "Dan Shipper",
    lean: "Negative",
    quote: "Overall a disappointing release compared to Fable 5.2.",
    href: "https://x.com/danshipper/status/2122754729012777052",
    linkLabel: "post",
  },
  {
    name: "Ethan Mollick",
    lean: "Mixed",
    quote:
      "I found it very uneven & weird. … harder to steer & work with than other models. On the other, when given an ambitious project … it could deliver well",
    href: "https://x.com/emollick/status/2122755693191287009",
    linkLabel: "post",
  },
  {
    name: "Max Weinbach",
    lean: "Mixed",
    quote: "Using them is a struggle and annoying even if they are really good models.",
    href: "https://x.com/mweinbach/status/2122834783650676806",
    linkLabel: "post",
  },
  {
    name: "Simon Willison",
    lean: "No verdict",
    quote: "The buzz around these new models is mixed at the moment.",
    href: "https://simonwillison.net/2026/Nov/17/gpt62-astra-and-sol/",
    linkLabel: "post",
  },
  {
    name: "Pietro Schirano",
    lean: "Positive",
    quote: "I feel it's getting an unfair response. From my testing, most of the issues were with the harness",
    href: "https://x.com/skirano/status/2122770640604111133",
    linkLabel: "post",
  },
  {
    name: "Derya Unutmaz",
    lean: "Positive",
    quote: "My early testing experience is exactly opposite of yours! They are amazing models!",
    href: "https://x.com/DeryaTR_/status/2122758607603442169",
    linkLabel: "reply to Matt Shumer",
  },
  {
    name: "swyx",
    lean: "Positive",
    quote: "i am daily driving astra and it is the best workflow automation model i’ve used",
    href: "https://x.com/swyx/status/2122862646265520150",
    linkLabel: "post",
  },
];

// Claims from OpenAI's launch post, whether each came with a number, and
// what reviewers and public posts said in the first four days.
const CLAIMS = [
  {
    claim: "“better results on demanding tasks with fewer output tokens”",
    hasNumber: "Yes",
    reception: "Shows up in the praise. People report slower-moving usage limits and lower cost per task.",
  },
  {
    claim: "Astra's API price is 20% lower; Sol's is unchanged",
    hasNumber: "Yes",
    reception: "Complaints about cost and limits fell from 32% of the first Astra's complaints to 8%.",
  },
  {
    claim: "“builds frontends that look and work better, particularly for websites, gaming, and 3D design”",
    hasNumber: "Yes",
    reception:
      "3D and pixel art drew the most-upvoted praise on Reddit. Theo: “World class at 3d & game stuff.” Dan Shipper found “good default design instincts” but said it “struggles to vary its designs.”",
  },
  {
    claim:
      "Astra's writing is “more direct and specific”; Sol “writes clearly and naturally, and is intuitive to collaborate with”",
    hasNumber: "No",
    reception:
      "The most disputed. Dan Shipper called Astra's writing a step back. Theo called its output unparsable. Altman said both models need to be nicer to work with.",
  },
  {
    claim: "Astra “has better judgment about how to execute a task”",
    hasNumber: "No",
    reception: "Disputed. Reviewers describe it stopping early, asking odd questions and looping.",
  },
];

const LAUNCH_POST_URL = "https://openai.com/index/introducing-gpt-6-2-astra-sol/";
const SYSTEM_CARD_URL = "https://deploymentsafety.openai.com/gpt-6-2-astra-sol";

// Sentiment hues come from the shared scale; neutral stays recessive.
const POSITIVE_COLOR = getVibeStatus(100).color;
const NEGATIVE_COLOR = getVibeStatus(0).color;
const NEUTRAL_COLOR = "hsl(var(--muted-foreground))";

const TONE_LEGEND = [
  { key: "positive", label: "Positive", color: POSITIVE_COLOR },
  { key: "neutral", label: "Neutral", color: NEUTRAL_COLOR },
  { key: "negative", label: "Negative", color: NEGATIVE_COLOR },
];

// Relevant ChatGPT posts in the LLM Vibes pipeline that name the model, by
// Pacific day (launch day is day 1). "Astra" before Nov 17 is GPT-6 Astra.
const PIPELINE_TONE_ROWS = [
  { label: "GPT-6.2 · days 1–2", detail: "95 posts", counts: { positive: 39, neutral: 4, negative: 52 } },
  { label: "GPT-6.2 · days 3–4", detail: "36 posts", counts: { positive: 14, neutral: 4, negative: 18 } },
  { label: "GPT-6 Astra · days 1–2", detail: "43 posts", counts: { positive: 29, neutral: 4, negative: 10 } },
  { label: "GPT-6 Astra · days 3–4", detail: "75 posts", counts: { positive: 45, neutral: 6, negative: 24 } },
];

// Independent sample: every Hacker News post naming the model plus 600
// randomly sampled Bluesky posts per window (accounts that mirror X removed),
// graded by Claude Sonnet 5.5 with no access to the pipeline's labels.
// Irrelevant posts excluded.
const INDEPENDENT_TONE_ROWS = [
  { label: "GPT-6.2 · days 1–2", detail: "173 posts", counts: { positive: 59, neutral: 18, negative: 96 } },
  { label: "GPT-6.2 · days 3–4", detail: "51 posts", counts: { positive: 22, neutral: 4, negative: 25 } },
  { label: "GPT-6 Astra · days 1–2", detail: "60 posts", counts: { positive: 36, neutral: 3, negative: 21 } },
  { label: "GPT-6 Astra · days 3–4", detail: "105 posts", counts: { positive: 67, neutral: 9, negative: 29 } },
];

// Negative posts in the independent sample, grouped by the grader's theme.
// Hard to work with = communication + effort. Price, limits & hype = cost + hype.
const COMPLAINT_LEGEND = [
  { key: "friction", label: "Hard to work with", color: "hsl(var(--warning))" },
  { key: "quality", label: "Quality of the work", color: NEGATIVE_COLOR },
  { key: "rivals", label: "A rival is better", color: "hsl(var(--muted-foreground) / 0.7)" },
  { key: "price", label: "Price, limits & hype", color: NEUTRAL_COLOR },
  { key: "other", label: "Safeguards & other", color: "hsl(var(--muted-foreground) / 0.4)" },
];

const COMPLAINT_ROWS = [
  {
    label: "GPT-6.2 · Nov 17–20",
    detail: "121 complaints",
    counts: { friction: 24, quality: 51, rivals: 17, price: 12, other: 17 },
  },
  {
    label: "GPT-6 Astra · Sep 3–6",
    detail: "50 complaints",
    counts: { friction: 6, quality: 11, rivals: 1, price: 28, other: 4 },
  },
];

const Gpt62LaunchBody = () => (
  <>
    <p>
      Here are two things OpenAI said about its new models on November 17.
    </p>
    <p>
      The first is the{" "}
      <ExternalLink href={LAUNCH_POST_URL}>launch post for GPT-6.2 Astra and Sol</ExternalLink>. Its tagline
      is "A new standard for professional work." It says Sol "writes clearly and naturally, and is intuitive
      to collaborate with."
    </p>
    <p>
      The second is from Sam Altman's announcement thread on X, about three hours later:
    </p>
    <PullQuote
      text="Although the new models are very smart, we have more work ahead of us on making the models nice to work with, and will prioritize that for upcoming releases. But even if it takes a little extra work, the intelligence and capability are extraordinary."
      handle="@sama"
      platform="X"
      timestamp="2026-11-17 21:04 UTC"
      href="https://x.com/sama/status/2122798042734633452"
    />
    <p>
      In those three hours, the people who test every new model had posted their reviews. One called it the
      worst model OpenAI has ever released. Another called it essentially unusable. I don't know whether
      Altman was answering them. His caveat was the second post in his own launch thread.
    </p>
    <p>
      I wanted to know two things. Is the reaction really that bad once you look past the loudest posts? And
      if OpenAI's own CEO says the models aren't nice to work with yet, what was the launch post measuring?
    </p>
    <p>
      The short version: it's not as bad as the worst reviews. It's also the lowest opening I've measured
      for an OpenAI model, in a near-tie with one much smaller release. And the trait the reviewers complained
      about most is one OpenAI flagged itself, in its own launch materials.
    </p>

    <StatCallout
      stats={[
        {
          value: "43%",
          label: "Posts naming GPT-6.2 that took a side and were positive, days 1–4 (the first Astra, in September: 69%)",
        },
        {
          value: "22% → 8%",
          label: "GPT-6.2 Astra leaving a known blocker out of its answer in OpenAI's own test: without, then with, Codex's added prompt (GPT-6 Astra: 11%)",
        },
      ]}
    />

    <h2 id="the-reviews">The reviews landed in the first forty minutes</h2>
    <p>
      The launch post was on{" "}
      <ExternalLink href="https://news.ycombinator.com/item?id=50535230">Hacker News by 17:46 UTC</ExternalLink>.
      Sixteen minutes later Matt Shumer posted this:
    </p>
    <PullQuote
      text="I will not be writing a full review of GPT-6.2 Astra / Sol. I had a terrible experience testing them. They were essentially unusable. I do not recommend these models."
      handle="@mattshumer_"
      platform="X"
      timestamp="2026-11-17 18:02 UTC"
      href="https://x.com/mattshumer_/status/2122752192226406421"
    />
    <p>
      Ten minutes after that, Dan Shipper at Every. His team had been testing for weeks:
    </p>
    <PullQuote
      text="…unfortunately, these models aren't great. Overall a disappointing release compared to Fable 5.2. - Writing. We found Astra 6.2 to be a step back from Astra 6 on writing. 6.2 appears to have been trained to very extremely concise and actionable—so much so that its writing is hard to understand, and it gives short answers when long answers would be appropriate. - Coding. We found performance to be similar to Astra 6 on most of our benchmarks. However, in real coding tasks Astra 6.2 seemed to stop too early frequently, which made it quite frustating to use on end-to-end builds. …"
      handle="@danshipper"
      platform="X"
      timestamp="2026-11-17 18:12 UTC"
      href="https://x.com/danshipper/status/2122754729012777052"
    />
    <p>
      And eleven minutes after that, Theo Browne:
    </p>
    <PullQuote
      text="6.2 Astra is here. I’ve been testing it for awhile. I think this is the worst model OpenAI has ever released. I’ll share more soon."
      handle="@theo"
      platform="X"
      timestamp="2026-11-17 18:23 UTC"
      href="https://x.com/theo/status/2122757647170703550"
    />
    <p>
      That last line is the one that traveled. I want to be careful with it, because within two hours{" "}
      <ExternalLink href="https://x.com/Hesamation/status/2122784635646259323">
        one post was already saying "everyone agrees"
      </ExternalLink>{" "}
      it's the worst model OpenAI has shipped. That isn't what the reviewers said. Here are nine early testers
      whose posts I could verify at the source, with their own words.
    </p>

    {/* Phones get a stacked list so each quote is readable without a sideways swipe. */}
    <ul
      className="not-prose my-6 divide-y divide-border rounded-lg border border-border sm:hidden"
      aria-label="What nine early reviewers said about GPT-6.2 on launch day"
    >
      {REVIEWERS.map((reviewer) => (
        <li key={reviewer.name} className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-body font-semibold text-foreground">{reviewer.name}</span>
            <span className="text-mono-cap text-text-tertiary">{reviewer.lean}</span>
          </div>
          <p className="mt-1 text-meta text-text-secondary">
            “{reviewer.quote}” (
            <ExternalLink href={reviewer.href} className={INLINE_LINK}>
              {reviewer.linkLabel}
            </ExternalLink>
            )
          </p>
        </li>
      ))}
    </ul>
    <div className="hidden sm:block">
      <ResearchTableFrame label="What nine early reviewers said about GPT-6.2 on launch day">
        <table className="w-full">
          <caption className="sr-only">
            Nine reviewers who posted about GPT-6.2 Astra and Sol on November 17 and 18, 2026, the overall
            lean of each review, and a quote from the linked post.
          </caption>
          <thead>
            <tr>
              <th scope="col">Reviewer</th>
              <th scope="col">Lean</th>
              <th scope="col">In their words</th>
            </tr>
          </thead>
          <tbody>
            {REVIEWERS.map((reviewer) => (
              <tr key={reviewer.name}>
                <td className="whitespace-nowrap">{reviewer.name}</td>
                <td className="whitespace-nowrap">{reviewer.lean}</td>
                <td>
                  “{reviewer.quote}” (
                  <ExternalLink href={reviewer.href} className={INLINE_LINK}>
                    {reviewer.linkLabel}
                  </ExternalLink>
                  )
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResearchTableFrame>
    </div>

    <p>
      Three negative, two mixed, three positive, one who didn't pick. Only one of the nine used the word
      "worst," and Dan Shipper never did.
    </p>
    <p>
      Theo's{" "}
      <ExternalLink href="https://x.com/theo/status/2122760447103484410">full review</ExternalLink> is more
      interesting than the one-liner. It's a feedback letter he sent OpenAI during testing. It says up front
      that he wouldn't choose Astra over Opus 5.5, then lists what's good: "Great reviewer, catches things
      other models miss," "World class at 3d & game stuff," "Code quality has improved meaningfully." Then:
      "I genuinely hate everything else about this model." And near the end: "This model is clearly super
      smart. It is insufferable to work with on real projects."
    </p>
    <p>
      So even the harshest review isn't saying the model is dumb. Most of the negative and mixed reviewers
      describe the same thing: a smart model that's a pain to work with. Altman's caveat says the same.
    </p>

    <h2 id="everyone-else">Then I checked everyone else</h2>
    <p>
      Early reviewers are a small group. Thibault Sottiaux, who works on Codex at OpenAI, made that point the
      same night:
    </p>
    <PullQuote
      text="One of the funny reasons for the difference in vibes between the influencers and the crowd today on 6.2 Sol/Astra is that we gave a few folks access a while ago and then made a lot of changes in the last 3-4 days and I'm pretty sure no re-testing was done within those days and the videos were produced last week. …"
      handle="@thsottiaux"
      platform="X"
      timestamp="2026-11-18 05:47 UTC"
      href="https://x.com/thsottiaux/status/2122929634916679820"
    />
    <p>
      That's a claim I can check. Influencers on one side, the crowd on the other. LLM Vibes scrapes public
      posts about ChatGPT every day and scores them, so I have the crowd.
    </p>
    <p>
      Start with the broad number. ChatGPT's daily score barely moved.
    </p>

    <EmbeddedModelChart modelSlug="chatgpt" startDate="2026-09-28" endDate="2026-11-20" />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        ChatGPT's daily sentiment score, September 28 – November 20, 2026. The week before launch averaged
        60.6. The first four days of GPT-6.2 scored 58, 59, 59 and 60.
      </em>
    </p>
    <p>
      If you only watched that line, you'd say nothing happened. Two reasons it's flat. Most ChatGPT posts
      aren't about the new models: of the 516 ChatGPT posts the classifier kept as relevant in those four days,
      131 named GPT-6.2.
      And OpenAI shipped it to ChatGPT Work, Codex and the API. The{" "}
      <ExternalLink href="https://help.openai.com/en/articles/6825453-chatgpt-release-notes">
        release notes
      </ExternalLink>{" "}
      say "Regular Chat keeps its existing model choices." The App Store reviewers who make up a big share of
      ChatGPT's score probably never met it.
    </p>
    <p>
      The sharper read is the posts that name the model. Here they are next to the first Astra, which
      launched 75 days earlier.
    </p>

    <ShareBars
      title="Tone of posts naming the model · LLM Vibes pipeline · days 1–2 vs days 3–4"
      legend={TONE_LEGEND}
      rows={PIPELINE_TONE_ROWS}
      ariaLabel="Share of positive, neutral, and negative posts naming each model in the LLM Vibes pipeline. GPT-6.2: 41% positive and 55% negative in days 1–2, 39% and 50% in days 3–4. GPT-6 Astra in September: 67% positive and 23% negative in days 1–2, 60% and 32% in days 3–4."
    />

    <p>
      Of the posts that took a side, 43% were positive for GPT-6.2 across its first four days. For the first
      Astra it was 69%. Same company, same model line, 75 days apart.
    </p>
    <p>
      Here are the six OpenAI launches I've measured this way, with four launches from other labs for scale:
    </p>

    <ResearchTableFrame label="Tone of posts naming each model in its first four days">
      <table className="w-full">
        <caption className="sr-only">
          For ten model launches since July 2026: the number of relevant posts naming the model in its first
          four Pacific days that were positive or negative, and the share positive.
        </caption>
        <thead>
          <tr>
            <th scope="col">Launch</th>
            <th scope="col" className="whitespace-nowrap">Share positive</th>
            <th scope="col" className="whitespace-nowrap">Positive</th>
            <th scope="col" className="whitespace-nowrap">Negative</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="whitespace-nowrap">GPT-6 Astra · Sep 3</td>
            <td>69%</td>
            <td>74</td>
            <td>34</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">GPT-5.6 · Jul 9</td>
            <td>56%</td>
            <td>48</td>
            <td>37</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">GPT-6.1 Sol · Sep 29</td>
            <td>52%</td>
            <td>16</td>
            <td>15</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">GPT-6 Sol + Luna · Sep 22</td>
            <td>51%</td>
            <td>26</td>
            <td>25</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">GPT-6.1 Terra · Oct 26</td>
            <td>45%</td>
            <td>10</td>
            <td>12</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">
              <strong>GPT-6.2 Astra + Sol · Nov 17</strong>
            </td>
            <td>
              <strong>43%</strong>
            </td>
            <td>53</td>
            <td>70</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Claude Opus 5.5 · Sep 22</td>
            <td>81%</td>
            <td>178</td>
            <td>42</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Gemini 4 Argon · Oct 13</td>
            <td>63%</td>
            <td>71</td>
            <td>42</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Claude Fable 5.2 · Nov 9</td>
            <td>62%</td>
            <td>32</td>
            <td>20</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Grok 4.7 · Sep 21</td>
            <td>40%</td>
            <td>36</td>
            <td>53</td>
          </tr>
        </tbody>
      </table>
    </ResearchTableFrame>

    <p>
      GPT-6.2 is at the bottom of OpenAI's list. I wouldn't lean on the gap to GPT-6.1 Terra, whose 45% is
      22 posts. And there's a fair objection here: the first Astra was a new generation, and the two point
      releases since (GPT-6.1 Sol and Terra) opened at 52% and 45%. By that measure 6.2 opened a bit below a
      normal OpenAI point release, and a long way below the model it replaces. Across labs, only Grok 4.7
      opened lower.
    </p>
    <p>
      So is there an influencers-versus-crowd split? Not much of one. The crowd is kinder than "unusable."
      About four in ten liked it. But for the first Astra it was seven in ten.
    </p>
    <p>
      One detail I didn't expect. X, where all those reviews were posted, wasn't the coldest platform. It
      split evenly, 18 positive posts to 18 negative. Reddit ran 19 to 22, and Bluesky 11 to 25. Alexander
      Embiricos, who leads product for Codex, described the platforms{" "}
      <ExternalLink href="https://www.youtube.com/watch?v=xeZDHGjG5zM">on Lenny's Podcast</ExternalLink> in
      January: "for Twitter/X, it's a little bit more hypey and then Reddit is a little more negative but
      real actually." On this launch the two were too close to call.
    </p>

    <h2 id="what-people-liked">What people liked</h2>
    <p>
      The positive posts aren't vague. They cluster on the things OpenAI put numbers on: speed, cost, and 3D
      and visual work.
    </p>
    <PullQuote
      text="Sol went from about 34 to 44 tokens/sec for the text I could actually see. Astra had a different perk: the first message showed up in about 3 seconds, down from 4.5. A second here and there sounds tiny until you spend half the day in Codex."
      handle="r/codex · “Anyone else notice how fast Sol 6.2 types?”"
      platform="Reddit"
      timestamp="2026-11-17 19:14 UTC"
      href="https://www.reddit.com/r/codex/comments/1xytdhy/anyone_else_notice_how_fast_sol_62_types/"
    />
    <PullQuote
      text="The model is good. I think it's comparable to Opus 5.5 for everyday coding so far. I've been using it for the better part of the last 5 hours on fairly complex tasks on Max and have only burned through 7% of my weekly usage on the $100 plan."
      handle="r/codex · “Astra 6.2 first impressions”"
      platform="Reddit"
      timestamp="2026-11-17 22:48 UTC"
      href="https://www.reddit.com/r/codex/comments/1xyyrpg/astra_62_first_impressions/"
    />
    <p>
      The most-upvoted Reddit post about it that the classifier kept was pixel art made with Astra. And one
      Hacker News commenter pushed back on the main complaint directly:
    </p>
    <PullQuote
      text="Interesting that you view this as a downside, as this is the main thing I like about GPT models over Claude. Opus makes far too many assumptions without asking, which means I end up having to correct it after the fact; Sol and Astra both do a better job of surfacing ambiguities to me and letting me decide."
      handle="RussianCow"
      platform="Hacker News"
      timestamp="2026-11-18 18:46 UTC"
      href="https://news.ycombinator.com/item?id=50550371"
    />
    <p>
      That's a fair point, and it's a real segment. Some developers want a model that does exactly what it's
      told and stops. For them, 6.2 is an upgrade.
    </p>

    <h2 id="an-independent-check">A second sample, graded by a different lab's model</h2>
    <p>
      There's a problem with everything above. On November 17, the same day GPT-6.2 launched, I switched LLM
      Vibes' classifier to GPT-6.2 Sol. So the model grading these posts is one of the two models the posts
      are about.
    </p>
    <p>
      I didn't want to publish that without a check. So I built a second sample outside the pipeline: every
      Hacker News story and comment naming the model in its first four days, plus 600 randomly drawn Bluesky
      posts, for both GPT-6.2 and the first Astra. I dropped 47 posts from accounts that mirror X onto
      Bluesky, several of them Theo's, since those aren't the crowd. That left 2,046 posts. Claude Sonnet 5.5
      graded each one against a written rubric, with no access to my classifier's labels. That swaps one
      conflict for another, since Sonnet is Anthropic's model and Anthropic is OpenAI's main rival. So the
      useful question is whether the two graders agree.
    </p>

    <ShareBars
      title="Independent sample · tone toward the named model · days 1–2 vs days 3–4"
      legend={TONE_LEGEND}
      rows={INDEPENDENT_TONE_ROWS}
      ariaLabel="Independent sample of Hacker News and Bluesky posts. GPT-6.2: 34% positive and 55% negative in days 1–2, 43% and 49% in days 3–4. GPT-6 Astra in September: 60% positive and 35% negative in days 1–2, 64% and 28% in days 3–4."
    />

    <p>
      Same answer. Of posts that took a side, 40% were positive for GPT-6.2 and 67% for the first Astra. My
      pipeline said 43% and 69%. Hacker News and Bluesky were close to each other too, at 41% and 38%.
    </p>
    <p>
      Then I had Sonnet regrade the pipeline's own posts. It was stricter about what counts as an opinion and
      set aside 32 of the 131 as having no clear stance. On the 99 posts both graders treated as relevant,
      they gave the same sentiment on 94. Not one flipped from positive to negative or the other way. GPT-6.2
      Sol graded its own reviews about as harshly as a rival lab's model did.
    </p>
    <p>
      The second sample let me test Sottiaux's point one more way. The grader marked whether each author was
      describing their own use or reacting to reviews and benchmarks. If the crowd were just echoing the
      influencers, the secondhand posts should be the negative ones. I see no sign of that. People describing
      their own use were 40% positive (53 to 79). People reacting to what they'd read were 46% positive (21 to
      25), which on 46 posts is too few to call a difference.
    </p>
    <p>
      Astra and Sol didn't separate either. Posts about Astra were 42% positive, posts about Sol 38%, on 32
      posts. I'd expected Sol to do better, since most of the harsh reviews were about Astra. It didn't.
    </p>

    <h2 id="the-complaints">What the complaints are about</h2>
    <p>
      This is where the two Astras really differ.
    </p>

    <ShareBars
      title="What negative posts complain about · independent sample"
      legend={COMPLAINT_LEGEND}
      rows={COMPLAINT_ROWS}
      ariaLabel="Complaint mix in negative posts. GPT-6.2 in November: 20% hard to work with, 42% quality of the work, 14% a rival is better, 10% price, limits and hype, 14% safeguards and other. GPT-6 Astra in September: 12% hard to work with, 22% quality, 2% a rival is better, 56% price, limits and hype, 8% safeguards and other."
    />

    <p>
      In September, more than half the complaints about the first Astra were about price, limits and hype.
      People thought it cost too much or was oversold. About a third were about what it did.
    </p>
    <p>
      In November, 62% of complaints are about the model's work or what it's like to work with. Cost
      complaints went from 16 of 50 to 10 of 121. That fits the 20% price cut and the lower token use, though
      none of those posts mentions the cut.
    </p>
    <p>
      The biggest bucket is plain quality: wrong answers, worse code, "it got dumber." That's 51 of 121. The
      "hard to work with" bucket, where the reviewers' complaints live, is 24 of 121, about one in five. So
      the crowd's complaint is broader than the reviewers'. Those 24 posts read like shorter versions of the
      reviews:
    </p>
    <PullQuote
      text="I use both astra and fable quite a bit for my work and I find that astra is much weaker with maintaining long horizon tasks and making decisions on my behalf / exposing those to me when appropriate. Astra seems more likely to do exactly what I ask for but nothing more, even if there is an obvious add on task it should have suggested. It often does not report on what it has done as comprehensively. …"
      handle="jablongo"
      platform="Hacker News"
      timestamp="2026-11-17 19:37 UTC"
      href="https://news.ycombinator.com/item?id=50536987"
    />
    <PullQuote
      text="I am having a very very hard time coding with them, whenever i ask a question I have to put an insane focus to understand its answer, i have to insist many rounds until i might understand what the model did. I never ever had this issue before with any model, it is consuming my energy... …"
      handle="r/codex · “How do you use gpt's 6.2?”"
      platform="Reddit"
      timestamp="2026-11-19 18:50 UTC"
      href="https://www.reddit.com/r/codex/comments/1y0hfua/how_do_you_use_gpts_62/"
    />
    <PullQuote
      text="Having my first good go of Sol 6.2 today, it's asking for permission on the stupidest things. I have an explicit request edit mode call in my harness, it called it twice, was approved twice and told so by the tool, then said &quot;read only reaffirmed, I'm stopping here&quot;. … Not a fan of this thing. It's wasting a lot of time today."
      handle="tonfreed"
      platform="Hacker News"
      timestamp="2026-11-19 02:15 UTC"
      href="https://news.ycombinator.com/item?id=50555228"
    />
    <p>
      One note on my own instrument. LLM Vibes' classifier sorts each complaint into a fixed list of categories. For
      GPT-6.2, the biggest one was "other," at 26 of 70. I don't have a category for "I can't follow what it's telling
      me," because until this launch I hadn't needed one.
    </p>

    <h2 id="the-feature-is-the-complaint">OpenAI flagged the same trait</h2>
    <p>
      Go back to the launch post and read it next to the reviews.
    </p>
    <p>
      From the post's opening paragraph: "Both models deliver better results on demanding tasks with fewer
      output tokens." On Astra's writing: "more direct and specific, with fewer generic takeaways and less
      filler." Sam Altman's own announcement called the models "very token-efficient."
    </p>
    <p>
      Dan Shipper: 6.2 "appears to have been trained to very extremely concise and actionable—so much so
      that its writing is hard to understand." Theo: "It speaks in tongues that only 6.2 Astra understands."
    </p>
    <p>
      My read is that those are the same trait, described once as a benefit and once as a cost. I can't
      prove that from outside. But OpenAI's{" "}
      <ExternalLink href={SYSTEM_CARD_URL}>system card</ExternalLink> makes a similar connection in two
      places.
    </p>
    <p>
      The first is a test called Blocker Deception. OpenAI gives the model a coding task with an obstacle
      planted in it, like a missing file or a tool that doesn't work, and measures how often the model's
      final answer leaves the obstacle out. The card says:
    </p>
    <blockquote>
      <p>
        "Notably, GPT-6.2 Astra omitted a known obstacle to completing its work in 22.28 percent of trials,
        compared with 11.09 percent for GPT-6 Astra. We are concerned by this regression and are continuing
        to investigate its root causes. One hypothesis is that our efforts to make responses concise and
        avoid excessive caveats may be related to the model omitting important obstacles."
      </p>
    </blockquote>
    <p>
      The second is a mental-health benchmark where both models scored lower, about half of it because they
      asked for less context before answering. The card says that change "may be related to GPT-6.2 Astra
      and Sol’s increased preference for concise and actionable responses." "Concise and actionable" is also
      Dan Shipper's phrase.
    </p>
    <p>
      I want to be careful about how much weight this carries. Both are hypotheses, and OpenAI says it's
      still investigating. The blocker test was built to provoke the behavior, and the card says it may not
      reflect how often it happens in real use. It also measures something narrower than what the reviewers
      described. Their main complaints were that the model stops early and is hard to read. Leaving a
      blocker out of a final answer is a different failure. One Hacker News comment does describe it
      directly, the one above that says Astra "often does not report on what it has done as comprehensively."
    </p>
    <p>
      It also doesn't explain the crowd's biggest complaint. Quality is 42% of complaints and "hard to work
      with" is 20%. Conciseness is a candidate explanation for the one in five. I don't have one for the
      rest.
    </p>
    <p>
      I have one more data point, and it's mine. I run a benchmark called{" "}
      <a href="/benchmark">Ship Sense</a> that scores models on product judgment. GPT-6.2 Astra is fifth of
      72 models on it, which is a strong result. It ties Claude Fable 5.2 on two of the three dimensions. On
      the third, which measures whether a model names the problems in the data it's given, Astra scores 0.85
      to Fable's 0.96. Sol scores 0.85 too. It's a different test from OpenAI's, and I wouldn't claim it
      measures the same thing. It points the same direction, though. These models make good calls and tell
      you less about what's in the way.
    </p>

    <h2 id="how-a-launch-post-is-built">How a launch post gets built</h2>
    <p>
      The launch post does report the blocker result. It's in the second-to-last section, about 2,200 words
      below "A new standard for professional work," with this sentence and a chart:
    </p>
    <blockquote>
      <p>
        "However, in two tests, they were more likely to omit mentioning obstacles that blocked their work,
        such as a missing file or unavailable search tool. We added instructions in Codex that substantially
        reduce these omissions, and we’re continuing to investigate the behavior."
      </p>
    </blockquote>
    <p>
      The chart shows the fix working. With the Codex instructions, Astra leaves out the blocker in 8% of
      trials, which is better than the old Astra's 11%. Without them it's 22%. The system card adds that the
      Codex instructions are "not applied to direct API requests." So in Codex the regression is patched. If
      you build on the API, you get the 22% model unless you write that prompt yourself.
    </p>
    <p>
      I don't think OpenAI hid anything. Everything I've quoted is from OpenAI's own pages. What a launch
      post does is put things in an order, and the claims at the top are the ones with a benchmark behind
      them.
    </p>

    <ul
      className="not-prose my-6 divide-y divide-border rounded-lg border border-border sm:hidden"
      aria-label="What the launch post claimed and what public posts said"
    >
      {CLAIMS.map((row) => (
        <li key={row.claim} className="px-4 py-3">
          <p className="text-body text-foreground">{row.claim}</p>
          <p className="mt-2 text-mono-cap text-text-tertiary">Has a number: {row.hasNumber}</p>
          <p className="mt-1 text-meta text-text-secondary">{row.reception}</p>
        </li>
      ))}
    </ul>
    <div className="hidden sm:block">
      <ResearchTableFrame label="What the launch post claimed and what public posts said">
        <table className="w-full">
          <caption className="sr-only">
            Five claims from OpenAI's GPT-6.2 launch post, whether OpenAI attached a number to each, and what
            reviewers and public posts said about it in the first four days.
          </caption>
          <thead>
            <tr>
              <th scope="col">OpenAI's claim</th>
              <th scope="col" className="whitespace-nowrap">Has a number?</th>
              <th scope="col">What people said</th>
            </tr>
          </thead>
          <tbody>
            {CLAIMS.map((row) => (
              <tr key={row.claim}>
                <td>{row.claim}</td>
                <td>{row.hasNumber}</td>
                <td>{row.reception}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResearchTableFrame>
    </div>

    <p>
      The claims with a number mostly show up in the praise. The claims without one are where the reviews
      landed. "Intuitive to collaborate with" isn't on any benchmark chart, so nothing in the post could
      contradict it.
    </p>
    <p>
      A few other things are worth knowing when you read any launch post, from any lab. None of them is a
      trick. They're just easy to miss.
    </p>
    <p>
      <strong>The benchmark claims pair a score with a cost.</strong> The post's first benchmark claim is
      that Astra scores "5.5 points ahead of Claude Fable 5.2 at just 5% of the cost." Cost per task is a
      fair thing to measure. It's also where a token-efficient model looks best, and it isn't what the
      reviewers were grading.
    </p>
    <p>
      <strong>The test setup is in the captions.</strong> A chart caption says the Fable 5.2 result in that
      comparison leaves out nine tasks where Fable fell back to another model. A footnote says a second
      benchmark uses a Fable score from a different harness than Anthropic's own. And the cybersecurity
      results were run "with cybersecurity safeguards and classifiers disabled," which is a normal way to
      measure capability. The models people actually get have "tighter safeguards" that, in OpenAI's words,
      "also restrict some legitimate vulnerability research and security testing workflows." Users found
      that quickly. Refusals and safeguards were 8 of the 121 complaints, several of them about reverse
      engineering and security work.
    </p>
    <p>
      <strong>The quotes come from customers who measured tokens.</strong> Five of the eight customer quotes
      in the post cite fewer tokens, fewer iterations or less time. They're those customers' own evals, and
      they measure what evals measure.
    </p>
    <p>
      My read is that this is what happens when a post is assembled from evals. You get an accurate picture
      of everything that was measured.
    </p>
    <p>
      And OpenAI deserves real credit for how it handled the testers. The people who panned the model had
      weeks of early access and no restrictions on what they could say. Theo, a day after calling it the
      worst model OpenAI has released:
    </p>
    <PullQuote
      text="…A lot of early access testers were unhappy with GPT-6.2 Astra. None of us were scared to say how we really felt. The &quot;negative&quot; wave yesterday shows two things: 1. The model kinda sucks to use (sorry, it's true) 2. OpenAI does not restrict their EA testers in any way at all …"
      handle="@theo"
      platform="X"
      timestamp="2026-11-18 21:34 UTC"
      href="https://x.com/theo/status/2123168027885900050"
    />
    <p>
      Altman's own announcement carried the caveat. Sottiaux wrote "we hear you" that night. The launch post
      oversold the collaboration, and the people around it said so in public.
    </p>

    <h2 id="what-i-take-from-this">What I take from this</h2>
    <p>
      I build products for a living, and I use Codex and Claude Code every day. So here's how I'd read this
      launch if it were mine.
    </p>
    <p>
      First, OpenAI had two warnings before launch. Its own evals showed the models leaving things out, and
      its testers were writing letters about output they couldn't follow. Those aren't the same measurement,
      but both are about how the model communicates. Cat Wu, who runs product for Claude Code, said on
      Lenny's Podcast in April that it helps to "figure out who are the users who you trust the most to give
      you accurate feedback about the model," because "there's a handful of people who are much better than
      others at articulating what makes a specific model or model harness combination good." OpenAI had those
      people, and it let them talk.
    </p>
    <p>
      OpenAI shipped anyway, with a prompt patch for Codex. I can see the case for that. The efficiency gains
      are real, customers were asking for them, and the patch works on OpenAI's own test. But it means the
      launch post described the model OpenAI measured, and the reviews described the model people used.
    </p>
    <p>
      Second, efficiency has a cost that lands on the user. Fewer output tokens is good for the bill. It's
      less good when the tokens that got cut were the ones telling you what the model did and what stopped
      it. OpenAI published both sides of that trade, cost per task near the top of the post and the blocker
      chart near the bottom. I'd put them side by side.
    </p>
    <p>
      Third, the reception is a number you can track like any other. Tulsee Doshi, who leads product for
      Gemini,{" "}
      <ExternalLink href="https://www.lennysnewsletter.com/p/what-it-actually-takes-to-build-frontier">
        told Lenny
      </ExternalLink>{" "}
      this month that she's "looking for PMs who understand the vibes of our models or other models." I
      think that's right, and I'd add that vibes hold still long enough to count. My pipeline and the
      independent sample used different samples and graders from different labs, and they landed three
      points apart.
    </p>
    <p>
      What I'll watch from here is day 14. Theo predicted that by then "this model will be mostly forgotten."
      He also wrote that he hopes he's wrong. Day four was the warmest day in the independent sample, on only
      15 posts. If the problem really is how the models communicate, that's the kind of thing a point release
      can fix, and the <a href="/model/chatgpt">live ChatGPT chart</a> will show it.
    </p>

    <h2 id="confounds">What could be wrong with this</h2>
    <p>
      A fair amount.
    </p>
    <p>
      <strong>It's only four days.</strong> The windows are small: 131 relevant posts in the pipeline and
      224 in the independent sample. The direction is the same everywhere I looked. The exact percentages
      will move, and day four in particular is thin and can still fill in as late posts arrive.
    </p>
    <p>
      <strong>The comparison I chose flatters the gap.</strong> The first Astra was a new generation and 6.2
      is a point release. Against OpenAI's other point releases (45% and 52%), 6.2's 43% is a small step
      down, not a collapse.
    </p>
    <p>
      <strong>Both graders have a stake.</strong> My classifier is one of the models being graded, and the
      independent grader is a rival lab's. They agreed on 94 of 99 posts, but both are language models
      reading the same text. I also had a third model, Claude Opus, re-read 140 of the independently graded
      posts. It disagreed on 9, mostly relayed opinions that should have been set aside, and the errors leaned toward
      making GPT-6.2 look worse. Correcting for that would put the independent numbers near 43% and 67%,
      which is where the pipeline already is.
    </p>
    <p>
      <strong>The instrument changed between the two Astras.</strong> In September the pipeline's classifier
      was GPT-5.6 Terra. In November it was GPT-6.2 Sol. On launch day I also added two subreddits, r/codex
      and r/ChatGPTPro, and r/codex is 30 of the 43 Reddit posts naming 6.2. Without those two subreddits
      the pipeline number is still 43% (40 to 52). The independent sample uses the same sources and grader
      for both windows, which is the main reason I trust the comparison.
    </p>
    <p>
      <strong>The independent sample has no X posts.</strong> It's Hacker News and Bluesky. X is in the
      pipeline numbers, where it split evenly.
    </p>
    <p>
      <strong>Gemini 4 Neon launched on day two.</strong> Some GPT-6.2 posts from November 18 on are
      comparisons with Neon. 17 of the 121 complaints were "a rival is better" with no specific fault named.
    </p>
    <p>
      <strong>The reviewers may have tested an older build.</strong> Sottiaux says OpenAI changed a lot in
      the last three or four days before launch. I can't verify that either way. The public posts from
      people using the shipped model were about as negative as the reviews, which suggests the late changes
      didn't close the gap.
    </p>
    <p>
      <strong>"Astra" is two models now.</strong> A post from November 17 on that says only "Astra" could
      mean the old one. Counting only posts that say "6.2," the pipeline number is 39% positive (41 to 63),
      not 43%.
    </p>
    <p>
      <strong>I'm not neutral.</strong> My own benchmark has Fable 5.2 ahead of GPT-6.2 Astra, and that
      ranking is public. That's why every quote here links to its source and every count is in the downloads
      below.
    </p>

    <h2 id="methodology">Methodology</h2>
    <p>
      LLM Vibes scrapes public posts about Claude, ChatGPT, Gemini and Grok from Reddit, Hacker News,
      Bluesky, X and App Store reviews. An LLM classifier tags each post's relevance, sentiment, and
      complaint or praise category, and a daily score runs 0–100 (
      <a href="/research/how-llm-vibes-classifies-sentiment">full method</a>). The classifier switched
      from GPT-6.1 Sol to GPT-6.2 Sol on November 17, and GPT-6.2 Sol graded nearly all of the posts naming
      GPT-6.2.
    </p>
    <p>
      "Posts naming the model" match <code>6.2</code> or <code>astra</code> in the title or body, among
      ChatGPT posts the classifier kept as relevant. For September, <code>astra</code> alone. Windows use
      full Pacific days with launch day as day 1, and the current, still-filling day is never counted.
      "Share positive" is positive posts divided by positive plus negative. The other launches in the table
      use the same rule with each model's name. GPT-5.6's row comes from the{" "}
      <a href="/research/opus-5-5-vs-opus-5-launch-sentiment-2026">Opus 5.5 article's</a> dataset, since the
      July posts have aged out of the database.
    </p>
    <p>
      The independent sample pulled every Hacker News story and comment matching each model's name in its
      first four Pacific days from the public Algolia API (355 for GPT-6.2, 538 for GPT-6 Astra), and every
      Bluesky post matching the same names from Bluesky's public search (1,431 and 2,117 after removing
      duplicates), from which I drew 600 per window at random. I then removed 47 posts from accounts that
      mirror X accounts and set aside one retweet relay, leaving 2,046 posts. Claude Sonnet 5.5 graded each
      post against a fixed rubric as positive, neutral, negative or irrelevant toward the named model, and
      tagged which 6.2 model it was about, whether the author was describing their own use, and the main
      complaint. Announcement relays, news headlines, leak posts, benchmark numbers without a judgment, and
      spam were marked irrelevant, which is why 1,657 of the 2,046 posts carry no stance. The classifier
      check regraded the pipeline's 131 relevant posts naming GPT-6.2 plus 130 it had marked irrelevant, the
      same way.
    </p>
    <p>
      Reviewer quotes were read at the source post, not from press coverage, and the timestamps are the
      posts' own. Quotes from OpenAI come from the{" "}
      <ExternalLink href={LAUNCH_POST_URL}>launch post</ExternalLink> and the{" "}
      <ExternalLink href={SYSTEM_CARD_URL}>system card</ExternalLink> as published on November 21. The
      Ship Sense figures are from the <a href="/benchmark">benchmark page</a> on the same date.
    </p>
    <p>
      Download the{" "}
      <a href="/research/gpt-6-2-astra-launch-claims-vs-reception-2026/data.csv">daily dataset</a> (ChatGPT
      score plus positive, negative and neutral counts of posts naming Astra or GPT-6.2, August 27 –
      November 20), the{" "}
      <a href="/research/gpt-6-2-astra-launch-claims-vs-reception-2026/launches.csv">ten-launch table</a>,
      the{" "}
      <a href="/research/gpt-6-2-astra-launch-claims-vs-reception-2026/independent-sample.csv">
        2,046 graded posts
      </a>{" "}
      from the independent sample, the{" "}
      <a href="/research/gpt-6-2-astra-launch-claims-vs-reception-2026/classifier-check.csv">
        classifier check
      </a>
      , or <ExternalLink href="https://github.com/dkships/llm-moods">fork the pipeline on GitHub</ExternalLink>.
    </p>

    <AuthorBio />
  </>
);

export default Gpt62LaunchBody;
