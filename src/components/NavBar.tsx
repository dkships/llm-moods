import { Link, useLocation } from "react-router-dom";
import { RESEARCH_POSTS } from "@/data/research-posts";

const GitHubIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const SvgMark = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4 text-primary" aria-hidden="true">
    <path
      d="M1 6 C 3 4, 5 8, 7 6 S 11 4, 13 6 S 15 6, 15 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M1 10 C 3 8, 5 12, 7 10 S 11 8, 13 10 S 15 10, 15 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.5"
    />
  </svg>
);

const NavBar = () => {
  const { pathname } = useLocation();
  const showResearchLink = RESEARCH_POSTS.length > 0;
  const isResearchActive = pathname === "/research" || pathname.startsWith("/research/");
  const isRumorsActive = pathname === "/rumors";
  const isDashboardActive = pathname === "/dashboard" || pathname.startsWith("/model/");

  const navLinkClass = (active: boolean) =>
    `rounded-md px-2 py-1 text-mono-cap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
      active ? "bg-primary/10 text-primary" : "text-text-tertiary hover:text-foreground"
    }`;

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/55 shadow-[0_1px_0_0_hsl(0_0%_100%/0.02)]">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div className="container flex h-16 items-center justify-between">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <SvgMark />
          <span className="whitespace-nowrap text-section text-foreground">
            LLM <span className="text-primary">Vibes</span>
          </span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-5">
          <Link to="/dashboard" className={navLinkClass(isDashboardActive)}>
            Dashboard
          </Link>
          {showResearchLink && (
            <Link to="/research" className={navLinkClass(isResearchActive)}>
              Research
            </Link>
          )}
          <Link to="/rumors" className={navLinkClass(isRumorsActive)}>
            Rumors
          </Link>
          <a
            href="https://github.com/dkships/llm-moods"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <GitHubIcon className="h-5 w-5" />
          </a>
        </div>
      </div>
    </header>
  );
};

export default NavBar;
