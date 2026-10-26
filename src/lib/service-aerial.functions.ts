/**
 * The ticket's Aerial section (owner, Sep 30): the property from our map data, annotated by the
 * tech, saved as a PNG on the ticket (service_job_photos, role 'aerial') with the vector markup
 * beside it (service_job_photos.annotations) so it re-opens for editing.
 *
 * Finding the building: the ticket's address (site_address, or its site's) is matched against
 * the stored buildings and Kentucky's 911 address points (src/lib/aerial-address.ts decides;
 * two read-only SQL functions fetch the candidates for Service users, whose RLS does not reach
 * the Prospecting tables); the matched point is put on a building outline. Nothing stored for
 * the address → the same lookup on the live state layers (owner, Oct 9: our map data was loaded
 * with a 5,000 sq ft floor, so a small property's aerial must find its building on the state
 * server, with no size floor; `liveAddressLookup`). No address match → the ticket's own photo
 * GPS, if any; else the tech picks the building on the map (`aerialBuildingAt`). Customer sites
 * carry no lat/lng of their own.
 *
 * Nothing here creates repairs or bids. Access: Service; a technician saves only on their own
 * tickets (RLS + the checks here).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { canAccess, isOffice } from "@/lib/access";
import {
  cityVariants,
  foundByNameNote,
  type NamedPoint,
  nameSearchStems,
  nearNote,
  nearestOnStreet,
  pickByName,
} from "@/lib/aerial-fallbacks";
import {
  buildingForPoint,
  parseStreetAddress,
  pickAddressMatch,
  streetFilterWord,
  type AddressCandidate,
  type NearBuilding,
  type ParsedAddress,
} from "@/lib/aerial-address";
import { footprintAreaSqFt, footprintPolygons } from "@/lib/aerial-geo";
import {
  markupSchema,
  parseMarkup,
  type AerialBuilding,
  type AerialMarkup,
} from "@/lib/aerial-markup";
import { siteAddressLine } from "@/lib/crm.functions";
import { parseLooseJson } from "@/lib/loose-json";
import {
  KY_FOOTPRINTS_LAYER,
  addressPointFromFeature,
  addressPointsByAddressUrl,
  footprintAtPointUrl,
  footprintFromFeature,
  pointInFootprint,
  type FootprintCandidate,
  addressPointsOnStreetUrl,
  landmarksByNameUrl,
} from "@/lib/gis/ky-layers";
import { USA_STRUCTURES_LAYER, structuresByAddressUrl } from "@/lib/gis/tn-layers";
import type { ArcGisFeatureSet } from "@/lib/gis/arcgis";
import { nearKyTnLine, stateCode, stateForPoint } from "@/lib/prospect";

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
export type AerialPhotoRow = Database["public"]["Tables"]["service_job_photos"]["Row"];

async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data || !(canAccess(data, "service") || canAccess(data, "customers")))
    throw new Error("Forbidden: Service access required");
  return data;
}
const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;

/** The ticket, readable by the caller (RLS: a technician sees their own). */
async function readJob(ctx: Ctx, id: string) {
  const { data: job, error } = await ctx.supabase
    .from("service_jobs")
    .select("id, number, site_id, site_address, site_name, account_id, technician_id, stage")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Ticket not found");
  return job;
}

/** A building on the aerial, as the client draws it. */
export interface FoundBuilding extends AerialBuilding {
  lat: number;
  lng: number;
  /** From the geometry; a footprint, not a roof measurement. */
  areaSqFt: number | null;
}

export interface TicketAerial {
  /** The address the lookup used ("" when the ticket has none). */
  address: string;
  /** The address's state (the site's state column, else the line's). */
  addressState: "KY" | "TN" | null;
  /** The last saved markup and its PNG. */
  saved: {
    photo: AerialPhotoRow;
    markup: AerialMarkup;
  } | null;
  /** The lookup's result when nothing is saved (or to re-centre): null = nothing found. */
  found: FoundBuilding | null;
  /** Why nothing was found, for the "No aerial for this address" line. */
  note: string | null;
  /**
   * Nothing found, but the state has points on that street in that town (owner, Oct 26): where
   * "Pick the building" opens, with the note naming the numbers found.
   */
  near?: { lat: number; lng: number } | null;
}

const toFound = (
  b: NearBuilding,
  how: AerialBuilding["how"],
  fallback: { lat: number; lng: number },
): FoundBuilding => {
  const polys = footprintPolygons(b.footprint);
  const fp = polys.length ? (b.footprint as AerialBuilding["footprint"]) : null;
  const st = stateCode(b.state);
  return {
    id: b.id,
    footprint: fp,
    address: [b.address1, b.city].filter((x) => x && x.trim()).join(", ") || null,
    state: st === "KY" || st === "TN" ? st : null,
    how,
    lat: b.centroid_lat ?? fallback.lat,
    lng: b.centroid_lng ?? fallback.lng,
    areaSqFt: footprintAreaSqFt(polys),
  };
};

async function buildingsNear(ctx: Ctx, lat: number, lng: number, radiusM: number) {
  const { data, error } = await ctx.supabase.rpc("service_aerial_buildings_near", {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: radiusM,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as NearBuilding[];
}

/**
 * Where an address is, by the chain the header describes: our stored buildings and 911 points
 * (the read-only rpc; pickAddressMatch decides), then the live state layers when nothing stored
 * matches. One place for the aerial AND the travel estimate (owner, Oct 9; service-field
 * .functions.ts estimateTravel), so both find the same spot for the same address.
 */
type AddressLocation =
  | { kind: "stored"; candidate: AddressCandidate; at: { lat: number; lng: number } }
  | { kind: "ambiguous"; count: number }
  | { kind: "live"; live: LiveFound }
  | { kind: "near"; near: { lat: number; lng: number }; note: string }
  | { kind: "none" };

async function locateAddress(
  sb: SupabaseClient<Database>,
  parsed: ParsedAddress,
  word: string,
  addressState: "KY" | "TN" | null,
  /** The property's name, for the by-name fallback (owner, Oct 26). */
  propertyName: string | null = null,
): Promise<AddressLocation> {
  const { data: cands, error } = await sb.rpc("service_aerial_address_candidates", {
    p_house: parsed.house,
    p_street_word: word,
    p_limit: 80,
  });
  if (error) throw new Error(error.message);
  const m = pickAddressMatch(parsed, (cands ?? []) as AddressCandidate[]);
  if (m.outcome === "match")
    return {
      kind: "stored",
      candidate: m.candidate,
      at: { lat: m.candidate.lat!, lng: m.candidate.lng! },
    };
  if (m.outcome === "ambiguous") return { kind: "ambiguous", count: m.count };
  // Nothing stored for it: the live state layers, which carry every building.
  const live = await liveAddressLookup(parsed, word, addressState, propertyName);
  if (!live) return { kind: "none" };
  return live.kind === "found" ? { kind: "live", live: live.live } : live;
}

/**
 * An address line → its point, or null when it cannot be read, matches nothing (or several
 * places) in our data and on the state layers, or the state server is down. Never throws for a
 * miss; only a failing database read does. `stateHint`: the site's state column when known.
 */
export async function geocodeAddress(
  sb: SupabaseClient<Database>,
  address: string,
  stateHint: string | null,
): Promise<{ lat: number; lng: number } | null> {
  const parsed = parseStreetAddress(address);
  const word = parsed ? streetFilterWord(parsed) : null;
  if (!parsed || !word) return null;
  const st = stateCode(stateHint) ?? parsed.state ?? null;
  const where = await locateAddress(sb, parsed, word, st === "KY" || st === "TN" ? st : null);
  if (where.kind === "stored") return where.at;
  if (where.kind === "live") return { lat: where.live.found.lat, lng: where.live.found.lng };
  return null;
}

/**
 * geocodeAddress with the hits kept for the life of the server process, keyed by the address
 * line: the office's address is the same on every ticket (owner, Oct 9). A miss is not kept, so
 * a state server that was down is asked again next time.
 */
const geocodeHits = new Map<string, { lat: number; lng: number }>();
export async function geocodeAddressCached(
  sb: SupabaseClient<Database>,
  address: string,
  stateHint: string | null,
): Promise<{ lat: number; lng: number } | null> {
  const key = `${address.trim().toUpperCase()}|${stateCode(stateHint) ?? ""}`;
  const hit = geocodeHits.get(key);
  if (hit) return hit;
  const found = await geocodeAddress(sb, address, stateHint);
  if (found) geocodeHits.set(key, found);
  return found;
}
/** Test-only: forget the cached hits. */
export const clearGeocodeCache = () => geocodeHits.clear();

/** The ticket's saved aerial, or where its address is on our map. */
export const getTicketAerial = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TicketAerial> => {
    await me(context);
    const sb = context.supabase;
    const job = await readJob(context, data.id);
    let address = job.site_address ?? "";
    let siteState: string | null = null;
    let propertyName: string | null = job.site_name ?? null;
    if (job.site_id) {
      const { data: s } = await sb
        .from("crm_sites")
        .select("name, address1, address2, city, state, zip")
        .eq("id", job.site_id)
        .maybeSingle();
      if (s) {
        siteState = s.state;
        if (!address.trim()) address = siteAddressLine(s);
        if (s.name?.trim()) propertyName = s.name;
      }
    }
    const parsed = parseStreetAddress(address);
    const st = stateCode(siteState) ?? parsed?.state ?? null;
    const addressState = st === "KY" || st === "TN" ? st : null;

    const { data: photos, error: pErr } = await sb
      .from("service_job_photos")
      .select("*")
      .eq("service_job_id", job.id)
      .eq("role", "aerial")
      .order("created_at", { ascending: false })
      .limit(1);
    if (pErr) throw new Error(pErr.message);
    const last = photos?.[0];
    const markup = last ? parseMarkup(last.annotations) : null;
    if (last && markup)
      return { address, addressState, saved: { photo: last, markup }, found: null, note: null };

    // 1. The address.
    let note: string | null = null;
    let near: { lat: number; lng: number } | null = null;
    const word = parsed ? streetFilterWord(parsed) : null;
    if (!address.trim()) note = "The ticket has no address.";
    else if (!parsed || !word) note = "The address has no house number and street to match.";
    else {
      const where = await locateAddress(sb, parsed, word, addressState, propertyName);
      if (where.kind === "stored") {
        const { at, candidate } = where;
        const near = await buildingsNear(context, at.lat, at.lng, 350);
        const hit = buildingForPoint(at, near, candidate.building_id);
        if (hit)
          return {
            address,
            addressState,
            saved: null,
            found: toFound(hit.building, "address", at),
            note: null,
          };
        return {
          address,
          addressState,
          saved: null,
          found: {
            id: null,
            footprint: null,
            address: candidate.address,
            state: addressState,
            how: "address",
            lat: at.lat,
            lng: at.lng,
            areaSqFt: null,
          },
          note: "The address is on the map but no building outline is stored there; pick the building.",
        };
      }
      if (where.kind === "ambiguous")
        note = `The address matches ${where.count} places in our map data; pick the building on the map.`;
      else if (where.kind === "live") {
        const { live } = where;
        return { address, addressState, saved: null, found: live.found, note: live.note };
      } else if (where.kind === "near") {
        // Owner, Oct 26: nothing at that number, but the street is on the map — Pick the
        // building opens there (unless the ticket's own photos say where, below).
        note = where.note;
        near = where.near;
      } else note = "No building or 911 address point in our map data matches this address.";
    }

    // 2. Where the ticket's photos were taken (the tech on the roof).
    const { data: gps } = await sb
      .from("service_job_photos")
      .select("lat, lng")
      .eq("service_job_id", job.id)
      .not("lat", "is", null)
      .not("lng", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const g = gps?.[0];
    if (g && g.lat != null && g.lng != null) {
      const at = { lat: g.lat, lng: g.lng };
      const near = await buildingsNear(context, at.lat, at.lng, 200);
      const hit = buildingForPoint(at, near);
      if (hit)
        return {
          address,
          addressState,
          saved: null,
          found: toFound(hit.building, "photo_gps", at),
          note,
        };
      // No outline there: the imagery centred where the photos were taken.
      return {
        address,
        addressState,
        saved: null,
        found: {
          id: null,
          footprint: null,
          address: null,
          state: addressState,
          how: "photo_gps",
          lat: at.lat,
          lng: at.lng,
          areaSqFt: null,
        },
        note,
      };
    }
    return { address, addressState, saved: null, found: null, note, near };
  });

const fetchJson = async (url: string): Promise<unknown> => {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const host = new URL(url).host;
    throw new Error(
      e instanceof Error && e.name === "TimeoutError"
        ? `The state map server (${host}) took too long to answer — try again in a minute`
        : `Could not reach the state map server (${host})`,
    );
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  const json = parseLooseJson(await res.text()) as { error?: { message?: string } };
  if (json && typeof json === "object" && json.error)
    throw new Error(json.error.message ?? "ArcGIS error");
  return json;
};

/** A live lookup's answer: the point (with its outline when the layer has one) and the note. */
type LiveFound = { found: FoundBuilding; note: string | null };
const LIVE_NO_OUTLINE_NOTE =
  "The address is on the state map but no building outline covers it; pick the building.";

const liveFound = (
  hit: FootprintCandidate | null,
  fallback: { address: string | null; state: "KY" | "TN"; lat: number; lng: number },
): LiveFound => {
  if (!hit?.geometry) {
    return {
      found: { id: null, footprint: null, how: "address", areaSqFt: null, ...fallback },
      note: LIVE_NO_OUTLINE_NOTE,
    };
  }
  const polys = footprintPolygons(hit.geometry.footprint);
  return {
    found: {
      id: null,
      footprint: hit.geometry.footprint as AerialBuilding["footprint"],
      address: fallback.address,
      state: fallback.state,
      how: "address",
      lat: hit.lat ?? fallback.lat,
      lng: hit.lng ?? fallback.lng,
      areaSqFt: footprintAreaSqFt(polys),
    },
    note: null,
  };
};

/** Kentucky: the 911 point for the address, then the state's outline under it. */
/** The 911 points a query returned, as candidates (with the landmark name for the by-name fallback). */
async function kyPoints(url: string): Promise<NamedPoint[]> {
  const set = (await fetchJson(url)) as ArcGisFeatureSet;
  return (set.features ?? []).flatMap((f) => {
    const p = addressPointFromFeature(f);
    return p
      ? [
          {
            source: "point" as const,
            id: p.key,
            address: p.address,
            city: p.city,
            zip: p.zip,
            lat: p.lat,
            lng: p.lng,
            building_id: null,
            landmark: p.landmark,
          },
        ]
      : [];
  });
}

/** The state's outline under a point, as the match's building. */
async function kyFoundAt(
  at: { lat: number; lng: number },
  address: string | null,
): Promise<LiveFound> {
  const page = (await fetchJson(
    footprintAtPointUrl(KY_FOOTPRINTS_LAYER, at.lng, at.lat),
  )) as ArcGisFeatureSet;
  const hit =
    (page.features ?? [])
      .map(footprintFromFeature)
      .find((c) => c !== null && pointInFootprint(at.lng, at.lat, c.geometry?.footprint)) ?? null;
  return liveFound(hit, { address, state: "KY", ...at });
}

/**
 * Kentucky: the 911 point for the number and street; failing that (owner, Oct 26, ticket 6036
 * — the state lists the building under another number), the landmark that carries the
 * property's name on that street in that town, then the nearest numbers the layer has on that
 * street, where Pick the building will open (lib/aerial-fallbacks.ts).
 */
async function liveKentucky(
  parsed: ParsedAddress,
  word: string,
  propertyName: string | null = null,
): Promise<LiveResult | null> {
  const url = addressPointsByAddressUrl(parsed.house, word);
  if (!url) return null;
  const cands = await kyPoints(url);
  const m = pickAddressMatch(parsed, cands);
  if (m.outcome === "match") {
    const at = { lat: m.candidate.lat!, lng: m.candidate.lng! };
    return { kind: "found", live: await kyFoundAt(at, m.candidate.address) };
  }
  const towns = cityVariants(parsed.city);
  // 1. By name.
  const nameUrl = landmarksByNameUrl(nameSearchStems(propertyName), towns);
  if (nameUrl) {
    const byName = pickByName(parsed, nameSearchStems(propertyName), await kyPoints(nameUrl));
    if (byName) {
      const at = { lat: byName.lat!, lng: byName.lng! };
      const live = await kyFoundAt(at, byName.address);
      const note = foundByNameNote(byName.landmark ?? propertyName ?? "", byName.address);
      return { kind: "found", live: { ...live, note: live.note ? `${note} ${live.note}` : note } };
    }
  }
  // 2. The nearest numbers on that street.
  const streetUrl = addressPointsOnStreetUrl(word, towns);
  if (streetUrl) {
    const near = nearestOnStreet(parsed, await kyPoints(streetUrl));
    if (near) return { kind: "near", near: near.centre, note: nearNote(parsed, near) };
  }
  return null;
}

/** Tennessee: the national layer's structures carry the address, so the match is the outline. */
async function liveTennessee(parsed: ParsedAddress, word: string): Promise<LiveFound | null> {
  const url = structuresByAddressUrl(parsed.house, word);
  if (!url) return null;
  const set = (await fetchJson(url)) as ArcGisFeatureSet;
  const rows = (set.features ?? []).flatMap((f) => {
    const c = footprintFromFeature(f);
    return c && c.address ? [c] : [];
  });
  const cands: AddressCandidate[] = rows.map((c, i) => ({
    source: "building",
    id: String(i),
    address: c.address!,
    city: c.city,
    zip: c.zip,
    lat: c.lat,
    lng: c.lng,
    building_id: null,
  }));
  const m = pickAddressMatch(parsed, cands);
  if (m.outcome !== "match") return null;
  const hit = rows[Number(m.candidate.id)]!;
  return liveFound(hit, {
    address: [hit.address, hit.city].filter(Boolean).join(", ") || null,
    state: "TN",
    lat: m.candidate.lat!,
    lng: m.candidate.lng!,
  });
}

/**
 * The address on the live state layers (owner, Oct 9), when our stored data has nothing for it:
 * Kentucky's 911 points then its footprints, or Tennessee's structures; both when the state is
 * not known. Anything that goes wrong (the server down, an odd answer) is null: the ticket then
 * reads as before, with the Pick button.
 */
type LiveResult =
  | { kind: "found"; live: LiveFound }
  | { kind: "near"; near: { lat: number; lng: number }; note: string };

async function liveAddressLookup(
  parsed: ParsedAddress,
  word: string,
  addressState: "KY" | "TN" | null,
  propertyName: string | null = null,
): Promise<LiveResult | null> {
  const states: ("KY" | "TN")[] = addressState ? [addressState] : ["KY", "TN"];
  for (const st of states) {
    try {
      if (st === "KY") {
        const r = await liveKentucky(parsed, word, propertyName);
        if (r) return r;
      } else {
        const r = await liveTennessee(parsed, word);
        if (r) return { kind: "found", live: r };
      }
    } catch {
      // The state server is a best effort here; the stored-data note covers it.
    }
  }
  return null;
}

/**
 * "Pick the building on the map": the stored outline under the tapped point, else the state
 * layer's (Kentucky's own export, or the national layer in Tennessee), read but not stored.
 */
export const aerialBuildingAt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<FoundBuilding> => {
    await me(context);
    const at = { lat: data.lat, lng: data.lng };
    const near = await buildingsNear(context, at.lat, at.lng, 250);
    const stored = near.find((b) =>
      pointInFootprint(
        at.lng,
        at.lat,
        b.footprint as { type: string; coordinates: unknown } | null,
      ),
    );
    if (stored) return toFound(stored, "picked", at);
    // Near the line both layers are asked, the point's own side first.
    const side = stateForPoint(at.lat, at.lng);
    const layers =
      side === "TN"
        ? [USA_STRUCTURES_LAYER, ...(nearKyTnLine(at.lat, at.lng) ? [KY_FOOTPRINTS_LAYER] : [])]
        : [KY_FOOTPRINTS_LAYER, ...(nearKyTnLine(at.lat, at.lng) ? [USA_STRUCTURES_LAYER] : [])];
    for (const layer of layers) {
      const page = (await fetchJson(
        footprintAtPointUrl(layer, at.lng, at.lat),
      )) as ArcGisFeatureSet;
      const hit = (page.features ?? [])
        .map(footprintFromFeature)
        .find((c) => c !== null && pointInFootprint(at.lng, at.lat, c.geometry?.footprint));
      if (hit?.geometry) {
        const polys = footprintPolygons(hit.geometry.footprint);
        return {
          id: null,
          footprint: hit.geometry.footprint as AerialBuilding["footprint"],
          address: [hit.address, hit.city].filter(Boolean).join(", ") || null,
          state: layer === USA_STRUCTURES_LAYER ? "TN" : "KY",
          how: "picked",
          lat: hit.lat ?? at.lat,
          lng: hit.lng ?? at.lng,
          areaSqFt: footprintAreaSqFt(polys),
        };
      }
    }
    throw new Error("No building outline at that spot — zoom in and tap inside the roof");
  });

const saveSchema = z.object({
  service_job_id: z.string().uuid(),
  storage_path: z.string().min(1).max(300),
  file_size: z.number().int().nonnegative().nullable().optional(),
  markup: markupSchema,
});

/**
 * Save the markup: the PNG the browser uploaded to the "service" bucket plus the vector JSON,
 * as the ticket's aerial photo. The ticket keeps one aerial: the earlier one (row and file) is
 * replaced once the new one is recorded.
 */
export const saveTicketAerial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }): Promise<AerialPhotoRow> => {
    const p = await me(context);
    if (!canAccess(p, "service")) throw new Error("Forbidden: Service access required");
    const sb = context.supabase;
    const job = await readJob(context, data.service_job_id);
    if (!isOffice(p) && job.technician_id !== context.userId)
      throw new Error("This ticket is assigned to someone else");
    if (!data.storage_path.startsWith(`${job.id}/`))
      throw new Error("The picture must be stored under the ticket's own folder");
    const { data: prior } = await sb
      .from("service_job_photos")
      .select("id, storage_path")
      .eq("service_job_id", job.id)
      .eq("role", "aerial");
    const { data: row, error } = await sb
      .from("service_job_photos")
      .insert({
        service_job_id: job.id,
        role: "aerial",
        storage_path: data.storage_path,
        file_name: "aerial.png",
        file_size: data.file_size ?? null,
        taken_at: new Date().toISOString(),
        lat: data.markup.center[1],
        lng: data.markup.center[0],
        annotations: data.markup as unknown as Json,
        by_user: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const old = (prior ?? []).filter((r) => r.id !== row.id);
    if (old.length) {
      await sb
        .from("service_job_photos")
        .delete()
        .in(
          "id",
          old.map((r) => r.id),
        );
      await sb.storage.from("service").remove(old.map((r) => r.storage_path));
    }
    await sb.from("service_job_events").insert({
      service_job_id: job.id,
      kind: "photo",
      by_user: context.userId,
      by_name: nameOf(p),
      meta: {
        role: "aerial",
        tags: data.markup.annotations.filter((a) => a.kind === "pin").length,
      } as Json,
    });
    return row;
  });
