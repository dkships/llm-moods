/**
 * Body component for /research/cross-model-deltas-march-april-2026.
 * Hand-ported from markdown to JSX. EmbeddedModelChart is rendered
 * directly inline rather than via a `chart-model` markdown sentinel.
 */

import EmbeddedModelChart from "@/components/research/EmbeddedModelChart";

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

const CrossModelDeltasBody = () => (
  <>
    <h2>Reading absolute scores will mislead you</h2>
    <p>
      The most common misread of a multi-model dashboard like LLM Vibes is comparing two model scores at a
      single point in time. <em>"Claude is 48, ChatGPT is 31, so Claude is better."</em> That number says less
      than it looks like.
    </p>
    <p>
      What it actually says is: at this moment, in the population of posts we scraped, the volume-weighted
      positive share for Claude is higher than for ChatGPT. Models attract different audiences with different
      complaint cultures. Reddit's r/ChatGPT runs hotter than r/ClaudeAI on any given day. A snapshot doesn't
      tell you whether a model is improving, regressing, or holding steady. Only the delta from its own baseline
      does that.
    </p>
    <p>
      This is the lesson the <a href="/research/claude-april-2026">March–April 2026 Claude incident</a> made
      unmissable.
    </p>

    <h2>The four models, side by side</h2>

    <EmbeddedModelChart modelSlug="claude" />
    <EmbeddedModelChart modelSlug="chatgpt" />
    <EmbeddedModelChart modelSlug="gemini" />
    <EmbeddedModelChart modelSlug="grok" />

    <p>
      These are live charts, not snapshots. Each one shows the model's own daily score against its own history.
      The Claude chart is shaded with the three Anthropic-confirmed bug windows. The other three are not shaded
      because their vendors have not published comparable postmortems for the same period.
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
            <th>Mar 26 – Apr 10 score</th>
            <th>Feb baseline</th>
            <th>Delta from baseline</th>
            <th>Press-cycle echo (Apr 11–15)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Claude</td>
            <td>48.2</td>
            <td>~72</td>
            <td>
              <strong>−24</strong>
            </td>
            <td>
              <strong>34</strong>
            </td>
          </tr>
          <tr>
            <td>ChatGPT</td>
            <td>31.1</td>
            <td>~64</td>
            <td>
              <strong>−33</strong>
            </td>
            <td>48</td>
          </tr>
          <tr>
            <td>Gemini</td>
            <td>36.9</td>
            <td>~73</td>
            <td>
              <strong>−36</strong>
            </td>
            <td>42</td>
          </tr>
          <tr>
            <td>Grok</td>
            <td>32.6</td>
            <td>~65</td>
            <td>
              <strong>−33</strong>
            </td>
            <td>24</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      Claude was the highest absolute score in this window. It also had the smallest delta from its own February
      baseline, and the only post-fix trough that dropped <em>below</em> its bug-window score. ChatGPT, Gemini,
      and Grok all had larger absolute drops but recovered faster.
    </p>
    <p>
      That's the inverted shape: the model that was actually broken (Claude, per Anthropic's own postmortem) had
      the <em>best</em> absolute score during the breakage and the <em>worst</em> relative score after it was
      fixed. Reading absolute scores would have told you Claude was fine. Reading deltas tells you the truth.
    </p>

    <h2>Why deltas catch what absolute scores miss</h2>
    <p>Three reasons.</p>
    <p>
      Cohort drift. Each model has a different audience mix. ChatGPT pulls in heavy mainstream traffic from
      Reddit and Twitter; Claude pulls in a more developer-skewed cohort that's more demanding and more vocal.
      The volume-weighted score reflects both quality and audience tolerance. Comparing baselines to themselves
      removes the audience-tolerance variable.
    </p>
    <p>
      Press-cycle echo. When a story goes mainstream (VentureBeat, Fortune, Hacker News, The Register), the wave
      of "X is broken" posts arrives <em>after</em> the fix. Our scrapers pick up the echo. A naive
      absolute-score reading flags the post-fix week as worse than the actual-fix week. A delta-from-baseline
      reading shows the press wave as a smaller deviation than the silent bug period was.
    </p>
    <p>
      Vendor-wide trends. When all four models drop together, that's industry sentiment, not model quality.
      Aggregating across the whole tracked set gives you a baseline of baselines: if Claude's delta is −24 while
      the average across other vendors is −34, Claude is actually doing better than the industry trend, even
      when its absolute number is also down.
    </p>

    <h2>How to read the dashboard</h2>
    <p>Three rules worth committing to memory.</p>
    <ol>
      <li>
        Compare a model to itself, not to other models, when judging quality changes. Each model card on{" "}
        <a href="/dashboard">the dashboard</a> shows yesterday's delta in the trend pill. That's the right
        metric for "is X getting worse?"
      </li>
      <li>
        Watch for divergence from the cross-model average. If three of four tracked models go down by the same
        magnitude in the same week, the news is industry-wide. If one model's delta is meaningfully larger, that
        one is the story.
      </li>
      <li>
        Treat a single ≥2σ daily deviation as a watch flag, not a verdict. The{" "}
        <a href="/admin/scrapers">admin Anomalies panel</a> (dev-only) surfaces these automatically. A first-day
        regression is rarely the strongest signal. Sustained multi-day drops match what a real engineering bug
        looks like in user behavior.
      </li>
    </ol>

    <h2>What this means for the next incident</h2>
    <p>
      When the next Claude, GPT, Gemini, or Grok regression happens (and it will), the early signal won't be
      that one model dropped. The early signal will be that one model's <em>delta from its baseline</em> is
      several points larger than the cross-model median for the same week.
    </p>
    <p>
      That comparison currently requires eyeballing four charts. The next iteration of LLM Vibes should compute
      it explicitly: a "delta divergence" metric per model per day, surfaced as a new anomaly type. That's not
      built yet. If you want to read the data yourself in the meantime, the{" "}
      <a href="/research/claude-april-2026/data.csv">public CSV</a> for the Claude case study has the raw
      scores; the other three models' scores are queryable via the public Supabase REST endpoint exposed in the
      repository.
    </p>

    <h2>Caveats</h2>
    <p>
      The Feb baseline numbers in the table above (~72, ~64, ~73, ~65) are approximate. The Feb 19 – Mar 7
      scraper-volume gap means each model's pre-bug baseline rests on roughly four days of meaningful data, not
      a statistically robust window. The relative ordering is solid; the precise baseline values are the
      weakest part of the table.
    </p>
    <p>
      The lesson from March 2026 was not that LLM Vibes caught Claude breaking. It was that we caught it by
      reading deltas instead of the leaderboard. Build the same instinct into how you read the dashboard.
    </p>
  </>
);

export default CrossModelDeltasBody;
