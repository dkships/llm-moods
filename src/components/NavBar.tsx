import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

const NavBar = () => {
  const { pathname } = useLocation();
  const isDashboard = pathname === "/dashboard";

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="font-display text-lg font-bold tracking-tight text-foreground">
          🌊 LLM <span className="text-primary">Vibes</span>
        </Link>
        <div className="flex items-center gap-4">
          {isDashboard ? (
            <span className="text-sm text-foreground font-medium">Dashboard</span>
          ) : (
            <Link
              to="/dashboard"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Dashboard
            </Link>
          )}
          <Button size="sm" className="font-mono text-xs">
            Report a Vibe
          </Button>
        </div>
      </div>
    </header>
  );
};

export default NavBar;
