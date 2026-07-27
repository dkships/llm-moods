import useHead from "@/hooks/useHead";

const LINK_CLASS =
  "rounded-md text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const Privacy = () => {
  useHead({
    // Must stay byte-identical to the /privacy RouteMeta in scripts/prerender-routes.ts.
    title: "Privacy & data practices — LLM Vibes",
    description:
      "What LLM Vibes collects, how long it keeps public posts, Lovable-hosted project analytics, and how to request removal of a quoted post.",
    url: "/privacy",
  });

  return (
          <section className="container max-w-3xl pb-16 pt-10 sm:pt-12">
            <h1 className="text-page text-foreground">Privacy &amp; data practices</h1>
            <p className="mt-4 text-body text-text-secondary">
              LLM Vibes has no accounts or advertising trackers. It is an independent, open-source
              dashboard run by{" "}
              <a
                href="https://dmkthinks.org"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                David Kelly
              </a>
              .
            </p>

            <h2 className="mt-10 text-section text-foreground">Site analytics</h2>
            <p className="mt-3 text-body text-text-secondary">
              The site is hosted on Lovable. Lovable injects project analytics into published sites and
              records visits and pageviews. The injected script sends the page address and path, referrer,
              browser and device information, locale, and an approximate country inferred from the browser's
              time zone. It also sets a secure <code className="rounded bg-secondary/60 px-1.5 py-0.5 text-meta text-foreground">session-id</code>{" "}
              cookie that expires after 30 minutes to group pageviews into one visit. LLM Vibes does not add
              a separate visitor analytics service. See Lovable's{" "}
              <a
                href="https://docs.lovable.dev/features/analytics"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                project analytics documentation
              </a>
              .
            </p>

            <h2 className="mt-10 text-section text-foreground">Public posts</h2>
            <p className="mt-3 text-body text-text-secondary">
              LLM Vibes scrapes public posts about AI models from Reddit, Hacker News, Bluesky,
              X/Twitter, and Mastodon. Each post is stored with its text, author handle, source
              link, and an AI-assigned sentiment classification. Nothing non-public is collected from
              those platforms.
            </p>

            <h2 className="mt-10 text-section text-foreground">How long it keeps it</h2>
            <p className="mt-3 text-body text-text-secondary">
              Scraped posts are deleted roughly 90 days after they were posted. Three things
              outlive that window: daily aggregate scores (numbers only, no post content), rumor
              records that keep a link and short snippet of the posts behind them, and verbatim
              quotes embedded in research articles. Internal error logs are deleted after 14 days.
            </p>

            <h2 className="mt-10 text-section text-foreground">Removing a quoted post</h2>
            <p className="mt-3 text-body text-text-secondary">
              If a post of yours appears here and you want it removed, open a{" "}
              <a
                href="https://github.com/dkships/llm-moods/issues"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                GitHub issue
              </a>{" "}
              or message David on{" "}
              <a
                href="https://www.linkedin.com/in/thedmkelly/"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                LinkedIn
              </a>
              . This covers chatter-feed posts, rumor sources, and quotes in research articles.
            </p>

            <p className="mt-10 text-body text-text-secondary">
              Not affiliated with or endorsed by Anthropic, OpenAI, Google, or xAI. Claude, ChatGPT, Gemini,
              and Grok are trademarks of their respective owners.
            </p>
          </section>
  );
};

export default Privacy;
