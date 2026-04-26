import { useParams } from "react-router-dom";
import { getResearchPost } from "@/data/research-posts";

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Dev-only preview surface that renders a 1200x630 OG card for a research post.
 * Captured via Chrome DevTools MCP and saved to public/research/<slug>/og.png.
 *
 * Layout is fixed-pixel and sits at <main>'s top-left so a 1200x630 viewport
 * screenshot lines up exactly with the card.
 *
 * NOTE: This file is intentionally decoupled from the runtime CSS-var theme.
 * Reading `hsl(var(--primary))` at capture time is fragile across viewport
 * changes and headless DOM-to-image paths, so colors are pinned in OG_THEME
 * below. Values match the runtime palette numerically; if the runtime theme
 * shifts, update OG_THEME by hand and re-capture each PNG.
 */
const OG_THEME = {
  accentGreen: "hsl(142 71% 45%)",
  claudeOrange: "hsl(20 90% 60%)",
  bgTop: "#0e1115",
  bgBottom: "#14181d",
  text: "white",
  textMuted: "rgba(255,255,255,0.72)",
  textSubtle: "rgba(255,255,255,0.55)",
  textFaint: "rgba(255,255,255,0.5)",
  borderFaint: "rgba(255,255,255,0.18)",
} as const;

const OgPreview = () => {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getResearchPost(slug) : undefined;

  if (!post) {
    return (
      <div style={{ width: 1200, height: 630, display: "flex", alignItems: "center", justifyContent: "center", background: OG_THEME.bgTop, color: OG_THEME.text, fontFamily: "monospace" }}>
        Post not found: {slug}
      </div>
    );
  }

  const accent = post.relatedModelSlug === "claude" ? OG_THEME.claudeOrange : OG_THEME.accentGreen;
  const tags = post.tags.slice(0, 3);

  return (
    <div
      style={{
        width: 1200,
        height: 630,
        position: "fixed",
        top: 0,
        left: 0,
        background:
          `radial-gradient(circle at 80% 20%, ${OG_THEME.accentGreen}1a, transparent 55%), linear-gradient(180deg, ${OG_THEME.bgTop} 0%, ${OG_THEME.bgBottom} 100%)`,
        color: OG_THEME.text,
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        padding: 64,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 36 }}>🌊</span>
          <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>
            LLM <span style={{ color: OG_THEME.accentGreen }}>Vibes</span>
          </span>
          <span
            style={{
              marginLeft: 12,
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${OG_THEME.accentGreen}55`,
              background: `${OG_THEME.accentGreen}1a`,
              color: OG_THEME.accentGreen,
              fontSize: 14,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Research
          </span>
        </div>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 18,
            color: OG_THEME.textFaint,
            letterSpacing: "0.02em",
          }}
        >
          llmvibes.ai
        </span>
      </div>

      {/* Title + summary */}
      <div style={{ maxWidth: 980 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.06,
            letterSpacing: "-0.02em",
          }}
        >
          {post.title}
        </h1>
        <p
          style={{
            marginTop: 28,
            fontSize: 24,
            lineHeight: 1.45,
            color: OG_THEME.textMuted,
            maxWidth: 920,
          }}
        >
          {post.summary}
        </p>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 10 }}>
          {tags.map((tag) => (
            <span
              key={tag}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: `1px solid ${OG_THEME.borderFaint}`,
                color: OG_THEME.textMuted,
                fontSize: 14,
                fontFamily: "'JetBrains Mono', monospace",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
        <div style={{ textAlign: "right" }}>
          <p
            style={{
              margin: 0,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 16,
              color: OG_THEME.textSubtle,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {formatDate(post.publishedAt)}
          </p>
          <div
            style={{
              marginTop: 14,
              width: 220,
              height: 6,
              borderRadius: 4,
              background: `linear-gradient(90deg, ${accent} 0%, ${OG_THEME.accentGreen} 100%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default OgPreview;
