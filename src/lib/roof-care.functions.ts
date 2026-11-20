/**
 * Roof Care plans, the server side of Admin › Settings › Roof Care plans (owner, Nov 18;
 * docs/roof-care-plans.md, lib/roof-care-price.ts).
 *
 *  - getRoofCareSettings / saveRoofCareSettings: the numbers the prices are worked from. An
 *    admin's alone (the database says the same: roof_care_settings is admin-only), because they
 *    are what a crew member costs and what each plan earns.
 *  - roofCareDrive: the round trip from the office to an address, with the routing the close-out
 *    already uses (a road router, else an estimate from the straight-line distance). The address
 *    is placed by placeAddress: the building on our own map, then the street address anywhere in
 *    the country, then the centre of its zip code, then of its town (roof-care-locate.ts; owner,
 *    Nov 18). Null when none of the four finds it: the page then says so and gives no price,
 *    never a price at a guessed distance.
 *
 * Read and written with the caller's own sign-in.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { isAdmin } from "@/lib/access";
import { censusGeocoderUrl, CENSUS_TIMEOUT_MS, parseCensusResponse } from "@/lib/address-census";
import { routedDriveVia, type RouteVia } from "@/lib/drive-route";
import { readProfile } from "@/lib/profile-cache.server";
import {
  asRoofCareSettings,
  roofCareSettingsSchema,
  type Drive,
  type RoofCareSettings,
} from "@/lib/roof-care-price";
import {
  parseTownPlace,
  parseZipPlace,
  PLACE_TIMEOUT_MS,
  state2,
  townLookupUrl,
  zip5,
  zipLookupUrl,
  type Placed,
  type PlacedBy,
} from "@/lib/roof-care-locate";
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
  /** Which router gave a routed drive: Google with the owner's key, or the free public one. */
  router?: RouteVia | null;
  /** One way, as the close-out says it: "42 mi · about 55 min each way (routed)". */
  note: string;
  /** How the address was placed. "zip" and "town" are not the building: the price is an estimate. */
  placed_by: PlacedBy;
  /** What the drive is to when it is not the building: "London, KY 40741". */
  place: string | null;
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

export type AddressInput = z.infer<typeof addressInput>;

/** A lookup's answer as JSON, or null: a slow, failing or odd answer is a miss, never a throw. */
async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Where an address is, most exact first: the building on our map, the street address anywhere in
 * the country, the centre of its zip code, the centre of its town. Null when none finds it.
 * `fetcher` is the lookups' door, so the tests answer for them.
 */
export async function placeAddress(
  sb: SupabaseClient<Database>,
  a: AddressInput,
  fetcher: (url: string, timeoutMs: number) => Promise<unknown> = fetchJson,
): Promise<Placed | null> {
  const line = addressLine(a);
  const building = await geocodeAddress(sb, line, a.state ?? null);
  if (building) return { ...building, by: "building", place: null };
  const street = parseCensusResponse(await fetcher(censusGeocoderUrl(line), CENSUS_TIMEOUT_MS));
  if (street) return { lat: street.lat, lng: street.lng, by: "street", place: null };
  const zip = zip5(a.zip);
  if (zip) {
    const z5 = parseZipPlace(await fetcher(zipLookupUrl(zip), PLACE_TIMEOUT_MS));
    if (z5) return z5;
  }
  const st = state2(a.state);
  const city = (a.city ?? "").trim();
  if (st && city) {
    const town = parseTownPlace(await fetcher(townLookupUrl(st, city), PLACE_TIMEOUT_MS));
    if (town) return town;
  }
  return null;
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
    return driveTo(sb, await officeOrigin(sb), data);
  });

/** Where the trucks leave from. Throws in plain words when the office has no street address. */
export async function officeOrigin(
  sb: SupabaseClient<Database>,
): Promise<{ line: string; state: string | null }> {
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
  return origin;
}

/** The round trip from the office at `origin` to an address; null when it cannot be placed. */
export async function driveTo(
  sb: SupabaseClient<Database>,
  origin: { line: string; state: string | null },
  a: AddressInput,
  fetcher?: (url: string, timeoutMs: number) => Promise<unknown>,
  /** A point already known for the address (the property's own, on its record): used as it is. */
  known?: { lat: number; lng: number } | null,
): Promise<RoofCareDrive | null> {
  const [from, to] = await Promise.all([
    geocodeAddressCached(sb, origin.line, origin.state),
    known
      ? Promise.resolve<Placed>({ ...known, by: "building", place: null })
      : placeAddress(sb, a, fetcher),
  ]);
  if (!from) throw new Error("The office's address could not be found on the map.");
  if (!to) return null;
  const where = { placed_by: to.by, place: to.place };
  const routed = await routedDriveVia(from, to).catch(() => null);
  const byRoad = routed ? travelFromRoute(routed.drive) : null;
  const one = byRoad ?? estimateTravelBetween(from, to);
  // The same spot as the office: nothing to drive.
  if (!one) return { hours: 0, miles: 0, source: "estimated", note: "At the office", ...where };
  return {
    ...roundTrip(one),
    source: one.source,
    router: byRoad && routed ? routed.via : null,
    note: one.note,
    ...where,
  };
}
