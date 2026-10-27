/**
 * The takeoff's reads of the estimator's pricing data, under the estimator's own query keys so
 * the two share one cache: the engine admin snapshot (`useEngineAdmin`; the Setup tab, the drain
 * picks and the material picker) and the whole price list as search items
 * (`useCatalogSearchItems`; ./material-picker.tsx). The three catalogs are not in the admin
 * snapshot (`EngineAdminData` keeps only the derived ref data), so they come from the estimator's
 * own server fns — "accessory-catalog", "accessory-labor-lookup", "metals-catalog",
 * "nondl-catalog" — exactly as src/routes/estimate.tsx reads them.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import {
  getAccessoryCatalog,
  getAccessoryLaborLookup,
  getEngineAdminData,
  getMetalsCatalog,
  getNonDlCatalog,
} from "@/lib/engine.functions";
import { catalogSearchItems, type CatalogSearchItem } from "@/lib/takeoff/material";

const STALE_MS = 5 * 60_000;

/** The admin data query (same key as the estimator, so it is shared). */
export function useEngineAdmin() {
  const { session } = useAuth();
  const getAdminFn = useServerFn(getEngineAdminData);
  return useQuery({
    queryKey: ["engine-admin"],
    queryFn: () => getAdminFn(),
    enabled: !!session,
    staleTime: STALE_MS,
  });
}

/**
 * The whole price list as search items. `ready` is true once every source has answered (loaded
 * or failed); `errors` names the sources that failed, `firstError` the first failure.
 */
export function useCatalogSearchItems(): {
  items: CatalogSearchItem[];
  ready: boolean;
  errors: string[];
  firstError: unknown;
} {
  const { session } = useAuth();
  const enabled = !!session;
  const admin = useEngineAdmin();
  const getAccFn = useServerFn(getAccessoryCatalog);
  const getAccLaborFn = useServerFn(getAccessoryLaborLookup);
  const getMetalsFn = useServerFn(getMetalsCatalog);
  const getNonDlFn = useServerFn(getNonDlCatalog);
  const acc = useQuery({
    queryKey: ["accessory-catalog"],
    queryFn: () => getAccFn(),
    enabled,
    staleTime: STALE_MS,
  });
  const labor = useQuery({
    queryKey: ["accessory-labor-lookup"],
    queryFn: () => getAccLaborFn(),
    enabled,
    staleTime: STALE_MS,
  });
  const metals = useQuery({
    queryKey: ["metals-catalog"],
    queryFn: () => getMetalsFn(),
    enabled,
    staleTime: STALE_MS,
  });
  const nonDl = useQuery({
    queryKey: ["nondl-catalog"],
    queryFn: () => getNonDlFn(),
    enabled,
    staleTime: STALE_MS,
  });
  const queries = [
    ["the pricing data", admin],
    ["the accessories catalog", acc],
    ["the accessory labor table", labor],
    ["the metals catalog", metals],
    ["the Non-DL catalog", nonDl],
  ] as const;
  const failed = queries.filter(([, q]) => q.isError);
  const errors = failed.map(([name]) => name);
  const firstError: unknown = failed[0]?.[1].error;
  const ready = queries.every((q) => q[1].isSuccess || q[1].isError);
  const items = useMemo(
    () =>
      catalogSearchItems({
        admin: admin.data,
        accessories: acc.data,
        accessoryLabor: labor.data,
        metals: metals.data,
        nonDl: nonDl.data,
      }),
    [admin.data, acc.data, labor.data, metals.data, nonDl.data],
  );
  return { items, ready, errors, firstError };
}
