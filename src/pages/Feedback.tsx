import { useState, useRef } from "react";
import { ThumbsUp, ThumbsDown, Check, AlertCircle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Surface from "@/components/Surface";
import SectionHeader from "@/components/SectionHeader";
import FilterChip from "@/components/FilterChip";
import Tag from "@/components/Tag";
import useHead from "@/hooks/useHead";
import { useModelsWithLatestVibes } from "@/hooks/useVibesData";
import { useUserFeedback, useSubmitFeedback } from "@/hooks/useFeedback";
import { formatComplaintLabel } from "@/lib/vibes";

const COMMENT_MAX_LENGTH = 500;

// Complaint categories shown for negative feedback, using the same public
// taxonomy keys the rest of the site uses.
const COMPLAINT_OPTIONS = [
  "lazy_responses",
  "hallucinations",
  "refusals",
  "coding_quality",
  "speed",
  "general_drop",
  "pricing_value",
  "censorship",
  "context_window",
  "api_reliability",
  "multimodal_quality",
  "reasoning",
  "other",
] as const;

const FeedbackPage = () => {
  useHead({
    title: "Share Your Feedback — LLM Vibes",
    description:
      "Rate your experience with Claude, ChatGPT, Gemini, or Grok. Your thumbs-up or thumbs-down feeds directly into the community sentiment score.",
    url: "/feedback",
  });

  const { data: models, isLoading: modelsLoading } = useModelsWithLatestVibes();

  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [sentiment, setSentiment] = useState<"positive" | "negative" | null>(null);
  const [comment, setComment] = useState("");
  const [complaintCategory, setComplaintCategory] = useState<string | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const { data: recentFeedback, isLoading: feedbackLoading } = useUserFeedback(20);
  const submitMutation = useSubmitFeedback();

  // Default-select the first model once the list loads
  const effectiveSlug = selectedSlug || models?.[0]?.slug || "";
  const selectedModel = models?.find((m) => m.slug === effectiveSlug);

  const handleSentimentSelect = (value: "positive" | "negative") => {
    setSentiment((prev) => (prev === value ? null : value));
    if (value === "positive") {
      setComplaintCategory(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveSlug || !sentiment) return;

    submitMutation.mutate(
      {
        model_slug: effectiveSlug,
        sentiment,
        comment: comment.trim() || undefined,
        complaint_category:
          sentiment === "negative" ? complaintCategory ?? undefined : undefined,
      },
      {
        onSuccess: () => {
          setSentiment(null);
          setComment("");
          setComplaintCategory(null);
          if (commentRef.current) commentRef.current.value = "";
        },
      },
    );
  };

  const charsRemaining = COMMENT_MAX_LENGTH - comment.length;

  return (
    <div className="container py-8 sm:py-10">
      <PageHeader
        title="Share Your Feedback"
        description="Rate your experience with an LLM. Your submission feeds directly into the community sentiment score alongside scraped posts from Reddit, HN, Bluesky, X, and Mastodon."
        meta="COMMUNITY DATA SOURCE · FEEDS INTO SCORING"
      />

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Submission form ── */}
        <Surface className="flex flex-col">
          <SectionHeader title="Rate a model" meta="Pick a model, then thumbs-up or thumbs-down" />

          {/* Model selector */}
          <fieldset className="mb-6">
            <legend className="sr-only">Choose a model</legend>
            <div className="flex flex-wrap gap-2">
              {modelsLoading ? (
                <span className="text-meta text-text-tertiary">Loading models...</span>
              ) : (
                (models || []).map((m) => (
                  <FilterChip
                    key={m.id}
                    pressed={effectiveSlug === m.slug}
                    onClick={() => setSelectedSlug(m.slug)}
                  >
                    {m.name}
                  </FilterChip>
                ))
              )}
            </div>
          </fieldset>

          {/* Sentiment selector */}
          <fieldset className="mb-6">
            <legend className="mb-2 text-mono-cap text-text-tertiary">Your sentiment</legend>
            <div className="flex gap-3">
              <button
                type="button"
                aria-pressed={sentiment === "positive"}
                onClick={() => handleSentimentSelect("positive")}
                className={[
                  "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border-2 transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  sentiment === "positive"
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-transparent text-text-tertiary hover:border-primary/40 hover:text-foreground",
                ].join(" ")}
              >
                <ThumbsUp className="h-5 w-5" aria-hidden="true" />
                <span className="text-mono-cap">Thumbs Up</span>
              </button>
              <button
                type="button"
                aria-pressed={sentiment === "negative"}
                onClick={() => handleSentimentSelect("negative")}
                className={[
                  "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border-2 transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  sentiment === "negative"
                    ? "border-destructive bg-destructive/15 text-destructive-text"
                    : "border-border bg-transparent text-text-tertiary hover:border-destructive/40 hover:text-foreground",
                ].join(" ")}
              >
                <ThumbsDown className="h-5 w-5" aria-hidden="true" />
                <span className="text-mono-cap">Thumbs Down</span>
              </button>
            </div>
          </fieldset>

          {/* Complaint category (negative only) */}
          {sentiment === "negative" && (
            <fieldset className="mb-6">
              <legend className="mb-2 text-mono-cap text-text-tertiary">
                What went wrong? (optional)
              </legend>
              <div className="flex flex-wrap gap-2">
                {COMPLAINT_OPTIONS.map((cat) => (
                  <FilterChip
                    key={cat}
                    pressed={complaintCategory === cat}
                    onClick={() =>
                      setComplaintCategory((prev) => (prev === cat ? null : cat))
                    }
                  >
                    {formatComplaintLabel(cat)}
                  </FilterChip>
                ))}
              </div>
            </fieldset>
          )}

          {/* Comment */}
          <fieldset className="mb-6 flex-1">
            <legend className="mb-2 text-mono-cap text-text-tertiary">
              Comment (optional)
            </legend>
            <textarea
              ref={commentRef}
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX_LENGTH))}
              maxLength={COMMENT_MAX_LENGTH}
              rows={4}
              placeholder="Share what stood out — good or bad..."
              className={[
                "w-full resize-none rounded-lg border border-input bg-background p-3",
                "text-body text-foreground placeholder:text-text-tertiary",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ].join(" ")}
              aria-label="Optional comment"
            />
            <p className="mt-1 text-meta text-text-tertiary" aria-live="polite">
              {charsRemaining} characters remaining
            </p>
          </fieldset>

          {/* Submit + status */}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={!effectiveSlug || !sentiment || submitMutation.isPending}
              onClick={handleSubmit}
              className={[
                "flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 transition-all",
                "text-mono-cap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                effectiveSlug && sentiment && !submitMutation.isPending
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-secondary text-text-tertiary cursor-not-allowed",
              ].join(" ")}
            >
              {submitMutation.isPending ? (
                "Submitting..."
              ) : submitMutation.isSuccess ? (
                <>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Submitted — thank you!
                </>
              ) : (
                "Submit Feedback"
              )}
            </button>

            {submitMutation.isError && (
              <p className="flex items-center gap-1.5 text-meta text-destructive-text" role="alert">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Something went wrong. Please try again.
              </p>
            )}
          </div>
        </Surface>

        {/* ── Recent community feedback ── */}
        <Surface className="flex flex-col">
          <SectionHeader title="Recent feedback" meta="Latest community submissions" />

          {feedbackLoading ? (
            <div className="flex-1 space-y-3" role="status" aria-live="polite">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg bg-secondary/40"
                  aria-hidden="true"
                />
              ))}
            </div>
          ) : !recentFeedback || recentFeedback.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <p className="text-body text-text-tertiary">
                No feedback yet. Be the first to share!
              </p>
            </div>
          ) : (
            <ul className="flex-1 space-y-3">
              {recentFeedback.map((fb) => (
                <li
                  key={fb.id}
                  className="rounded-lg border border-border bg-background/50 p-3"
                >
                  <div className="flex items-start gap-3">
                    {fb.sentiment === "positive" ? (
                      <ThumbsUp
                        className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    ) : (
                      <ThumbsDown
                        className="mt-0.5 h-4 w-4 shrink-0 text-destructive-text"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-mono-cap text-foreground">
                          {fb.model_name}
                        </span>
                        <span className="text-meta text-text-tertiary">
                          {new Date(fb.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                      {fb.comment && (
                        <p className="mt-1 break-words text-body text-text-secondary">
                          {fb.comment}
                        </p>
                      )}
                      {fb.complaint_category && (
                        <div className="mt-2">
                          <Tag>{formatComplaintLabel(fb.complaint_category)}</Tag>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      </div>

      {/* How feedback feeds into scoring */}
      <section className="mt-10">
        <SectionHeader title="How your feedback is used" level="page" />
        <ol className="grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-3">
          {[
            {
              title: "Submit",
              body: "Pick a model, give a thumbs-up or thumbs-down, and optionally add a comment or complaint category.",
            },
            {
              title: "Classify",
              body: "Your submission is stored with source = community and sentiment = your vote, at full confidence — no AI classification needed.",
            },
            {
              title: "Score",
              body: "The aggregate-vibes pipeline picks it up on the next run and folds it into the daily 0–100 score alongside scraped posts.",
            },
          ].map((step, i) => (
            <li key={step.title} className="border-t border-border pt-5">
              <div className="flex items-baseline gap-3">
                <span className="text-mono-cap text-text-tertiary">0{i + 1}</span>
                <p className="text-section text-foreground">{step.title}</p>
              </div>
              <p className="mt-2.5 text-body text-text-secondary">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {selectedModel && (
        <span className="sr-only" aria-hidden="true">
          {selectedModel.name}
        </span>
      )}
    </div>
  );
};

export default FeedbackPage;
