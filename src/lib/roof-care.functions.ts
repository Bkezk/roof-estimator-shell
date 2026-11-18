/**
 * Roof Care plans, the server side of Admin › Settings › Roof Care plans (owner, Nov 18;
 * docs/roof-care-plans.md, lib/roof-care-price.ts).
 *
 *  - getRoofCareSettings / saveRoofCareSettings: the numbers the prices are worked from. An
 *    admin's alone (the database says the same: roof_care_settings is admin-only), because they
 *    are what a crew member costs and what each plan earns.
 *  - roofCareDrive: the round trip from the office to an address, with the routing the close-out
 *    already uses (the stored map data, then the state's address server, then a road router,
 *    else an estimate from the straight-line distance). Null when the address cannot be placed:
 *    the page then says so and gives no price, never a price at a guessed distance.
 *
 * Read and written with the caller's own sign-in.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Json } from "@/integrations/supabase/types";
import { isAdmin } from "@/lib/access";
import { routedDrive } from "@/lib/drive-route";
import { readProfile } from "@/lib/profile-cache.server";
import {
  asRoofCareSettings,
  roofCareSettingsSchema,
  type Drive,
  type RoofCareSettings,
} from "@/lib/roof-care-price";
import { geocodeAddress, geocodeAddressCached } from "@/lib/service-aerial.functions";
import { estimateTravelBetween, travelFromRoute, travelOrigin } from "@/lib/travel-estimate";

export const ROOF_CARE_ADMIN_ONLY = "Only an admin sees or changes the Roof Care plan numbers";

type Ctx = { supabase: Parameters<typeof readProfile>[0]; userId: string };

async function admin(ctx: Ctx) {
  const p = await readProfile(ctx.supabase, ctx.userId);
  if (!isAdmin(p)) throw new Error(ROOF_CARE_ADMIN_ONLY);
  return p!;
}

export interface RoofCareSettingsRead {
  settings: RoofCareSettings;
  updated_at: string | null;
  updated_by_name: string | null;
}

export const getRoofCareSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RoofCareSettingsRead> => {
    await admin(context);
    const { data, error } = await context.supabase
      .from("roof_care_settings")
      .select("data, updated_at, updated_by_name")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      settings: asRoofCareSettings(data?.data),
      updated_at: data?.updated_at ?? null,
      updated_by_name: data?.updated_by_name ?? null,
    };
  });

export const saveRoofCareSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => roofCareSettingsSchema.parse(d))
  .handler(async ({ data, context }): Promise<RoofCareSettingsRead> => {
    const p = await admin(context);
    // Two rows of the hours table for the same roof size would make "the hours for that size"
    // depend on their order.
    const sizes = data.hours.map((h) => h.sqft);
    if (new Set(sizes).size !== sizes.length)
      throw new Error("Two rows of Hours on site have the same roof size. Keep one of them.");
    const by = (p.full_name ?? "").trim() || p.email || null;
    const { data: row, error } = await context.supabase
      .from("roof_care_settings")
      .upsert(
        {
          id: 1,
          data: data as unknown as Json,
          updated_at: new Date().toISOString(),
          updated_by: context.userId,
          updated_by_name: by,
        },
        { onConflict: "id" },
      )
      .select("data, updated_at, updated_by_name")
      .single();
    if (error) throw new Error(error.message);
    return {
      settings: asRoofCareSettings(row.data),
      updated_at: row.updated_at,
      updated_by_name: row.updated_by_name,
    };
  });

/** The round trip to an address, and how it was worked out. */
export interface RoofCareDrive extends Drive {
  /** "routed" along roads, or "estimated" from the straight-line distance. */
  source: "routed" | "estimated";
  /** One way, as the close-out says it: "42 mi · about 55 min each way (routed)". */
  note: string;
}

const addressInput = z.object({
  address: z.string().trim().min(3, "Type the street address").max(200),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(40).optional(),
  zip: z.string().trim().max(12).optional(),
});

/** One line for the geocoder: "12 Mill St, London, KY 40741". */
export function addressLine(a: z.infer<typeof addressInput>): string {
  const tail = [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.address, tail].filter(Boolean).join(", ");
}

/** A one-way estimate as a round trip: twice the minutes and twice the miles. */
export function roundTrip(one: { miles: number; minutes: number }): Drive {
  return {
    hours: Math.round(((one.minutes * 2) / 60) * 100) / 100,
    miles: Math.round(one.miles * 2 * 10) / 10,
  };
}

export const roofCareDrive = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => addressInput.parse(d))
  .handler(async ({ data, context }): Promise<RoofCareDrive | null> => {
    await admin(context);
    const sb = context.supabase;
    const { data: office, error } = await sb
      .from("company_settings_public")
      .select("address, city, state, zip, shop_address, shop_city, shop_state, shop_zip")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const origin = office ? travelOrigin(office) : null;
    if (!origin)
      throw new Error(
        "The office has no street address to drive from. Add it under Estimate Pricing, General.",
      );
    const [from, to] = await Promise.all([
      geocodeAddressCached(sb, origin.line, origin.state),
      geocodeAddress(sb, addressLine(data), data.state ?? null),
    ]);
    if (!from) throw new Error("The office's address could not be found on the map.");
    if (!to) return null;
    const routed = await routedDrive(from, to).catch(() => null);
    const one = (routed && travelFromRoute(routed)) ?? estimateTravelBetween(from, to);
    // The same spot as the office: nothing to drive.
    if (!one) return { hours: 0, miles: 0, source: "estimated", note: "At the office" };
    return { ...roundTrip(one), source: one.source, note: one.note };
  });
