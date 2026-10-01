/** The JBK county code list (lib/county-codes.ts), read once and shared by every screen. */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import { listCountyCodes, type CountyCode } from "@/lib/county-codes.functions";

export const COUNTY_CODES_KEY = ["county-codes"] as const;

export function useCountyCodes() {
  const { session } = useAuth();
  const listFn = useServerFn(listCountyCodes);
  return useQuery({
    queryKey: COUNTY_CODES_KEY,
    queryFn: () => listFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
}

/** The code with this id from the list, or undefined (none, or still loading). */
export function useCountyCode(id: string | null | undefined): CountyCode | undefined {
  const list = useCountyCodes().data;
  return id ? list?.find((c) => c.id === id) : undefined;
}
