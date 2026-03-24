import { useEffect } from "react";

interface HeadConfig {
  title: string;
  description?: string;
  url?: string;
}

const BASE_URL = "https://llmvibes.ai";
const DEFAULT_DESCRIPTION =
  "Track real-time community sentiment for Claude, ChatGPT, Gemini, and Grok. Is your AI having a bad day? Find out instantly.";

function setMetaContent(selector: string, content: string) {
  const el = document.querySelector<HTMLMetaElement>(selector);
  if (el) el.content = content;
}

function setLinkHref(selector: string, href: string) {
  const el = document.querySelector<HTMLLinkElement>(selector);
  if (el) el.href = href;
}

const useHead = ({ title, description, url }: HeadConfig) => {
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
  }, [title, description, url]);
};

export default useHead;
