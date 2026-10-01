/** The lead source list (lib/lead-sources.ts), read once and shared (the form and Settings). */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import { listLeadSources } from "@/lib/lead-sources.functions";

export const LEAD_SOURCES_KEY = ["lead-sources"] as const;

export function useLeadSources() {
  const { session } = useAuth();
  const listFn = useServerFn(listLeadSources);
  return useQuery({
    queryKey: LEAD_SOURCES_KEY,
    queryFn: () => listFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
}
