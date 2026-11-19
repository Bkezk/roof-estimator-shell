import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { FIELD_READ } from "@/components/service/field-utils";
import { useAuth } from "@/lib/auth-store";
import { roofCareCleaningKey } from "@/lib/roof-care-cleaning";
import { roofCareCleaning } from "@/lib/roof-care-cleaning.functions";

/** The plan inspection's answers for a ticket; idle (and undefined) on any other ticket. */
export function useVisitCleaning(visitId: string | null | undefined) {
  const { session } = useAuth();
  const fn = useServerFn(roofCareCleaning);
  return useQuery({
    queryKey: roofCareCleaningKey(visitId ?? ""),
    queryFn: () => fn({ data: { visit_id: visitId! } }),
    enabled: !!session && !!visitId,
    ...FIELD_READ,
  });
}
