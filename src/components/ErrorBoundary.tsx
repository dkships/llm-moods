import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

const RELOAD_FLAG = "llmvibes-chunk-reload";

// A failed dynamic import usually means the deployed bundle changed under an
// open tab (Lovable redeploy) and the old hashed chunk 404s. A reload picks up
// the new manifest and fixes it.
const isStaleChunkError = (error: unknown): boolean =>
  error instanceof Error &&
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(
    error.message,
  );

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isStaleChunkError(error) && !sessionStorage.getItem(RELOAD_FLAG)) {
      // One-shot guard: if the reload doesn't fix it, fall through to the
      // error card instead of looping.
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
      return;
    }
    console.error("Unhandled render error:", error, errorInfo.componentStack);
  }

  componentDidMount() {
    // A successful mount means any prior auto-reload worked; clear the
    // one-shot flag so the next redeploy can trigger its own single reload.
    if (!this.state.hasError) sessionStorage.removeItem(RELOAD_FLAG);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="max-w-md rounded-lg border border-border bg-secondary/30 px-8 py-10 text-center">
            <p className="text-page text-foreground mb-3">Something went wrong</p>
            <p className="text-body text-text-secondary mb-8">
              The page hit an unexpected error. Reloading usually fixes it.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-border px-4 py-2 font-mono text-sm text-foreground transition-colors hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
