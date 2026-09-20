import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Vendor } from "@/data/vendor-events";
import type { StatusSeverity, VendorStatusEvent } from "@/hooks/useVendorStatus";

interface VendorIncidentRow {
  external_id: string;
  title: string;
  severity: string;
  summary: string | null;
  url: string | null;
  updated_at: string;
}

// The generated Supabase types don't know this RPC yet; the wrapper keeps the
// cast in one place, mirroring publicRpc in useVibesData.
interface IncidentRpcClient {
  rpc(
    fn: "get_public_vendor_incidents",
    args: { p_vendor: string; p_since: string; p_until: string },
  ): Promise<{ data: VendorIncidentRow[] | null; error: { message: string } | null }>;
}

const incidentRpc = supabase as unknown as IncidentRpcClient;

const SEVERITIES: ReadonlySet<string> = new Set(["critical", "major", "minor", "maintenance", "unknown"]);

function toSeverity(value: string): StatusSeverity {
  return (SEVERITIES.has(value) ? value : "unknown") as StatusSeverity;
}

/**
 * Official status-page incidents persisted by the vendor-status snapshot
 * cron, for any historical window. The live feed (`useVendorStatus`) only
 * covers the trailing month; this is what a chart pinned to last spring
 * reads. Returns the same shape as the live feed so both can feed
 * `useStatusIncidentMarkers`.
 */
export function useVendorIncidents(
  vendor: Vendor,
  sinceISO: string | undefined,
  untilISO: string | undefined,
) {
  return useQuery<VendorStatusEvent[]>({
    queryKey: ["vendor-incidents", vendor, sinceISO, untilISO],
    enabled: Boolean(sinceISO && untilISO),
    staleTime: 60 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await incidentRpc.rpc("get_public_vendor_incidents", {
        p_vendor: vendor,
        p_since: sinceISO!,
        p_until: untilISO!,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.external_id,
        title: row.title,
        updatedAt: row.updated_at,
        summary: row.summary,
        url: row.url,
        severity: toSeverity(row.severity),
      }));
    },
  });
}
