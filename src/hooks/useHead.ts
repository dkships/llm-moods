import { useEffect } from "react";

interface HeadConfig {
  title: string;
  description?: string;
  url?: string;
  /**
   * Optional JSON-LD structured data block. Injected into a single
   * <script id="page-json-ld" type="application/ld+json"> tag in the
   * document head. Cleared automatically on routes that don't pass one.
   */
  jsonLd?: Record<string, unknown>;
}

const BASE_URL = "https://llmvibes.ai";
const DEFAULT_DESCRIPTION =
  "Track community sentiment for Claude, ChatGPT, Gemini, and Grok. Is your AI having a bad day? Find out instantly.";

const JSON_LD_ID = "page-json-ld";

function setMetaContent(selector: string, content: string) {
  const el = document.querySelector<HTMLMetaElement>(selector);
  if (el) el.content = content;
}

function setLinkHref(selector: string, href: string) {
  const el = document.querySelector<HTMLLinkElement>(selector);
  if (el) el.href = href;
}

function setJsonLd(data: Record<string, unknown> | undefined) {
  const existing = document.getElementById(JSON_LD_ID);
  if (!data) {
    if (existing) existing.remove();
    return;
  }
  if (existing) {
    existing.textContent = JSON.stringify(data);
    return;
  }
  const script = document.createElement("script");
  script.id = JSON_LD_ID;
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

const useHead = ({ title, description, url, jsonLd }: HeadConfig) => {
  useEffect(() => {
    const desc = description ?? DEFAULT_DESCRIPTION;
    const fullUrl = url ? `${BASE_URL}${url}` : BASE_URL;

    document.title = title;

    setMetaContent('meta[name="description"]', desc);
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', desc);
    setMetaContent('meta[property="og:url"]', fullUrl);
    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', desc);

    setLinkHref('link[rel="canonical"]', fullUrl);
    setJsonLd(jsonLd);
  }, [title, description, url, jsonLd]);
};

export default useHead;
