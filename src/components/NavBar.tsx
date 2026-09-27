import { Link, useLocation } from "react-router-dom";
import { useEffect, useId, useState } from "react";
import { Menu, X } from "lucide-react";
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

interface NavItem {
  to: string;
  label: string;
  isActive: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", isActive: (p) => p === "/dashboard" || p.startsWith("/model/") },
  { to: "/compare", label: "Compare", isActive: (p) => p === "/compare" },
  { to: "/benchmark", label: "Benchmark", isActive: (p) => p === "/benchmark" },
  { to: "/research", label: "Research", isActive: (p) => p === "/research" || p.startsWith("/research/") },
  { to: "/rumors", label: "Rumors", isActive: (p) => p === "/rumors" },
];

const GITHUB_URL = "https://github.com/dkships/llm-moods";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const NavBar = () => {
  const { pathname } = useLocation();
  const menuId = useId();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const items = NAV_ITEMS.filter((item) => item.to !== "/research" || RESEARCH_POSTS.length > 0);
  const activeItem = items.find((item) => item.isActive(pathname));

  // A new page closes the phone menu.
  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  // Escape closes it too.
  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMenuOpen]);

  const desktopLinkClass = (active: boolean) =>
    `inline-flex shrink-0 items-center rounded-md px-2 py-1 text-mono-cap transition-colors ${FOCUS_RING} ${
      active ? "bg-primary/10 text-primary" : "text-text-tertiary hover:text-foreground"
    }`;

  const menuLinkClass = (active: boolean) =>
    `flex min-h-11 items-center rounded-md px-3 text-mono-cap transition-colors ${FOCUS_RING} ${
      active ? "bg-primary/10 text-primary" : "text-text-secondary hover:text-foreground"
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
          className={`inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-md sm:gap-2 ${FOCUS_RING}`}
        >
          <SvgMark />
          <span className="whitespace-nowrap text-section text-foreground">
            LLM <span className="text-primary">Vibes</span>
          </span>
        </Link>

        {/* Wide screens: every link in one row. */}
        <nav aria-label="Primary" className="hidden items-center gap-3 sm:flex lg:gap-5">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={desktopLinkClass(item.isActive(pathname))}
              aria-current={item.isActive(pathname) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className={`inline-flex h-11 w-11 items-center justify-center rounded-md text-text-tertiary transition-colors hover:text-foreground ${FOCUS_RING}`}
          >
            <GitHubIcon className="h-5 w-5" />
          </a>
        </nav>

        {/* Phones: five labels don't fit beside the wordmark, so the row
            collapses to one button naming the current page. */}
        <button
          type="button"
          aria-expanded={isMenuOpen}
          aria-controls={menuId}
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          onClick={() => setIsMenuOpen((open) => !open)}
          className={`inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 text-mono-cap text-text-secondary transition-colors hover:text-foreground sm:hidden ${FOCUS_RING}`}
        >
          {activeItem ? <span className="text-primary">{activeItem.label}</span> : <span>Menu</span>}
          {isMenuOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      {isMenuOpen && (
        <nav id={menuId} aria-label="Primary" className="border-t border-border/80 sm:hidden">
          <ul className="container flex flex-col gap-1 py-3">
            {items.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={menuLinkClass(item.isActive(pathname))}
                  aria-current={item.isActive(pathname) ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`${menuLinkClass(false)} gap-2`}
              >
                <GitHubIcon className="h-4 w-4" />
                GitHub
              </a>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
};

export default NavBar;
