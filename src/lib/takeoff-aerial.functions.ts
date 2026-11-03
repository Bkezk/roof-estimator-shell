/**
 * New takeoff › Satellite picture (was "From an address"; owner, Oct 27: "on the takeoffs can we expand its usage a bit,
 * we also want to be able to search an address, it pull up an aerial picture and we can mark it
 * up from that as well"). The lookup is the ticket aerial's (src/lib/service-aerial.functions.ts
 * aerialForAddress: our stored buildings and 911 points, then the live Kentucky / Tennessee
 * layers, then the Oct 26 by-name and nearest-number fallbacks), and "Pick the building on the
 * map" is the ticket's too (buildingAtImpl) — only the access differs: whoever may create a
 * takeoff (Takeoff access) may look an address up for one. Nothing is stored here; the browser
 * renders the picture and creates the takeoff through createTakeoff as for a screenshot.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import { canAccess } from "@/lib/access";
import { ilikePattern, orIlike } from "@/lib/account-search";
import { assertPageAccess } from "@/lib/auth.functions";
import {
  buildingAtImpl,
  buildingAtInput,
  findAddressAerial,
  pointAerial,
  type AddressAerial,
  type FindAerial,
  type FoundBuilding,
} from "@/lib/service-aerial.functions";
import {
  shapeSuggestions,
  type AddressSuggestion,
  type SuggestSiteRow,
} from "@/lib/takeoff/address-suggest";

export type { AddressAerial, FindAerial, FoundBuilding };
export type { AddressSuggestion };

/**
 * lookupAddressAerial's input (exported for its tests): the typed line — or, when the picker
 * offers several places and one is clicked, that place's point with its address line.
 */
export const lookupAddressInput = z.object({
  address: z.string().trim().min(1).max(300),
  point: buildingAtInput.optional(),
});

/**
 * Where a free-typed line is on our map (owner, Oct 27: the tolerant finder,
 * service-aerial.functions.ts findAddressAerial): `{ address, addressState, found, note, near,
 * how, candidates }`. With `point`, the footprint at that point (a clicked candidate). Takeoff
 * access (the same as creating one).
 */
export const lookupAddressAerial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => lookupAddressInput.parse(d))
  .handler(async ({ data, context }): Promise<FindAerial> => {
    await assertPageAccess(context.supabase, context.userId, "takeoff");
    if (data.point) return pointAerial(context.supabase, data.point, "picked", data.address);
    return findAddressAerial(context.supabase, data.address);
  });

/** "Pick the building on the map" for a takeoff: the outline under the tapped point. */
export const takeoffBuildingAt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => buildingAtInput.parse(d))
  .handler(async ({ data, context }): Promise<FoundBuilding> => {
    await assertPageAccess(context.supabase, context.userId, "takeoff");
    return buildingAtImpl(context.supabase, { lat: data.lat, lng: data.lng });
  });

/** suggestTakeoffAddresses' input: what is typed so far (the picker asks from 3 characters). */
export const suggestAddressInput = z.object({ q: z.string().trim().min(1).max(120) });

/**
 * Customer properties on file whose name, street or town contain `q` (owner, Nov 3: the
 * address box suggests as you type), shaped by src/lib/takeoff/address-suggest.ts. Takeoff
 * access; a user without the customer book (Customers, Service or Estimate access — the
 * properties' own read rule) gets an empty list, never an error, so the box still searches the
 * map for them.
 */
export const suggestTakeoffAddresses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => suggestAddressInput.parse(d))
  .handler(async ({ data, context }): Promise<AddressSuggestion[]> => {
    await assertPageAccess(context.supabase, context.userId, "takeoff");
    const sb = context.supabase;
    const { data: me } = await sb
      .from("profiles")
      .select("role, access")
      .eq("id", context.userId)
      .single();
    if (
      !me ||
      !(canAccess(me, "customers") || canAccess(me, "service") || canAccess(me, "estimate"))
    )
      return [];
    const like = ilikePattern(data.q);
    const { data: sites, error } = await sb
      .from("crm_sites")
      .select("id, account_id, name, address1, address2, city, state, zip, lat, lng")
      .is("deleted_at", null)
      .or(orIlike(["name", "address1", "city"], like))
      .order("name")
      .limit(40);
    if (error) throw new Error(error.message);
    const rows = (sites ?? []) as SuggestSiteRow[];
    const ids = [...new Set(rows.map((s) => s.account_id))];
    const accounts = new Map<string, string>();
    if (ids.length) {
      const { data: accs, error: aErr } = await sb
        .from("crm_accounts")
        .select("id, name")
        .in("id", ids)
        .is("deleted_at", null);
      if (aErr) throw new Error(aErr.message);
      for (const a of accs ?? []) accounts.set(a.id, a.name);
    }
    return shapeSuggestions(rows, accounts);
  });
