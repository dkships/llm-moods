import { useState } from "react";
import { ThumbsUp, ThumbsDown, Meh, Send, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const SENTIMENTS = [
  { value: "positive", icon: ThumbsUp, label: "Good vibes" },
  { value: "neutral", icon: Meh, label: "Meh" },
  { value: "negative", icon: ThumbsDown, label: "Bad vibes" },
] as const;

const CATEGORIES = [
  { value: "lazy_responses", label: "Lazy / short responses" },
  { value: "hallucinations", label: "Hallucinations" },
  { value: "refusals", label: "Over-refusals" },
  { value: "coding_quality", label: "Bad coding quality" },
  { value: "speed", label: "Slow responses" },
  { value: "general_drop", label: "General quality drop" },
];

interface Props {
  modelId: string;
  modelName: string;
  accent: string;
}

const UserReportForm = ({ modelId, modelName, accent }: Props) => {
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!sentiment) return;
    setSubmitting(true);
    const { error } = await supabase.from("user_reports").insert({
      model_id: modelId,
      sentiment,
      comment: comment.trim() || null,
      complaint_category: category,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Error", description: "Failed to submit report.", variant: "destructive" });
      return;
    }
    setSubmitted(true);
  };

  return (
    <motion.div
      className="glass rounded-xl p-6"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35, duration: 0.45 }}
    >
      <AnimatePresence mode="wait">
        {submitted ? (
          <motion.div
            key="thanks"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3 py-4"
          >
            <div className="h-10 w-10 rounded-full flex items-center justify-center" style={{ background: accent + "22" }}>
              <Check className="h-5 w-5" style={{ color: accent }} />
            </div>
            <p className="text-sm font-mono text-foreground">Thanks! Your report was recorded.</p>
          </motion.div>
        ) : (
          <motion.div key="form" exit={{ opacity: 0 }} className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              How does {modelName} feel right now?
            </h2>

            {/* Sentiment selector */}
            <div className="flex gap-2">
              {SENTIMENTS.map((s) => {
                const active = sentiment === s.value;
                return (
                  <button
                    key={s.value}
                    onClick={() => setSentiment(s.value)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono transition-all border ${
                      active
                        ? "border-border bg-secondary text-foreground"
                        : "border-transparent bg-secondary/40 text-muted-foreground hover:bg-secondary/60"
                    }`}
                  >
                    <s.icon className="h-4 w-4" />
                    {s.label}
                  </button>
                );
              })}
            </div>

            {/* Optional complaint category */}
            {sentiment === "negative" && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                <p className="text-xs text-muted-foreground font-mono mb-2">What's the issue?</p>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setCategory(category === c.value ? null : c.value)}
                      className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors border ${
                        category === c.value
                          ? "border-border bg-secondary text-foreground"
                          : "border-transparent bg-secondary/40 text-muted-foreground hover:bg-secondary/60"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Optional comment */}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 280))}
              placeholder="Optional: share more detail..."
              rows={2}
              className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-mono">{comment.length}/280</span>
              <button
                onClick={handleSubmit}
                disabled={!sentiment || submitting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed text-foreground"
                style={{
                  background: sentiment ? accent + "22" : undefined,
                  borderColor: sentiment ? accent + "44" : undefined,
                  border: `1px solid ${sentiment ? accent + "44" : "transparent"}`,
                }}
              >
                <Send className="h-3.5 w-3.5" />
                {submitting ? "Sending..." : "Submit"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default UserReportForm;
