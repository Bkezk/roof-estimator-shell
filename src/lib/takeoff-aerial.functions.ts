/**
 * New takeoff › From an address (owner, Oct 27: "on the takeoffs can we expand its usage a bit,
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
import { assertPageAccess } from "@/lib/auth.functions";
import {
  aerialForAddress,
  buildingAtImpl,
  buildingAtInput,
  type AddressAerial,
  type FoundBuilding,
} from "@/lib/service-aerial.functions";

export type { AddressAerial, FoundBuilding };

/** lookupAddressAerial's input (exported for its tests). */
export const lookupAddressInput = z.object({
  address: z.string().trim().min(1).max(300),
});

/**
 * Where a free-typed address is on our map: `{ address, addressState, found, note, near }`, the
 * shape the ticket aerial answers for its address. Takeoff access (the same as creating one).
 */
export const lookupAddressAerial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => lookupAddressInput.parse(d))
  .handler(async ({ data, context }): Promise<AddressAerial> => {
    await assertPageAccess(context.supabase, context.userId, "takeoff");
    return aerialForAddress(context.supabase, data.address);
  });

/** "Pick the building on the map" for a takeoff: the outline under the tapped point. */
export const takeoffBuildingAt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => buildingAtInput.parse(d))
  .handler(async ({ data, context }): Promise<FoundBuilding> => {
    await assertPageAccess(context.supabase, context.userId, "takeoff");
    return buildingAtImpl(context.supabase, { lat: data.lat, lng: data.lng });
  });
