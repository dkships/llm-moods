import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import useHead from "@/hooks/useHead";

// Regression guards for the 404/SPA head-state rules:
// - noindex must not survive navigation onto a real route
// - removing the canonical on a 404 must not kill canonicals for the session
//   (the setter must create-if-missing, since index.html's element is gone)

const HeadProbe = ({ noindex, url }: { noindex?: boolean; url?: string }) => {
  useHead({ title: "Probe — LLM Vibes", description: "probe", url, noindex });
  return null;
};

const robotsMeta = () => document.head.querySelector('meta[name="robots"]');
const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');

const seedHead = () => {
  document.head.innerHTML = [
    '<meta name="description" content="seed">',
    '<meta property="og:title" content="seed">',
    '<meta property="og:description" content="seed">',
    '<meta property="og:url" content="seed">',
    '<meta property="og:image" content="seed">',
    '<meta name="twitter:title" content="seed">',
    '<meta name="twitter:description" content="seed">',
    '<meta name="twitter:image" content="seed">',
    '<link rel="canonical" href="https://llmvibes.ai/">',
  ].join("");
};

describe("useHead noindex/canonical head state", () => {
  beforeEach(seedHead);
  afterEach(cleanup);

  it("noindex adds a robots meta and removes the canonical link", () => {
    render(<HeadProbe noindex />);
    expect(robotsMeta()?.getAttribute("content")).toBe("noindex");
    expect(canonical()).toBeNull();
  });

  it("a later normal route removes robots and re-creates the canonical", () => {
    const { unmount } = render(<HeadProbe noindex />);
    unmount();
    render(<HeadProbe url="/dashboard" />);
    expect(robotsMeta()).toBeNull();
    expect(canonical()?.href).toBe("https://llmvibes.ai/dashboard");
  });

  it("normal routes keep updating an existing canonical", () => {
    render(<HeadProbe url="/rumors" />);
    expect(canonical()?.href).toBe("https://llmvibes.ai/rumors");
    expect(robotsMeta()).toBeNull();
  });
});
