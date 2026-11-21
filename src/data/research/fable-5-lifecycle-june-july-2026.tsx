/**
 * Body component for /research/fable-5-lifecycle-june-july-2026.
 * Charts: live EmbeddedModelChart (Claude score, event bands from
 * vendor-events.ts), two static ArticleSeriesCharts (Fable mention share,
 * refusal-language share) with frozen snapshot data matching the CSV.
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

// Share of all model-classified rows in my corpus whose text mentions
// Fable/Mythos, 7-day trailing. Frozen snapshot; raw counts in the CSV.
const FABLE_SHARE_7D: { day: string; value: number | null }[] = [
  { day: "2026-06-01", value: 0.0 }, { day: "2026-06-02", value: 0.2 }, { day: "2026-06-03", value: 0.2 },
  { day: "2026-06-04", value: 0.2 }, { day: "2026-06-05", value: 0.2 }, { day: "2026-06-06", value: 0.3 },
  { day: "2026-06-07", value: 0.3 }, { day: "2026-06-08", value: 0.6 }, { day: "2026-06-09", value: 2.3 },
  { day: "2026-06-10", value: 6.3 }, { day: "2026-06-11", value: 9.6 }, { day: "2026-06-12", value: 11.7 },
  { day: "2026-06-13", value: 14.3 }, { day: "2026-06-14", value: 16.2 }, { day: "2026-06-15", value: 17.1 },
  { day: "2026-06-16", value: 16.0 }, { day: "2026-06-17", value: 12.9 }, { day: "2026-06-18", value: 9.7 },
  { day: "2026-06-19", value: 7.9 }, { day: "2026-06-20", value: 6.7 }, { day: "2026-06-21", value: 5.9 },
  { day: "2026-06-22", value: 5.5 }, { day: "2026-06-23", value: 6.0 }, { day: "2026-06-24", value: 7.4 },
  { day: "2026-06-25", value: 9.0 }, { day: "2026-06-26", value: 10.1 }, { day: "2026-06-27", value: 9.8 },
  { day: "2026-06-28", value: 10.7 }, { day: "2026-06-29", value: 12.0 }, { day: "2026-06-30", value: 11.8 },
  { day: "2026-07-01", value: 14.0 }, { day: "2026-07-02", value: 15.1 }, { day: "2026-07-03", value: 16.1 },
  { day: "2026-07-04", value: 18.1 }, { day: "2026-07-05", value: 20.2 }, { day: "2026-07-06", value: 20.7 },
  { day: "2026-07-07", value: 22.7 }, { day: "2026-07-08", value: 20.8 }, { day: "2026-07-09", value: 18.7 },
  { day: "2026-07-10", value: 16.9 }, { day: "2026-07-11", value: 16.7 }, { day: "2026-07-12", value: 16.7 },
  { day: "2026-07-13", value: 16.2 }, { day: "2026-07-14", value: 15.9 }, { day: "2026-07-15", value: 15.7 },
  { day: "2026-07-16", value: 16.2 },
];

// Share of Claude-classified posts whose text uses refusal/classifier language
// ("refused", "flagged", "false positive", "fallback to Opus", …), 7-day
// trailing. Text-pattern proxy, independent of my sentiment classifier.
const REFUSAL_SHARE_7D: { day: string; value: number | null }[] = [
  { day: "2026-06-01", value: 0.0 }, { day: "2026-06-02", value: 0.6 }, { day: "2026-06-03", value: 0.4 },
  { day: "2026-06-04", value: 0.7 }, { day: "2026-06-05", value: 0.5 }, { day: "2026-06-06", value: 0.7 },
  { day: "2026-06-07", value: 0.8 }, { day: "2026-06-08", value: 1.0 }, { day: "2026-06-09", value: 1.4 },
  { day: "2026-06-10", value: 2.8 }, { day: "2026-06-11", value: 3.1 }, { day: "2026-06-12", value: 3.4 },
  { day: "2026-06-13", value: 3.4 }, { day: "2026-06-14", value: 3.2 }, { day: "2026-06-15", value: 3.3 },
  { day: "2026-06-16", value: 2.8 }, { day: "2026-06-17", value: 1.6 }, { day: "2026-06-18", value: 1.0 },
  { day: "2026-06-19", value: 1.2 }, { day: "2026-06-20", value: 1.2 }, { day: "2026-06-21", value: 1.2 },
  { day: "2026-06-22", value: 1.0 }, { day: "2026-06-23", value: 1.0 }, { day: "2026-06-24", value: 0.7 },
  { day: "2026-06-25", value: 0.7 }, { day: "2026-06-26", value: 0.4 }, { day: "2026-06-27", value: 0.2 },
  { day: "2026-06-28", value: 0.2 }, { day: "2026-06-29", value: 0.4 }, { day: "2026-06-30", value: 0.6 },
  { day: "2026-07-01", value: 1.0 }, { day: "2026-07-02", value: 1.6 }, { day: "2026-07-03", value: 1.9 },
  { day: "2026-07-04", value: 2.2 }, { day: "2026-07-05", value: 2.5 }, { day: "2026-07-06", value: 2.7 },
  { day: "2026-07-07", value: 2.6 }, { day: "2026-07-08", value: 2.9 }, { day: "2026-07-09", value: 2.4 },
  { day: "2026-07-10", value: 2.4 }, { day: "2026-07-11", value: 2.4 }, { day: "2026-07-12", value: 2.3 },
  { day: "2026-07-13", value: 1.9 }, { day: "2026-07-14", value: 2.2 }, { day: "2026-07-15", value: 2.2 },
  { day: "2026-07-16", value: 2.4 },
];

const FableLifecycleBody = () => (
  <>
    <h2 id="five-weeks-six-events">Five weeks, six lifecycle events</h2>
    <p>
      Here's the finding I didn't expect. Fable's launch week (June 9–15) took 17.1% of all the AI-model
      chatter I track. Its <em>return</em> week (July 1–7) took 22.7%. The comeback outdrew the debut.
    </p>
    <p>
      Claude Fable 5 launched June 9. A US government export-control directive ordered it offline on June
      12, and it came back July 1 behind a stricter safety classifier. Paid-plan access was then extended
      twice, first to July 12 and then to July 19. On July 18 Anthropic announced that Fable 5 would be
      included in Max and Team Premium plans starting July 20. My scrapers classified posts about Claude
      every day of it, so the dataset shows what a governance event does to how people talk about a
      product.
    </p>

    <StatCallout
      stats={[
        { value: "22.7%", label: "Share of tracked chatter mentioning Fable, return week (Jul 1–7)" },
        { value: "19 days", label: "Suspended by government directive, Jun 12 – 30" },
      ]}
    />

    <ResearchTableFrame label="Fable 5 lifecycle timeline with LLM Vibes signals">
      <table className="w-full">
        <caption className="sr-only">
          Fable 5 lifecycle events June through July 2026 with the matching signal in LLM Vibes data.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="whitespace-nowrap">Date</th>
            <th scope="col">Event</th>
            <th scope="col">What the data shows</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="whitespace-nowrap">Jun 9</td>
            <td>
              <ExternalLink href="https://www.anthropic.com/news/claude-fable-5-mythos-5">
                Fable 5 launches
              </ExternalLink>
              , included free on paid plans
            </td>
            <td>Mention share 0.6% → 17.1% in a week; no score pop (50 on launch day)</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Jun 10</td>
            <td>First refusal complaints go wide</td>
            <td>
              Refusal-language share in Claude posts hits 8% raw — the highest single day in my dataset
            </td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Jun 12</td>
            <td>
              <ExternalLink href="https://news.ycombinator.com/item?id=48511072">
                US directive suspends Fable 5 and Mythos 5
              </ExternalLink>
            </td>
            <td>Claude score sags to 43.2 avg over Jun 13–18, vs 54.1 over the eight days before launch</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Jun 30</td>
            <td>
              <ExternalLink href="https://news.ycombinator.com/item?id=48740771">
                Export controls lifted
              </ExternalLink>
            </td>
            <td>Mention share already back to 12% on anticipation alone</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Jul 1</td>
            <td>
              <ExternalLink href="https://www.anthropic.com/news/redeploying-fable-5">
                Redeployed with retrained cybersecurity classifiers
              </ExternalLink>
            </td>
            <td>Claude's best stretch of the summer: score peaks at 65 on Jul 4</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Jul 7, Jul 12</td>
            <td>Paid-plan access extended to Jul 12, then Jul 19</td>
            <td>7-day mention share peaks at 22.7% on Jul 7; the daily share was 20.0% on Jul 7 and 20.9% on Jul 12</td>
          </tr>
          <tr>
            <td className="whitespace-nowrap">Jul 18, Jul 20</td>
            <td>
              <ExternalLink href="https://x.com/claudeai/status/2078302415804379218">
                Announced Jul 18: Fable 5 included in Max and Team Premium plans from Jul 20
              </ExternalLink>
              , at 50% of usage limits, no end date given
            </td>
            <td>After this article's Jul 16 data cutoff; the <a href="/model/claude">live chart</a> carries the marker</td>
          </tr>
        </tbody>
      </table>
    </ResearchTableFrame>

    <ArticleSeriesChart
      title="Fable · share of tracked AI chatter, 7-day trailing"
      data={FABLE_SHARE_7D}
      valueSuffix="%"
      ariaLabel="Share of all tracked AI-model chatter mentioning Fable or Mythos, 7-day trailing, June 1 to July 16 2026: near zero before June 9, 17% after launch, dipping to 5.5% mid-suspension, peaking at 22.7% on July 7, settling around 16%."
      events={[
        { startDay: "2026-06-09", color: "hsl(200 70% 60%)", title: "Launch" },
        { startDay: "2026-06-12", endDay: "2026-06-30", color: "hsl(0 60% 50%)", title: "Suspension" },
        { startDay: "2026-07-01", color: "hsl(260 60% 65%)", title: "Redeploy" },
      ]}
    />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Share of all model-classified posts in my corpus mentioning Fable or Mythos, 7-day trailing. Blue
        line: launch. Red band: the government suspension. Purple line: redeploy. Five weeks in, one post in
        six across four models' chatter still mentions this one model.
      </em>
    </p>

    <h2 id="the-score-arc">The score arc: friction at launch, a dip in the dark, a honeymoon on return</h2>
    <p>
      Claude's daily sentiment score tells a different story than the attention curve.
    </p>

    <EmbeddedModelChart modelSlug="claude" startDate="2026-06-01" endDate="2026-07-16" />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Claude's daily sentiment score, June 1 – July 16, 2026. The shaded band is the suspension; the launch,
        redeploy, and access-extension events are marked. Post volume roughly doubled from July 10 — that's
        my own pipeline expansion (see the confounds section), not organic growth.
      </em>
    </p>
    <p>
      There was no launch pop. Claude scored 50 on launch day and 47 the day after. The launch thread drew
      <ExternalLink href="https://news.ycombinator.com/item?id=48463808">
        2,626 points on Hacker News
      </ExternalLink>
      , but the day-one posts also carried classifier friction and a $10/$50-per-million price tag. I can't
      separate those causes from the score alone.
    </p>
    <p>
      The suspension shows up as a real dip: 43.2 average June 13–18, down 11 points from the 54.1 average
      over the eight days before launch, with June 13 (36) the single worst day. Then something odd: the
      score recovered to the low 50s by June 20, <em>while the model was still off</em>. My read is that
      with the model unavailable, the people who had been hitting refusals had nothing left to complain
      about. I haven't tested that.
    </p>
    <p>
      The redeploy came with Claude's best sentiment stretch of the summer: 59.1 average July 1–7, peaking
      at 65 on July 4. I can't tell how much of that was relief at the model's return and how much was the
      second free-access window.
    </p>

    <h2 id="the-classifier-tax">The classifier tax was there from day one</h2>
    <p>
      The redeploy story most coverage told — model comes back, new safety classifier frustrates users — is
      real, but the refusal-language series shows the same complaints starting at launch. I track a simple
      text proxy: the share of Claude posts using refusal language ("flagged," "refused," "false positive,"
      "fallback to Opus"). Baseline from mid-April through May: 1.1%.
    </p>

    <ArticleSeriesChart
      title="Claude · share of posts using refusal language, 7-day trailing"
      data={REFUSAL_SHARE_7D}
      valueSuffix="%"
      ariaLabel="Share of Claude posts using refusal or classifier language, 7-day trailing, June 1 to July 16 2026: about 0.5 to 1 percent baseline, peaking at 3.4 percent after the June 9 launch, falling to 0.2 percent during the suspension, and holding at 2 to 3 percent after the July 1 redeploy."
      events={[
        { startDay: "2026-06-09", color: "hsl(200 70% 60%)", title: "Launch" },
        { startDay: "2026-06-12", endDay: "2026-06-30", color: "hsl(0 60% 50%)", title: "Suspension" },
        { startDay: "2026-07-01", color: "hsl(260 60% 65%)", title: "Redeploy" },
      ]}
      yDomain={[0, 4]}
    />
    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Share of Claude-classified posts using refusal/classifier language, 7-day trailing. This is a text
        match over post content, independent of my sentiment classifier. The raw single-day peak is 8% on
        June 10.
      </em>
    </p>
    <p>
      Launch week tripled it, and the raw single-day peak (8% on June 10) landed the day after launch.
      The classifier's own labels agree, and put the spike even higher: posts my classifier tagged with a{" "}
      <code>refusals</code> or <code>censorship</code> complaint were 1.9% of Claude posts the week before
      launch, 11.2% launch week, and 6.7–7.3% in the two weeks after the redeploy. (The classifier series
      doesn't go quiet during the suspension the way the text proxy does; it counts refusal complaints
      about any Claude model, including the Opus 4.8 everyone fell back to.) The first refusal complaint in
      my corpus is titled "
      <ExternalLink href="https://www.reddit.com/r/ClaudeAI/comments/1u1hhhu/fable_5_blocking_all_my_security_audits/">
        Fable 5 blocking all my security audits
      </ExternalLink>
      " and is timestamped nine hours after launch. During the suspension, when the model was unavailable, the series falls to 0.2%. After the redeploy it settles at 2–3% and stays there
      through press time: roughly double the launch-era baseline, sustained for two-plus weeks.
    </p>
    <PullQuote
      text={'@bcherny Fable 5 is impossible to work with! every mundane query is being "flagged" What was the point in bringing it back if its impossible to use for everyday tasks?…'}
      handle="@Yacht_Buoy_"
      platform="X"
      timestamp="2026-07-01 21:04 UTC"
      href="https://x.com/Yacht_Buoy_/status/2072426099905122717"
      archivedHref="https://web.archive.org/web/2026/https://x.com/Yacht_Buoy_/status/2072426099905122717"
    />
    <PullQuote
      text={'I have been working on a project that has to do with ancient DNA for a while now, and no matter how I structure the prompts it always gets flagged. I was frustrated with it so I asked it "You are a chief architect tasked with designing the perfect city for one million people to live in." It flagged that and switched back to Opus.'}
      handle="r/ClaudeCode"
      platform="Reddit"
      timestamp="2026-07-02 15:52 UTC"
      href="https://www.reddit.com/r/ClaudeCode/comments/1ulm20t/fable_flagging_everything/"
    />
    <p>
      The post that best captures the product economics of a safety classifier came from a Max 20x
      subscriber running a medical training app:
    </p>
    <PullQuote
      text="The review was magnificent. It caught stuff I never would have caught… The second I ask Fable 5 do implement any fix, write any documentation or do any work it jumps immediatly to Opus 4.8… I asked it to fix a simple error, flagged. I asked it to fix some leaderboard-issues. Flagged… Honestly, I am thinking about jumping ship when Codex 5.6 releases."
      handle="r/ClaudeCode"
      platform="Reddit"
      timestamp="2026-07-02 15:42 UTC"
      href="https://www.reddit.com/r/ClaudeCode/comments/1ullt8c/switches_to_opus_48_constantly/"
    />
    <p>
      That is one user, but both halves show up in the aggregate: the 59.1 average score for July 1–7, and
      a refusal series that stayed at 2–3% after the redeploy.
    </p>

    <h2 id="the-deadline-economy">The deadline economy</h2>
    <p>
      From July 5 onward, a growing slice of Fable chatter was about the access deadline. Anthropic had priced Fable 5 at $10/$50 per million tokens and included it free on
      paid plans as a launch window; the window's close became a countdown, and the countdown got extended
      twice. Price came up in replies too. This post answered someone who had hit a rate limit:
    </p>
    <PullQuote
      text="goodbye fable 5 you are officially too expensive for me"
      handle="@AItfnnp"
      platform="X"
      timestamp="2026-07-05 21:04 UTC"
      href="https://x.com/AItfnnp/status/2073875762931773551"
      archivedHref="https://web.archive.org/web/2026/https://x.com/AItfnnp/status/2073875762931773551"
    />
    <PullQuote
      text="the removal already happened, it's just priced instead of toggled. at $10/$50 per M tokens Fable 5 leaves most builders' budgets the day the included window closes on the 12th. so the pattern isn't cancel-and-move, it's let Fable 5 direct and run the actual tokens through Sonnet. who's keeping it in the hot path at that rate?"
      handle="@DakshTrehan"
      platform="X"
      timestamp="2026-07-08 04:06 UTC"
      href="https://x.com/DakshTrehan/status/2074706556919431200"
      archivedHref="https://web.archive.org/web/2026/https://x.com/DakshTrehan/status/2074706556919431200"
    />
    <p>
      One user put it this way: at that price, Fable turns from a daily driver into a director. Plan with the expensive model, execute with the cheap one. The r/ClaudeAI
      thread "
      <ExternalLink href="https://www.reddit.com/r/ClaudeAI/comments/1uowzrv/what_was_the_point_of_the_fable_5_free_trial/">
        What was the point of the Fable 5 free trial?
      </ExternalLink>
      " makes the counter-argument from the trenches: a free window on a model whose classifier flags
      constantly "seems more like its been an overall detriment to the brand than any sort of positive."
      Between those two posts sits the whole experiment: Anthropic ran a time-boxed, then extended,
      free-access window during an active governance crisis. Mention share was higher in the redeploy week
      (22.7%) than in launch week (17.1%), and I can't separate the deadline from the redeploy itself.
    </p>

    <h2 id="confounds">Confounds, and what survives them</h2>
    <p>
      Three things happened to my measurements mid-arc, and one of them was me. Grok 4.5 launched July 8 and
      GPT-5.6 launched July 9, both pulling attention share. On July 10 I deployed my own accuracy-audit
      fixes: a Bluesky query rebalance, Twitter volume raised, Hacker News comments and App Store reviews
      added as sources, and a scoring change that rescored neutral posts.
    </p>
    <p>
      So: raw mention <em>counts</em> jump after July 10 partly because my net widened. That's why every
      series in this article is a share, not a count. Mention share is computed within each day's corpus, so
      a bigger net mostly cancels out. The refusal proxy is a text match, so it doesn't care what my
      sentiment classifier thinks. Score comparisons across July 10 are the casualty. I measured the
      scoring-formula change itself at only ~1 point on average, but the same deploy changed which posts get
      ingested, and there's no clean way to separate a real shift from a different sample. Every score claim
      above stays inside one side of that boundary; the June suspension dip and the July 1–7 honeymoon both
      sit safely pre-deploy.
    </p>
    <p>
      One confound survives honestly unresolved: Claude's score sag after July 8 (49.9 average July 8–16,
      down from 59.1) could be classifier fatigue, deadline sourness, unflattering Grok/GPT-5.6 comparisons,
      my source-mix change, or all four. I'm not assigning it.
    </p>

    <h2 id="what-a-product-team-takes-from-this">What a product team takes from this</h2>
    <p>
      Three things in the data stand out to me.
    </p>
    <p>
      Refusal language peaked on June 10 (8% of Claude posts, raw), the day after launch and two days
      before the June 12 directive. A team watching community refusal language that day had the
      classifier-calibration story before the press did.
    </p>
    <p>
      The score climbing back to the low 50s mid-suspension didn't mean users were happy. As I said above,
      my read is that the model was off, so there was nothing to be refused by. When access returned, the
      7-day refusal share went from 0.6% on June 30 to 1.9% on July 3. If you only watched the topline
      score, the outage would have looked like healing.
    </p>
    <p>
      The two extension announcements fell on days with a daily mention share of 20.0% (July 7) and 20.9%
      (July 12). The highest daily share of the arc was July 1, redeploy day, at 29.8%, then June 10 at
      27.9%. The 7-day peak of 22.7% on July 7 is the redeploy week, so I can't credit the extensions for
      it. I also have no daily count of pricing complaints, so I'm not claiming the extensions drove them.
    </p>

    <h2 id="methodology">Methodology</h2>
    <p>
      As of July 2026, LLM Vibes scraped posts about four LLM models across six sources: Reddit and
      Twitter/X via Apify, Hacker News via Algolia, Bluesky, Mastodon, and App Store reviews. Posts were
      classified for per-model sentiment by Claude Haiku 4.5 via the Anthropic API, and the daily 0–100
      score was confidence- and engagement-weighted. The scoring code
      (<code>supabase/functions/_shared/vibes-scoring.ts</code> in the public repo) has changed since.
    </p>
    <p>
      This article uses 18,746 model-classified rows (April 13 – July 17) exported via the public{" "}
      <code>get_public_recent_chatter</code> RPC, and daily scores from <code>get_public_vibes_history</code>.
      "Fable mention share" is the share of each day's rows whose title or content matches{" "}
      <code>fable|mythos</code> (case-insensitive, word-bounded). "Refusal language" matches a fixed pattern
      list (refused/refusal, censor, flagged, false positive, safety classifier, fallback-to-Opus phrasing)
      over Claude-classified rows. Both are shares within the day's corpus, which is what lets them cross my
      July 10 pipeline change; raw counts for every series are in the downloadable CSV.
    </p>
    <p>
      Two disclosures. My sentiment classifier was itself a Claude model classifying posts about Claude. The
      self-bias check I ran against an independent Gemini grader (88.9% sentiment agreement on the June run
      of the classifier then in use) is described in{" "}
      <a href="/research/how-llm-vibes-classifies-sentiment">How LLM Vibes classifies sentiment</a>. And this
      article was drafted with Fable 5 itself in the loop — the model whose lifecycle it documents — with
      every number generated by deterministic scripts against the public RPCs and every quote verified
      against its source URL.
    </p>

    <h2 id="what-you-can-do-next">What you can do next</h2>
    <p>
      <em>Update, July 21:</em> the deadline never arrived. On July 18 Anthropic{" "}
      <ExternalLink href="https://x.com/claudeai/status/2078302415804379218">announced</ExternalLink> that
      beginning July 20, Fable 5 would be included in all Max and Team Premium plans at 50% of limits, with
      Pro and Team Standard keeping usage-credit access plus a one-time $100 credit. The post gives no end
      date. That answers the churn question this article originally closed on. What's left to watch is whether the 16% mention share
      holds once no countdown is feeding it. The <a href="/model/claude">live Claude chart</a> has the
      suspension band and the Max and Team Premium change marked.
    </p>
    <p>
      Download the{" "}
      <a href="/research/fable-5-lifecycle-june-july-2026/data.csv">dataset</a> (daily scores, mention
      counts, corpus sizes, and refusal-language counts, June 1 – July 16), or{" "}
      <ExternalLink href="https://github.com/dkships/llm-moods">fork the pipeline on GitHub</ExternalLink>.
    </p>

    <AuthorBio />
  </>
);

export default FableLifecycleBody;
