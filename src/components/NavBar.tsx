import { Link, useLocation } from "react-router-dom";

const NavBar = () => {
  const { pathname } = useLocation();
  const isDashboardActive = pathname === "/dashboard" || pathname.startsWith("/model/");

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" aria-label="Home" className="font-display text-lg font-bold tracking-tight text-foreground">
          🌊 LLM <span className="text-primary">Vibes</span>
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            to="/dashboard"
            className={`text-sm font-mono transition-colors ${
              isDashboardActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Dashboard
          </Link>
        </nav>
      </div>
    </header>
  );
};

export default NavBar;
