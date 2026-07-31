import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import PublicLayout from "./components/PublicLayout";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ModelDetail = lazy(() => import("./pages/ModelDetail"));
const Benchmark = lazy(() => import("./pages/Benchmark"));
const ResearchIndex = lazy(() => import("./pages/ResearchIndex"));
const ResearchPost = lazy(() => import("./pages/ResearchPost"));
const Rumors = lazy(() => import("./pages/Rumors"));
const Privacy = lazy(() => import("./pages/Privacy"));

// Admin / generator pages are dev-only — production bundles physically exclude
// the lazy import below thanks to Vite tree-shaking on the `import.meta.env.DEV`
// flag. See AGENTS.md: public route inventory stays fixed to /, /dashboard,
// /model/:slug, /benchmark, /research, /research/:slug, /rumors, /privacy, *.
const ScraperMonitor = import.meta.env.DEV
  ? lazy(() => import("./pages/ScraperMonitor"))
  : null;
const OgPreview = import.meta.env.DEV
  ? lazy(() => import("./pages/OgPreview"))
  : null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live scores update at most every few hours; skip the default
      // refetch-on-focus that would hot-fetch every tab focus.
      refetchOnWindowFocus: false,
    },
  },
});

const PageFallback = () => (
  <div className="min-h-svh bg-background">
    <div className="container pt-24" role="status" aria-live="polite">
      <div className="h-8 w-40 animate-pulse rounded bg-secondary/60" />
    </div>
  </div>
);

const ScrollToTop = () => {
  const { pathname } = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });

    // Scrolling alone leaves keyboard/screen-reader focus on whatever <Link>
    // was just clicked — now off-screen — so the next Tab resumes from the old
    // page's position. Move focus to <main> (tabIndex={-1} in PublicLayout) on
    // client navigations only; stealing focus on first paint would fight the
    // browser's own restoration and skip the skip-link.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [pathname]);

  return null;
};

const AnimatedRoutes = () => {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Index />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="model/:slug" element={<ModelDetail />} />
          <Route path="benchmark" element={<Benchmark />} />
          <Route path="research" element={<ResearchIndex />} />
          <Route path="research/:slug" element={<ResearchPost />} />
          <Route path="rumors" element={<Rumors />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        {ScraperMonitor && (
          <Route path="/admin/scrapers" element={<Suspense fallback={<PageFallback />}><ScraperMonitor /></Suspense>} />
        )}
        {OgPreview && (
          <Route path="/og/:slug" element={<Suspense fallback={<PageFallback />}><OgPreview /></Suspense>} />
        )}
      </Routes>
    </>
  );
};

// No TooltipProvider: nothing in the public route tree renders a <Tooltip>
// (the only Radix tooltip consumers are the unused ui/chart and ui/sidebar
// scaffolds), so it only pulled @radix-ui/react-tooltip into the entry chunk.
const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ErrorBoundary>
        <AnimatedRoutes />
      </ErrorBoundary>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
