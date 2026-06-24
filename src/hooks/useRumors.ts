import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mergeRumorRows } from "../../supabase/functions/_shared/rumor-canon";

// Self-contained source reference stored in `model_rumors.representative_sources`
// (jsonb), so links survive `cleanup-old-posts` deleting the underlying row.
export interface RumorSourceRef {
  url: string;
  handle?: string | null;
  platform: string;
  snippet?: string | null;
  posted_at?: string | null;
  score?: number | null;
  verified?: boolean | null;
  followers?: number | null;
}

export type RumorClaimType =
  | "launch"
  | "in_testing"
  | "imminent"
  | "delayed"
  | "return"
  | "other";

export interface PublicRumorRow {
  model_slug: string;
  version_label: string | null;
  codename: string | null;
  claim_type: RumorClaimType;
  claim_summary: string;
  rumored_benefit: string | null;
  benefit_verified: boolean;
  signals: string | null;
  eta_text: string | null;
  eta_date: string | null;
  eta_conflicting: boolean;
  mention_count: number;
  platform_count: number;
  has_credible_source: boolean;
  representative_sources: RumorSourceRef[] | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

// Mirrors the publicRpc cast in useVibesData.ts — RLS denies a direct `.from()`
// read, so all public data flows through the SECURITY DEFINER `get_public_*` RPCs.
interface PublicRumorsRpcClient {
  rpc(
    fn: "get_public_rumors",
    args?: Record<string, never>,
  ): Promise<{ data: PublicRumorRow[] | null; error: { message: string } | null }>;
}

const publicRpc = supabase as unknown as PublicRumorsRpcClient;

// Rumors are recomputed by the aggregate-rumors cron ~2×/day; a 10-min stale
// window matches the rest of the dashboard and avoids refetch churn on revisit.
const QUERY_STALE_TIME = 10 * 60_000;

export function useRumors() {
  return useQuery<PublicRumorRow[]>({
    queryKey: ["public-rumors"],
    staleTime: QUERY_STALE_TIME,
    queryFn: async () => {
      const { data, error } = await publicRpc.rpc("get_public_rumors", {});
      if (error) throw error;
      // Collapse alias-duplicate rows (Fable/Mythos/…) and drop non-frontier
      // labels at the display layer — see _shared/rumor-canon.ts. This cleans up
      // rows already persisted under the old keys; the backend adopts the same
      // canon at write-time so new rows are clean too.
      return mergeRumorRows(data ?? []);
    },
  });
}
