import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Vendor } from "@/data/vendor-events";

export type StatusSeverity =
  | "critical"
  | "major"
  | "minor"
  | "maintenance"
  | "unknown";

export interface VendorStatusEvent {
  id: string;
  title: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
  summary: string | null;
  url: string | null;
  severity: StatusSeverity;
}

export interface VendorStatusResponse {
  vendor: Vendor;
  supported: boolean;
  fetchedAt: string;
  events: VendorStatusEvent[];
  publicUrl?: string;
  message?: string;
  error?: string;
}

export function useVendorStatus(vendor: Vendor) {
  return useQuery<VendorStatusResponse>({
    queryKey: ["vendor-status", vendor],
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: false,
    retry: 1,
    retryDelay: 3000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<VendorStatusResponse>(
        "fetch-vendor-status",
        { body: { vendor } },
      );
      if (error) throw error;
      if (!data) throw new Error("Empty response from fetch-vendor-status");
      return data;
    },
  });
}
