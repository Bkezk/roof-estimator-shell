import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import { listCrmUsers, type CrmUserOption } from "@/lib/crm.functions";

/** Everyone who can be a customer's account manager (cached for the page). */
export function useCrmUsers() {
  const { session } = useAuth();
  const listFn = useServerFn(listCrmUsers);
  return useQuery<CrmUserOption[]>({
    queryKey: ["crm-users"],
    queryFn: () => listFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
}
