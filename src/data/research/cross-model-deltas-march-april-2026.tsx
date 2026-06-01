/**
 * Body component for /research/cross-model-deltas-march-april-2026.
 * Hand-ported from markdown to JSX. EmbeddedModelChart is rendered
 * directly inline rather than via a `chart-model` markdown sentinel.
 */

import EmbeddedModelChart from "@/components/research/EmbeddedModelChart";
import AuthorBio from "@/components/research/AuthorBio";

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

const CrossModelDeltasBody = () => (
  <>
    <h2>Watch the recovery shape, not the drop</h2>
    <p>
      How a model's score recovers after a known fix tells you more than the depth of the original drop. In
      the <a href="/research/claude-april-2026">March–April 2026 Claude incident</a>, ChatGPT drifted back
      toward its baseline once Anthropic's fix shipped. Gemini stayed roughly flat. Claude kept falling, the
      deepest of the four. That post-fix divergence is what singled Claude out as actually broken — not its
      bug-window delta, and definitely not its absolute score in any single day.
    </p>
    <p>
      The most common misread of a multi-model dashboard like LLM Vibes is comparing two scores at a single
      moment. <em>"Claude is 48, ChatGPT is 31, so Claude is better."</em> That number says less than it looks
      like.
    </p>
    <p>
      What it actually says is: at this moment, in the population of posts we scraped, the volume-weighted
      positive share for Claude is higher than for ChatGPT. Models attract different audiences with different
      complaint cultures. Reddit's r/ChatGPT runs hotter than r/ClaudeAI on any given day. A snapshot doesn't
      tell you whether a model is improving, regressing, or holding steady. Only the delta from its own
      baseline does, and the cross-model incident below shows even that delta can mislead.
    </p>

    <h2>The four models, side by side</h2>

    <EmbeddedModelChart modelSlug="claude" startDate="2026-02-10" endDate="2026-04-25" />
    <EmbeddedModelChart modelSlug="chatgpt" startDate="2026-02-10" endDate="2026-04-25" />
    <EmbeddedModelChart modelSlug="gemini" startDate="2026-02-10" endDate="2026-04-25" />
    <EmbeddedModelChart modelSlug="grok" startDate="2026-02-10" endDate="2026-04-25" />

    <p>
      Each chart shows the model's own daily score, February 10 through April 25, 2026 — the publication
      window. The Claude chart is shaded with the three Anthropic-confirmed bug windows. The other three are
      not shaded because their vendors have not published comparable postmortems for the same period.
    </p>

    <h2>The numbers that matter</h2>
    <p>
      Across the cache-bug window (March 26 – April 10, 2026), each tracked model's volume-weighted score was:
    </p>
    <div className="my-6 overflow-x-auto rounded-lg border border-border">
      <table className="w-full">
        <thead>
          <tr>
            <th>Model</th>
            <th className="whitespace-nowrap">Mar 26 – Apr 10 score</th>
            <th className="whitespace-nowrap">Feb baseline</th>
            <th className="whitespace-nowrap">Delta from baseline</th>
            <th className="whitespace-nowrap">Press-cycle echo (Apr 11–15)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Claude</td>
            <td>47.6</td>
            <td>71.0</td>
            <td>
              <strong>−23</strong>
            </td>
            <td>
              <strong>36</strong>
            </td>
          </tr>
          <tr>
            <td>ChatGPT</td>
            <td>32.0</td>
            <td>80.8</td>
            <td>
              <strong>−49</strong>
            </td>
            <td>46</td>
          </tr>
          <tr>
            <td>Gemini</td>
            <td>38.4</td>
            <td>76.0</td>
            <td>
              <strong>−38</strong>
            </td>
            <td>36</td>
          </tr>
          <tr>
            <td>Grok</td>
            <td>34.6</td>
            <td>48.5</td>
            <td>
              <strong>−14</strong>
            </td>
            <td>26</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      Claude held the highest absolute score in this window. It also had the smallest meaningful drop from its
      own February baseline of any well-trafficked model. ChatGPT and Gemini dropped much further from their
      baselines. By either reading, Claude looked fine.
    </p>
    <p>
      The signal was in the post-fix shape. ChatGPT recovered toward its baseline (32 → 46) after Anthropic
      confirmed the fix on April 10. Gemini drifted slightly down (38 → 36). Claude kept sliding the deepest
      of the four (48 → 36). That recovery divergence is what identifies Claude as the actually-broken model,
      not the depth of any single number or the delta-from-baseline during the breakage.
    </p>

    <h2>Why the recovery shape matters more than the bug-window delta</h2>
    <p>Three reasons.</p>
    <p>
      Cohort drift. Each model has a different audience mix. ChatGPT pulls in heavy mainstream traffic from
      Reddit and Twitter; Claude pulls in a more developer-skewed cohort that's more demanding and more vocal.
      The volume-weighted score reflects both quality and audience tolerance. Bug-window deltas alone can't
      separate "the underlying model regressed" from "an audience that complains more loudly than usual got an
      excuse to do it." Both produce the same drop.
    </p>
    <p>
      Press-cycle echo. When a story goes mainstream (VentureBeat, Fortune, Hacker News, The Register), the wave
      of "X is broken" posts arrives <em>after</em> the fix. Our scrapers pick up that echo for every model
      visible in the news cycle. The interesting question isn't who showed up in the press wave. It's who{" "}
      <em>kept</em> sliding through it. A model whose post-fix score recovers toward baseline (ChatGPT, Gemini)
      is a model where the press-cycle posts are stale complaints. A model whose post-fix score keeps falling
      (Claude) is a model where the underlying complaints are still arriving.
    </p>
    <p>
      Vendor-wide trends. When all four models drop together during the same week, that's industry sentiment,
      not a single model's quality. The cross-vendor median delta during the bug window was about −30. Claude's
      −23 is the smallest of the four. The bug-window deltas alone do not single Claude out. Only the recovery
      column does.
    </p>

    <h2>Caveats</h2>
    <p>
      The Feb baseline numbers in the table above (71.0, 80.6, 76.0, 48.4) come from approximately four days of
      meaningful pre-bug coverage (Feb 15–18). The Feb 19 – Mar 7 scraper-volume gap erased the rest of
      February. Each baseline therefore carries roughly ±3 points of sampling noise. The deltas are accurate
      to the underlying data; the baselines themselves are the weakest part of the table.
    </p>
    <p>
      The classifier is Claude Haiku 4.5, which scores all four models including itself, so the risk to watch
      is a pro-Claude tilt. The validation check samples recent low-confidence or incomplete posts, reruns them
      through an independent free-tier Gemini grader, and compares its sentiment and complaint labels against
      the stored Claude labels without writing public scores. We run it around classifier changes, not as an
      always-on monitor. It does not remove self-bias risk, but it keeps a cutover auditable against a
      different vendor's read. An earlier Gemini/Claude comparison in April 2026 found roughly 92% sentiment
      agreement, which suggests the vendor behind the classifier isn't the main driver of a model's score.
      Full method and category caveats are in the{" "}
      <a href="/research/how-llm-vibes-classifies-sentiment">methodology post</a>.
    </p>

    <h2>How to read the dashboard</h2>
    <p>Three rules worth committing to memory.</p>
    <ol>
      <li>
        Compare a model to itself across time, not to other models on the same day. Each model card on{" "}
        <a href="/dashboard">the dashboard</a> shows yesterday's delta in the trend pill. That's the right
        first-pass metric for "is X getting worse?"
      </li>
      <li>
        After a known regression and fix, watch the recovery column, not the trough. If three models trend
        upward and one stays flat or falls, the flat one is the model whose underlying issue isn't actually
        resolved — regardless of which had the deepest absolute drop or the largest bug-window delta.
      </li>
      <li>
        Treat a single ≥2σ daily deviation as a watch flag, not a verdict. The{" "}
        <a href="/admin/scrapers">admin Anomalies panel</a> (dev-only) surfaces these automatically. A first-day
        regression is rarely the strongest signal. Sustained multi-day drops, especially through and after
        a confirmed fix, match what a real engineering bug looks like in user behavior.
      </li>
    </ol>

    <h2>What this means for the next incident</h2>
    <p>
      When the next Claude, GPT, Gemini, or Grok regression happens (and it will), the early signal will not
      be a single model's drop and probably won't even be its delta from baseline. Industry-wide news cycles
      pull every visible model down at the same time. The signal that one model is actually still degraded —
      and not just absorbing a press wave — is post-recovery divergence: most models climb back; one doesn't.
    </p>
    <p>
      That comparison currently requires eyeballing four charts side by side. The next iteration of LLM Vibes
      should compute it explicitly: a "post-fix recovery shape" metric per model that flags when a vendor's
      score continues to fall while peers recover. That's not built yet. If you want to read the data yourself
      in the meantime, the{" "}
      <a href="/research/claude-april-2026/data.csv">public CSV</a> for the Claude case study has the raw
      scores; the other three models' scores are queryable via the public Supabase REST endpoint exposed in
      the repository.
    </p>

    <p>
      The lesson from March 2026: LLM Vibes caught Claude breaking by watching what happened <em>after</em>{" "}
      Anthropic said it was fixed. One model's score didn't behave like the other three. Build the same instinct
      into how you read the dashboard.
    </p>

    <AuthorBio />
  </>
);

export default CrossModelDeltasBody;
