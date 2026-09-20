import { Link, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
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

// Tailwind `sm` breakpoint minus one: the nav row scrolls below this width.
const NAV_SCROLL_MAX_WIDTH_PX = 639;

const NavBar = () => {
  const { pathname } = useLocation();
  const showResearchLink = RESEARCH_POSTS.length > 0;
  const isResearchActive = pathname === "/research" || pathname.startsWith("/research/");
  const isRumorsActive = pathname === "/rumors";
  const isBenchmarkActive = pathname === "/benchmark";
  const isCompareActive = pathname === "/compare";
  const isDashboardActive = pathname === "/dashboard" || pathname.startsWith("/model/");

  const activeLinkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // Only the scrolling (phone) layout needs this; on wider screens every
    // link is already visible and scrollIntoView would nudge the page.
    if (!window.matchMedia(`(max-width: ${NAV_SCROLL_MAX_WIDTH_PX}px)`).matches) return;
    activeLinkRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  const navLinkClass = (active: boolean) =>
    `inline-flex min-h-11 shrink-0 snap-start items-center rounded-md px-1.5 text-mono-cap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-0 sm:px-2 sm:py-1 ${
      active ? "bg-primary/10 text-primary" : "text-text-tertiary hover:text-foreground"
    }`;

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/55 shadow-[0_1px_0_0_hsl(0_0%_100%/0.02)]">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div className="container flex h-14 items-center justify-between gap-2 sm:h-16">
        <Link
          to="/"
          aria-label="LLM Vibes"
          className="inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:gap-2"
        >
          <SvgMark />
          {/* Five nav links leave no room for the wordmark on the narrowest
              screens (320–400px): the mark alone carries the brand there, and
              the aria-label keeps the accessible name. */}
          <span className="hidden whitespace-nowrap text-section text-foreground min-[400px]:inline">
            <span className="hidden min-[460px]:inline">LLM </span>
            <span className="text-primary">Vibes</span>
          </span>
        </Link>
        {/* Five links plus the mark crowd a phone-width bar. Below `sm` the row scrolls
            sideways (scrollbar hidden, right-edge fade as the affordance)
            and the active link scrolls itself into view on route change. */}
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <nav
            aria-label="Primary"
            className="flex items-center gap-1 overflow-x-auto snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-3 sm:overflow-visible lg:gap-5"
          >
          <Link to="/dashboard" className={navLinkClass(isDashboardActive)} ref={isDashboardActive ? activeLinkRef : undefined}>
            Dashboard
          </Link>
          <Link to="/compare" className={navLinkClass(isCompareActive)} ref={isCompareActive ? activeLinkRef : undefined}>
            Compare
          </Link>
          <Link to="/benchmark" className={navLinkClass(isBenchmarkActive)} ref={isBenchmarkActive ? activeLinkRef : undefined}>
            Benchmark
          </Link>
          {showResearchLink && (
            <Link to="/research" className={navLinkClass(isResearchActive)} ref={isResearchActive ? activeLinkRef : undefined}>
              Research
            </Link>
          )}
          <Link to="/rumors" className={navLinkClass(isRumorsActive)} ref={isRumorsActive ? activeLinkRef : undefined}>
            Rumors
          </Link>
          <a
            href="https://github.com/dkships/llm-moods"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="hidden h-11 w-11 items-center justify-center rounded-md text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:inline-flex"
          >
            <GitHubIcon className="h-5 w-5" />
          </a>
          </nav>
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent sm:hidden"
            aria-hidden="true"
          />
        </div>
      </div>
    </header>
  );
};

export default NavBar;
