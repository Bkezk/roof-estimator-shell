/**
 * The server read behind the Care plans tab of the Customers page (owner, Nov 23): every Roof
 * Care plan with its customer, its property and where it stands. The rules are care-plan-list.ts.
 *
 * For people with Customers access. A technician with field pages only is refused here first;
 * the database's own rule on the plan tables says the same.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import { canAccess, isFieldOnly } from "@/lib/access";
import { carePlanRow, sortCarePlans, type CarePlanRow } from "@/lib/care-plan-list";
import { chunkIds, readInChunks } from "@/lib/chunk-ids";
import { easternYmd } from "@/lib/field-day";
import { readProfile } from "@/lib/profile-cache.server";
import { plansOfSites } from "@/lib/roof-care-plan.functions";
import type { RoofCarePlan } from "@/lib/roof-care-plan";

export const CARE_PLANS_NEED = "Forbidden: Customers access required";
/** More plans than this are not read in one go: the newest are, and the list says so. */
export const CARE_PLANS_MAX = 2000;

type Sb = Parameters<typeof plansOfSites>[0];

const place = (city: string | null, state: string | null) =>
  [(city ?? "").trim(), (state ?? "").trim()].filter(Boolean).join(", ");

/** Every plan as a row of the list, in the list's order. */
export async function carePlanRows(sb: Sb, today: string): Promise<CarePlanRow[]> {
  // Which properties have a plan, and who the customer said referred them (not on the plan as
  // the property's page reads it).
  const { data: heads, error } = await sb
    .from("roof_care_plans")
    .select("id, site_id, account_id, referred_by")
    .order("created_at", { ascending: false })
    .limit(CARE_PLANS_MAX);
  if (error) throw new Error(error.message);
  if (!heads?.length) return [];
  const siteIds = [...new Set(heads.map((h) => h.site_id))];
  const accountIds = [...new Set(heads.map((h) => h.account_id))];
  const referredBy = new Map(heads.map((h) => [h.id, h.referred_by ?? ""]));

  const [parts, sites, accounts] = await Promise.all([
    Promise.all(chunkIds(siteIds).map((ids) => plansOfSites(sb, ids, { money: false }))),
    readInChunks(siteIds, (ids) =>
      sb.from("crm_sites").select("id, name, address1, city, state").in("id", ids),
    ),
    readInChunks(accountIds, (ids) => sb.from("crm_accounts").select("id, name").in("id", ids)),
  ]);
  const plans: RoofCarePlan[] = parts.flat();
  const siteOf = new Map(sites.map((s) => [s.id, s]));
  const accountOf = new Map(accounts.map((a) => [a.id, a]));

  return sortCarePlans(
    plans.map((p) => {
      const s = siteOf.get(p.site_id);
      return carePlanRow(
        p,
        {
          account_name: (accountOf.get(p.account_id)?.name ?? "").trim(),
          site_name: (s?.name ?? "").trim() || (s?.address1 ?? "").trim(),
          site_place: place(s?.city ?? null, s?.state ?? null),
          referred_by: referredBy.get(p.id) ?? "",
        },
        today,
      );
    }),
  );
}

export const listCarePlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CarePlanRow[]> => {
    const p = await readProfile(context.supabase, context.userId);
    if (!p || !canAccess(p, "customers") || isFieldOnly(p)) throw new Error(CARE_PLANS_NEED);
    return carePlanRows(context.supabase, easternYmd());
  });
