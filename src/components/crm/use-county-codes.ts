/** The JBK county code list (lib/county-codes.ts), read once and shared by every screen. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import {
  getCountyCode,
  getCountyCodes,
  listCountyCodes,
  type CountyCode,
} from "@/lib/county-codes.functions";

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

/**
 * The codes these ids name (the property picker's rows; Nov 3): one small read keyed by the
 * ids, answered from the list first when a picker on the same screen has loaded it.
 */
export function useCountyCodesByIds(ids: readonly (string | null | undefined)[]): CountyCode[] {
  const { session } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getCountyCodes);
  const wanted = [...new Set(ids.filter((x): x is string => !!x))].sort();
  const list = qc.getQueryData<CountyCode[]>(COUNTY_CODES_KEY);
  const fromList = list ? wanted.map((id) => list.find((c) => c.id === id)) : [];
  const listHasAll = !!list && fromList.every(Boolean);
  const some = useQuery({
    queryKey: ["county-codes-by-id", wanted.join(",")],
    queryFn: () => getFn({ data: { ids: wanted } }),
    enabled: !!session && wanted.length > 0 && !listHasAll,
    staleTime: 10 * 60_000,
  });
  if (!wanted.length) return [];
  if (listHasAll) return fromList as CountyCode[];
  return some.data ?? [];
}

/**
 * The code with this id, or undefined (none, or still loading). Its own small read (Nov 3,
 * review item 38): the ticket page used to load the whole list for one line. The list, when
 * a picker on the same screen has loaded it, answers first.
 */
export function useCountyCode(id: string | null | undefined): CountyCode | undefined {
  const { session } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getCountyCode);
  const fromList = id
    ? qc.getQueryData<CountyCode[]>(COUNTY_CODES_KEY)?.find((c) => c.id === id)
    : undefined;
  const one = useQuery({
    queryKey: ["county-code", id],
    queryFn: () => getFn({ data: { id: id! } }),
    enabled: !!session && !!id && !fromList,
    staleTime: 10 * 60_000,
  });
  if (!id) return undefined;
  return fromList ?? one.data ?? undefined;
}
