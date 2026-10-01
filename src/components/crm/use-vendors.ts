/** The vendor list (lib/vendors.ts), read once and shared by the pickers and the Vendors tab. */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import { listVendors } from "@/lib/vendors.functions";

export const VENDORS_KEY = ["vendors"] as const;
export const vendorsKey = (includeArchived: boolean) =>
  [...VENDORS_KEY, includeArchived ? "all" : "live"] as const;

/** The vendors by name; archived ones too when asked. */
export function useVendors(includeArchived = false) {
  const { session } = useAuth();
  const listFn = useServerFn(listVendors);
  return useQuery({
    queryKey: vendorsKey(includeArchived),
    queryFn: () => listFn({ data: { includeArchived } }),
    enabled: !!session,
    staleTime: 60_000,
  });
}
