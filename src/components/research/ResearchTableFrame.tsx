import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ResearchTableFrameProps {
  label: string;
  children: ReactNode;
}

const ResearchTableFrame = ({ label, children }: ResearchTableFrameProps) => {
  const hintId = useId();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edgeState, setEdgeState] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    setEdgeState({
      left: scroller.scrollLeft > 2,
      right: maxScrollLeft - scroller.scrollLeft > 2,
    });
  }, []);

  useEffect(() => {
    updateEdges();
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(scroller);
    if (scroller.firstElementChild)
      observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [updateEdges]);

  return (
    <div className="relative my-6">
      {edgeState.right && (
        <div
          id={hintId}
          className="mb-2 text-mono-cap text-text-tertiary sm:hidden"
        >
          Swipe to view all columns
        </div>
      )}
      <div
        ref={scrollerRef}
        role="region"
        aria-label={label}
        aria-describedby={edgeState.right ? hintId : undefined}
        tabIndex={0}
        onScroll={updateEdges}
        className="scrollbar-thin overflow-x-auto overscroll-x-contain rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_table]:min-w-[640px] sm:[&_table]:min-w-full"
      >
        {children}
      </div>
      {edgeState.left && (
        <div
          className="pointer-events-none absolute bottom-px left-px top-7 w-8 rounded-l-lg bg-gradient-to-r from-background to-transparent sm:top-px"
          aria-hidden="true"
        />
      )}
      {edgeState.right && (
        <div
          className="pointer-events-none absolute bottom-px right-px top-7 w-10 rounded-r-lg bg-gradient-to-l from-background to-transparent sm:top-px"
          aria-hidden="true"
        />
      )}
    </div>
  );
};

export default ResearchTableFrame;
