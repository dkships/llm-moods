/**
 * Body component for /research/cross-model-deltas-march-april-2026.
 * Four live EmbeddedModelCharts pinned to Mar 10 – Apr 25, 2026 and one
 * table. Window figures are plain averages of the daily scores in
 * public/research/claude-april-2026/data.csv (live vibes_scores rows from
 * the first day of scraping; no rows before Mar 8, 2026).
 */

import EmbeddedModelChart from "@/components/research/EmbeddedModelChart";
import AuthorBio from "@/components/research/AuthorBio";
import ResearchTableFrame from "@/components/research/ResearchTableFrame";

const CrossModelDeltasBody = () => (
  <>
    <h2 id="the-snapshot">The snapshot said Claude was fine</h2>
    <p>
      Between March 26 and April 10, 2026, Claude had a bug.{" "}
      <a href="/research/claude-april-2026">Anthropic confirmed it four weeks later</a>. Over those same 16
      days, Claude's average score on LLM Vibes was 47.6. ChatGPT's was 32.0.
    </p>
    <p>
      So if you had opened the dashboard in the middle of Claude's regression and compared the two numbers,
      you'd have said Claude was the healthier model. That's the most common way to misread a multi-model
      dashboard, and it's the reason I wrote this.
    </p>
    <p>
      A score at one moment says how positive the posts about a model were that day. Models attract
      different audiences with different habits of complaining, so one model's 48 and another's 32 aren't on
      the same scale. The comparison that works is each model against its own recent past.
    </p>

    <h2 id="side-by-side">The four models, side by side</h2>

    <EmbeddedModelChart modelSlug="claude" startDate="2026-03-10" endDate="2026-04-25" />
    <EmbeddedModelChart modelSlug="chatgpt" startDate="2026-03-10" endDate="2026-04-25" />
    <EmbeddedModelChart modelSlug="gemini" startDate="2026-03-10" endDate="2026-04-25" />
    <EmbeddedModelChart modelSlug="grok" startDate="2026-03-10" endDate="2026-04-25" />

    <p className="mt-2 text-sm text-text-tertiary">
      <em>
        Each model's daily score, March 10 through April 25, 2026. The Claude chart is shaded with the three
        bug windows Anthropic confirmed. Days before March 20 rest on very few posts and are drawn with
        hollow dots.
      </em>
    </p>

    <h2 id="the-numbers">Each model against its own week before</h2>
    <p>
      LLM Vibes started collecting steady daily volume on March 20, six days before the cache bug shipped.
      So the "before" for each model is those six days. Here's each model's average score before, during,
      and after.
    </p>
    <ResearchTableFrame label="Average daily score before, during and after the Claude cache bug">
      <table className="w-full">
        <caption className="sr-only">
          For each tracked model: the change in average daily score from the six days before the cache bug
          shipped to the bug window, then the two averages themselves, and the average for the five days
          after the fix.
        </caption>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col" className="whitespace-nowrap">Change</th>
            <th scope="col" className="whitespace-nowrap">Six days before (Mar 20–25)</th>
            <th scope="col" className="whitespace-nowrap">Bug window (Mar 26 – Apr 10)</th>
            <th scope="col" className="whitespace-nowrap">After the fix (Apr 11–15)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Claude</td>
            <td>
              <strong>−10.7</strong>
            </td>
            <td>58.3</td>
            <td>47.6</td>
            <td>36.0</td>
          </tr>
          <tr>
            <td>ChatGPT</td>
            <td>+6.5</td>
            <td>25.5</td>
            <td>32.0</td>
            <td>46.4</td>
          </tr>
          <tr>
            <td>Gemini</td>
            <td>−7.8</td>
            <td>46.2</td>
            <td>38.4</td>
            <td>36.2</td>
          </tr>
          <tr>
            <td>Grok</td>
            <td>+1.1</td>
            <td>33.5</td>
            <td>34.6</td>
            <td>26.4</td>
          </tr>
        </tbody>
      </table>
    </ResearchTableFrame>
    <p>
      Read the bug-window column on its own and Claude wins. Read the change column and Claude is the model
      with the biggest drop. ChatGPT, the model that looked worst in the snapshot, was improving the whole time.
    </p>
    <p>
      Gemini fell too, by about 8 points. I don't read much into that. Gemini had 111 posts with a stance in
      its six days before, against 279 for Claude and 318 for ChatGPT, and two of its six days had fewer
      than ten posts. Grok was thinner still, at 87.
    </p>

    <h2 id="after-the-fix">The week after the fix was Claude's worst</h2>
    <p>
      Anthropic shipped the fix on April 10. Claude's score didn't recover. It fell again, to an average of
      36.0 for April 11–15, its lowest stretch with real post volume. ChatGPT kept climbing, to 46.4.
    </p>
    <p>
      My read is that those five days were the press cycle. The Register published on April 13, other
      outlets and Hacker News followed, and the posts that week were people reacting to the coverage. Many
      of them had issues that were already fixed. Then the score came back. Claude averaged 48.8 for April
      16–20, about where it had been during the bug.
    </p>
    <p>
      So the lowest number on the chart came after the problem was gone. If you had used the size of the dip
      to date the bug, you'd have been off by two weeks.
    </p>

    <h2 id="caveats">Caveats</h2>
    <p>
      The "before" is six days. That's all the steady data there was. An earlier version of this article
      compared the bug window with a "February baseline" and concluded that every model had dropped. Those
      February rows were placeholder data from the app's first build, not scraped posts. Against real data,
      ChatGPT rose and Grok was flat. I've rewritten the article around the real numbers, and the{" "}
      <a href="/research/claude-april-2026/data.csv">dataset</a> now starts on March 8, the first day of
      scraping.
    </p>
    <p>
      I can't say why ChatGPT started so low. Its scores in the teens and 20s in late March came when the
      scrapers were only days old. I'd treat its level in that stretch with suspicion and its direction with
      a little more confidence.
    </p>
    <p>
      During this window the classifier was a Google Gemini Flash model, which graded posts about Gemini
      along with the other three. In April 2026 I reran a sample of its labels through Claude Sonnet 4.6 and
      the two agreed on sentiment about 92% of the time. That's a check, not proof of neutrality. The
      pipeline has changed since, and the{" "}
      <a href="/research/how-llm-vibes-classifies-sentiment">methodology page</a> describes the current one.
    </p>

    <h2 id="how-to-read-the-dashboard">How I read the dashboard now</h2>
    <p>
      I compare each model with its own recent days first. The dashboard's anomaly flag works this way: it
      checks a model's score against that model's own trailing two weeks, never against another model.
    </p>
    <p>
      Then I look at whether the other models moved on the same days. When one model drops and the others
      don't, the cause is probably that model. When they all move together, it's more likely news, or
      something that changed in my own pipeline.
    </p>
    <p>
      And I check the post count before I believe a move. A ten-point swing on 15 posts is noise. On this
      incident that rule is what keeps me from saying anything about Gemini.
    </p>
    <p>
      The last thing this taught me is to separate the bug from the coverage of the bug. The score moved
      twice, once when the bug shipped and once when the press wrote about it. Only the first move was
      about the product.
    </p>

    <AuthorBio />
  </>
);

export default CrossModelDeltasBody;
