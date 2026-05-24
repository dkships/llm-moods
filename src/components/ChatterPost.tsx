import { memo } from "react";
import Surface from "@/components/Surface";
import Tag from "@/components/Tag";
import { formatTimeAgo, formatSourceDisplay, decodeHTMLEntities } from "@/lib/vibes";

interface ChatterPostProps {
  post: {
    id: string;
    source: string;
    source_url?: string | null;
    title?: string | null;
    content?: string | null;
    translated_content?: string | null;
    original_language?: string | null;
    posted_at?: string | null;
    models?: { name?: string | null } | null;
  };
  /** Extra meta segment to insert before the timestamp (e.g. product surface). */
  extraMeta?: string | null;
  /** Hide the model attribution (e.g. on a single-model page where it's implicit). */
  hideModel?: boolean;
}

function getSafeExternalUrl(sourceUrl?: string | null): string | undefined {
  if (!sourceUrl) return undefined;
  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const ChatterPost = memo(({ post, extraMeta, hideModel = false }: ChatterPostProps) => {
  const src = formatSourceDisplay(post.source);
  const sourceUrl = getSafeExternalUrl(post.source_url);

  const metaPieces = [
    `${src.emoji} ${src.label}`,
    hideModel ? null : post.models?.name ?? null,
    extraMeta ?? null,
    post.posted_at ? formatTimeAgo(post.posted_at) : null,
  ].filter(Boolean) as string[];

  const content = (
    <div className="flex flex-col gap-2">
      <p className="text-mono-cap text-text-tertiary">
        {metaPieces.join(" · ")}
      </p>
      <p className="line-clamp-2 text-body text-foreground">
        {decodeHTMLEntities(post.translated_content || post.content || post.title || "")}
        {post.original_language && (
          <Tag className="ml-1.5">
            Translated from {post.original_language.toUpperCase()}
          </Tag>
        )}
      </p>
    </div>
  );

  if (sourceUrl) {
    return (
      <Surface
        as="a"
        size="compact"
        motion="fade"
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {content}
      </Surface>
    );
  }

  return (
    <Surface size="compact" motion="fade">
      {content}
    </Surface>
  );
});
ChatterPost.displayName = "ChatterPost";

export default ChatterPost;
