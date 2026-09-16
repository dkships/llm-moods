import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FeedbackRow {
  id: string;
  model_id: string;
  model_name: string;
  model_slug: string;
  accent_color: string | null;
  sentiment: string;
  comment: string | null;
  complaint_category: string | null;
  created_at: string;
}

const QUERY_KEY = "user-feedback";

export function useUserFeedback(limit = 30) {
  return useQuery<FeedbackRow[]>({
    queryKey: [QUERY_KEY, limit],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_user_feedback", {
        p_limit: limit,
      });
      if (error) throw error;
      return (data || []) as FeedbackRow[];
    },
  });
}

export interface SubmitFeedbackArgs {
  model_slug: string;
  sentiment: "positive" | "negative";
  comment?: string;
  complaint_category?: string;
}

export function useSubmitFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: SubmitFeedbackArgs) => {
      const { data, error } = await supabase.rpc("submit_user_feedback", {
        p_model_slug: args.model_slug,
        p_sentiment: args.sentiment,
        p_comment: args.comment ?? null,
        p_complaint_category: args.complaint_category ?? null,
        p_submitter_hash: null,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}
