import { Link } from "react-router-dom";
import { AUTHOR_NAME, AUTHOR_PORTFOLIO_URL } from "@/data/author";

const Footer = () => (
  <footer className="border-t border-border bg-card/35">
    <div className="container grid gap-5 pb-24 pt-7 text-meta text-text-tertiary sm:pb-8 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <p className="text-text-secondary">LLM Vibes · Independent AI sentiment data</p>
        <p className="mt-1">
          Built by{" "}
          <a
            href={AUTHOR_PORTFOLIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {AUTHOR_NAME}
          </a>
          .
        </p>
      </div>
      <nav aria-label="Project links">
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          <li>
            <a
              href="https://github.com/dkships/llm-moods"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-md text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:min-h-0"
            >
              GitHub
            </a>
          </li>
          <li>
            <Link
              to="/research/how-llm-vibes-classifies-sentiment"
              className="inline-flex min-h-11 items-center rounded-md underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:min-h-0"
            >
              Methodology
            </Link>
          </li>
          <li>
            <Link
              to="/privacy"
              className="inline-flex min-h-11 items-center rounded-md underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:min-h-0"
            >
              Privacy
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  </footer>
);

export default Footer;
