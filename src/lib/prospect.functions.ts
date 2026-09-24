/**
 * Prospecting phase 1 — server functions for buildings, roofs and tasks-lite
 * (docs/roofing-ops-portal-brief.md). Reads need the Prospecting or Estimate page; writes need
 * Prospecting. RLS enforces the same; these checks give a readable error instead of an empty
 * result. Prospecting finds NEW business: bids are read (warranty leads) and never edited here
 * except their nullable building link.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { assertPageAccess } from "@/lib/auth.functions";
import {
  countyFromServiceUrl,
  guessFieldMap,
  layerInfoUrl,
  looksLikeAddress,
  parcelFromFeature,
  parcelQueryUrl,
  type ArcGisFeatureSet,
  type ArcGisField,
  type ParcelCandidate,
} from "@/lib/gis/arcgis";
import {
  addressPointFromFeature,
  detectLayerKind,
  facilityFromFeature,
  footprintAtPointUrl,
  footprintFromFeature,
  footprintsAtPointsRequest,
  guessFacilityFieldMap,
  layerShortName,
  pointInFootprint,
  KY_FOOTPRINTS_LAYER,
  type LayerKind,
} from "@/lib/gis/ky-layers";
import {
  sortWarrantyLeads,
  warrantyLeadFrom,
  type WarrantyLead,
  type WarrantyLeadRow,
} from "@/lib/prospect";

export type BuildingRow = Database["public"]["Tables"]["buildings"]["Row"];
export type RoofRow = Database["public"]["Tables"]["roofs"]["Row"];
export type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];

// Parsed shapes carry null, never undefined: the Supabase Insert/Update types reject undefined
// under exactOptionalPropertyTypes.
const nullableText = z.string().trim().max(500).nullable().default(null);
const nullableNum = z.number().finite().nonnegative().nullable().default(null);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .default(null);

export const buildingSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().max(200).default(""),
  address1: z.string().trim().max(200).default(""),
  address2: nullableText,
  city: nullableText,
  state: z.string().trim().max(2).default("KY"),
  zip: nullableText,
  county: nullableText,
  parcel_id: nullableText,
  owner_name: nullableText,
  owner_address: nullableText,
  land_use: nullableText,
  building_sqft: nullableNum,
  roof_sqft: nullableNum,
  perimeter_ft: nullableNum,
  year_built: z.number().int().min(1700).max(2100).nullable().default(null),
  /** Year the current roof went on (typed, or synced from the newest roof record). */
  roof_year: z.number().int().min(1700).max(2100).nullable().default(null),
  stories: z.number().int().min(0).max(200).nullable().default(null),
  centroid_lat: z.number().min(-90).max(90).nullable().default(null),
  centroid_lng: z.number().min(-180).max(180).nullable().default(null),
  own_book: z.boolean().default(false),
  notes: z.string().max(4000).nullable().default(null),
});
export type BuildingInput = z.infer<typeof buildingSchema>;

export const roofSchema = z.object({
  id: z.string().uuid().optional(),
  building_id: z.string().uuid(),
  section_name: z.string().trim().min(1).max(120),
  roof_type: nullableText,
  roof_system: nullableText,
  area_sqft: nullableNum,
  install_date: isoDate,
  installer: nullableText,
  warranty_type: nullableText,
  warranty_expires: isoDate,
  last_inspection: isoDate,
  condition: z.enum(["good", "fair", "poor", "unknown"]).nullable().default(null),
  notes: z.string().max(4000).nullable().default(null),
});
export type RoofInput = z.infer<typeof roofSchema>;

export const taskSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  details: z.string().max(4000).nullable().default(null),
  due_date: isoDate,
  building_id: z.string().uuid().nullable().default(null),
});

const meName = async (ctx: {
  supabase: Parameters<typeof assertPageAccess>[0];
  userId: string;
}) => {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  return (data?.full_name ?? "").trim() || data?.email || null;
};

const readAccess = async (ctx: {
  supabase: Parameters<typeof assertPageAccess>[0];
  userId: string;
}) => {
  try {
    await assertPageAccess(ctx.supabase, ctx.userId, "prospect");
  } catch {
    await assertPageAccess(ctx.supabase, ctx.userId, "estimate");
  }
};

/** Buildings for the list: newest first, optional search / county filters. */
export const listBuildings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().trim().max(200).optional(),
        county: z.string().trim().max(100).optional(),
        /** Roof at least this many years old: roof_year, else year_built (original roof). */
        minAge: z.number().int().min(0).max(200).optional(),
        /** Only buildings whose roof age nobody knows yet. */
        ageUnknown: z.boolean().optional(),
        minSqFt: z.number().int().min(0).optional(),
        sort: z.enum(["recent", "biggest", "oldest"]).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<BuildingRow[]> => {
    await readAccess(context);
    let q = context.supabase.from("buildings").select("*").is("deleted_at", null).limit(500);
    if (data.sort === "biggest") {
      q = q.order("roof_sqft", { ascending: false, nullsFirst: false });
    } else if (data.sort === "oldest") {
      q = q
        .order("roof_year", { ascending: true, nullsFirst: false })
        .order("year_built", { ascending: true, nullsFirst: false });
    } else {
      q = q.order("updated_at", { ascending: false });
    }
    if (data.county) q = q.eq("county", data.county);
    if (data.minSqFt) q = q.gte("roof_sqft", data.minSqFt);
    if (data.ageUnknown) {
      q = q.is("roof_year", null).is("year_built", null);
    } else if (data.minAge) {
      const cutoff = new Date().getFullYear() - data.minAge;
      q = q.or(`roof_year.lte.${cutoff},and(roof_year.is.null,year_built.lte.${cutoff})`);
    }
    if (data.q) {
      const like = `%${data.q.replace(/[%_]/g, "")}%`;
      q = q.or(
        `name.ilike.${like},address1.ilike.${like},city.ilike.${like},owner_name.ilike.${like},parcel_id.ilike.${like}`,
      );
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Distinct counties with building counts (for the filter). */
export const listCounties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ county: string; count: number }[]> => {
    await readAccess(context);
    const { data, error } = await context.supabase
      .from("buildings")
      .select("county")
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    const counts = new Map<string, number>();
    for (const r of data ?? []) {
      const c = (r.county ?? "").trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([county, count]) => ({ county, count }))
      .sort((a, b) => b.count - a.count || a.county.localeCompare(b.county));
  });

export interface BuildingDetail {
  building: BuildingRow;
  roofs: RoofRow[];
  tasks: TaskRow[];
  bids: { id: string; name: string; status: string; grand_total: number; updated_at: string }[];
}

export const getBuilding = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<BuildingDetail> => {
    await readAccess(context);
    const { data: building, error } = await context.supabase
      .from("buildings")
      .select("*")
      .eq("id", data.id)
      .is("deleted_at", null)
      .single();
    if (error || !building) throw new Error(error?.message ?? "Building not found");
    const [roofs, tasks, bids] = await Promise.all([
      context.supabase
        .from("roofs")
        .select("*")
        .eq("building_id", data.id)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("tasks")
        .select("*")
        .eq("building_id", data.id)
        .order("status", { ascending: true })
        .order("due_date", { ascending: true, nullsFirst: false }),
      context.supabase
        .from("bids")
        .select("id, name, status, grand_total, updated_at")
        .eq("building_id", data.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
    ]);
    if (roofs.error) throw new Error(roofs.error.message);
    if (tasks.error) throw new Error(tasks.error.message);
    // Estimate access may be missing on a Prospecting-only login: bids then read as none.
    return {
      building,
      roofs: roofs.data ?? [],
      tasks: tasks.data ?? [],
      bids: bids.error ? [] : (bids.data ?? []),
    };
  });

export const saveBuilding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => buildingSchema.parse(d))
  .handler(async ({ data, context }): Promise<BuildingRow> => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const { id, ...fields } = data;
    if (id) {
      const { data: row, error } = await context.supabase
        .from("buildings")
        .update(fields)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await context.supabase
      .from("buildings")
      .insert({
        ...fields,
        source: "manual",
        created_by: context.userId,
        created_by_name: await meName(context),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Soft delete: the row keeps its history and its links; admins can purge later. */
export const deleteBuilding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const { error } = await context.supabase
      .from("buildings")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveRoof = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => roofSchema.parse(d))
  .handler(async ({ data, context }): Promise<RoofRow> => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const { id, ...fields } = data;
    const q = id
      ? context.supabase.from("roofs").update(fields).eq("id", id).select().single()
      : context.supabase.from("roofs").insert(fields).select().single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteRoof = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const { error } = await context.supabase.from("roofs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => taskSchema.parse(d))
  .handler(async ({ data, context }): Promise<TaskRow> => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const { id, ...fields } = data;
    if (id) {
      const { data: row, error } = await context.supabase
        .from("tasks")
        .update(fields)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await context.supabase
      .from("tasks")
      .insert({ ...fields, created_by: context.userId, created_by_name: await meName(context) })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const setTaskDone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), done: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<TaskRow> => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const { data: row, error } = await context.supabase
      .from("tasks")
      .update({
        status: data.done ? "done" : "open",
        done_at: data.done ? new Date().toISOString() : null,
      })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Open tasks across all buildings (the Prospecting page's task strip). */
export const listOpenTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskRow[]> => {
    await readAccess(context);
    const { data, error } = await context.supabase
      .from("tasks")
      .select("*")
      .eq("status", "open")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Warranty leads: the roofs WE installed (accepted bids), soonest warranty expiry first — a lead
 * source for re-roofs and maintenance agreements. Read on demand through `warranty_leads()`
 * (SECURITY DEFINER, gated on the Prospecting flag); nothing is copied or written.
 */
export const listWarrantyLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WarrantyLead[]> => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const { data, error } = await context.supabase.rpc("warranty_leads");
    if (error) throw new Error(error.message);
    const today = new Date().toISOString().slice(0, 10);
    return sortWarrantyLeads(
      ((data ?? []) as WarrantyLeadRow[]).map((r) => warrantyLeadFrom(r, today)),
    );
  });

/** Link (or unlink) an existing bid to a building. Estimate access edits the bid. */
export const linkBidToBuilding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ bidId: z.string().uuid(), buildingId: z.string().uuid().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPageAccess(context.supabase, context.userId, "estimate");
    const { error } = await context.supabase
      .from("bids")
      .update({ building_id: data.buildingId })
      .eq("id", data.bidId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Kentucky layer import (src/lib/gis/arcgis.ts, src/lib/gis/ky-layers.ts) ─────────────────
// The server fetches the ArcGIS layer (the browser never talks to the state server), detects
// what kind of layer it is and upserts:
//   parcel    → buildings on (county, parcel_id)   — land: lot_sqft, owner, class
//   footprint → buildings on source_key            — roof_sqft, shape, county from FIPS
//   facility  → buildings on source_key            — schools, hospitals, …: name + address
//   address   → address_points on source_key       — lends addresses to footprints (RPC)

const layerUrlSchema = z
  .string()
  .url()
  .refine((u) => /\/MapServer\/\d+\/?$/.test(u) || /\/FeatureServer\/\d+\/?$/.test(u), {
    message: "Give the LAYER url — it ends in /MapServer/<n> (or /FeatureServer/<n>)",
  });

const fetchJson = async (url: string, body?: URLSearchParams): Promise<unknown> => {
  let res: Response;
  try {
    res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(body ? { body: body.toString() } : {}),
      signal: AbortSignal.timeout(40_000),
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
  const json = (await res.json()) as { error?: { message?: string } };
  if (json && typeof json === "object" && json.error) {
    throw new Error(json.error.message ?? "ArcGIS error");
  }
  return json;
};

/** One preview line, whatever the layer kind. */
export interface PreviewRow {
  key: string;
  name: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  /** Roof sq ft (footprint) or lot sq ft (parcel). */
  sqft: number | null;
  /** Class / occupancy / facility type. */
  cls: string | null;
  lat: number | null;
  lng: number | null;
}

export interface LayerPreview {
  kind: LayerKind;
  /** Parcel layers: the county in the service name. */
  county: string | null;
  fields: string[];
  /** Which attribute fills what (for the operator to sanity-check). */
  mapping: Record<string, string>;
  total: number;
  maxRecordCount: number | null;
  sample: PreviewRow[];
}

interface LayerInfo {
  fields?: ArcGisField[];
  maxRecordCount?: number;
}

/** Parse one page of features by kind into preview rows and the rows to write. */
function parseFeatures(
  kind: LayerKind,
  fields: ArcGisField[],
  feats: ArcGisFeatureSet["features"],
) {
  const list = feats ?? [];
  if (kind === "parcel") {
    const map = guessFieldMap(fields);
    const parcels = list
      .map((f) => parcelFromFeature(f, map))
      .filter((c): c is ParcelCandidate => c !== null);
    return {
      mapping: map as unknown as Record<string, string>,
      parcels,
      footprints: [],
      points: [],
      facilities: [],
      rows: parcels.map<PreviewRow>((c) => ({
        key: c.parcelId,
        name: looksLikeAddress(c.location) ? c.ownerName : (c.location ?? c.ownerName),
        address: looksLikeAddress(c.location) ? c.location : null,
        city: null,
        county: null,
        sqft: c.lotSqFt,
        cls: c.landUse,
        lat: c.geometry?.centroidLat ?? null,
        lng: c.geometry?.centroidLng ?? null,
      })),
    };
  }
  if (kind === "footprint") {
    const footprints = list
      .map(footprintFromFeature)
      .filter((c): c is NonNullable<typeof c> => c !== null);
    return {
      mapping: { key: "BUILD_ID", roofSqFt: "SQFEET", county: "FIPS", address: "PROP_ADDR" },
      parcels: [],
      footprints,
      points: [],
      facilities: [],
      rows: footprints.map<PreviewRow>((c) => ({
        key: c.buildId,
        name: c.primaryOccupancy,
        address: c.address,
        city: c.city,
        county: c.county,
        sqft: c.roofSqFt,
        cls: c.occupancyClass,
        lat: c.lat,
        lng: c.lng,
      })),
    };
  }
  if (kind === "address") {
    const points = list
      .map(addressPointFromFeature)
      .filter((c): c is NonNullable<typeof c> => c !== null);
    return {
      mapping: {
        key: "Site_NGUID",
        address: "Add_Number + LSt_*",
        county: "County",
        city: "Post_Comm",
      },
      parcels: [],
      footprints: [],
      points,
      facilities: [],
      rows: points.map<PreviewRow>((c) => ({
        key: c.key,
        name: c.landmark,
        address: c.address,
        city: c.city,
        county: c.county,
        sqft: null,
        cls: c.placeType,
        lat: c.lat,
        lng: c.lng,
      })),
    };
  }
  const map = guessFacilityFieldMap(fields);
  const facilities = list
    .map((f) => facilityFromFeature(f, map))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  return {
    mapping: map as unknown as Record<string, string>,
    parcels: [],
    footprints: [],
    points: [],
    facilities,
    rows: facilities.map<PreviewRow>((c) => ({
      key: c.key,
      name: c.name,
      address: c.address,
      city: c.city,
      county: c.county,
      sqft: null,
      cls: c.kind,
      lat: c.lat,
      lng: c.lng,
    })),
  };
}

/** Read the layer's fields, detect its kind, count the matches and parse the first few. */
export const previewLayer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ layerUrl: layerUrlSchema, where: z.string().max(500).default("1=1") }).parse(d),
  )
  .handler(async ({ data, context }): Promise<LayerPreview> => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const info = (await fetchJson(layerInfoUrl(data.layerUrl))) as LayerInfo;
    const fields = info.fields ?? [];
    const kind = detectLayerKind(data.layerUrl, fields);
    const countBody = (await fetchJson(
      parcelQueryUrl(data.layerUrl, { where: data.where, countOnly: true }),
    )) as { count?: number };
    const page = (await fetchJson(
      parcelQueryUrl(data.layerUrl, { where: data.where, count: 10 }),
    )) as ArcGisFeatureSet;
    const parsed = parseFeatures(kind, fields, page.features);
    return {
      kind,
      county: kind === "parcel" ? countyFromServiceUrl(data.layerUrl) : null,
      fields: fields.map((f) => f.name),
      mapping: parsed.mapping,
      total: countBody.count ?? 0,
      maxRecordCount: info.maxRecordCount ?? null,
      sample: parsed.rows,
    };
  });

/**
 * Import everything matching `where`, paging through the layer and upserting per kind (see the
 * header). Capped per call so a runaway filter cannot flood the table; run again to continue
 * (existing rows are updated, not duplicated).
 */
export const importLayer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        layerUrl: layerUrlSchema,
        where: z.string().max(500).default("1=1"),
        /** Parcel layers: the county to file under. Footprints read it from FIPS. */
        county: z.string().trim().max(100).default(""),
        /** Rows per call; the caller continues from `nextOffset` until `done`. */
        maxRows: z.number().int().min(1).max(20000).default(1500),
        startOffset: z.number().int().min(0).default(0),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      kind: LayerKind;
      fetched: number;
      upserted: number;
      skipped: number;
      /** Where the next call should start; meaningful only when `done` is false. */
      nextOffset: number;
      done: boolean;
    }> => {
      await assertPageAccess(context.supabase, context.userId, "prospect");
      const info = (await fetchJson(layerInfoUrl(data.layerUrl))) as LayerInfo;
      const fields = info.fields ?? [];
      const kind = detectLayerKind(data.layerUrl, fields);
      if (kind === "parcel" && !data.county) throw new Error("Parcel imports need a county");
      const pageSize = Math.min(500, info.maxRecordCount ?? 500);
      const who = await meName(context);
      const now = new Date().toISOString();
      const layerName = layerShortName(data.layerUrl);
      const stamp = {
        source_layer: data.layerUrl,
        imported_at: now,
        deleted_at: null, // a re-imported row comes back
        created_by: context.userId,
        created_by_name: who,
      };
      let fetched = 0;
      let upserted = 0;
      let skipped = 0;
      let done = false;
      let offset = data.startOffset;
      for (; offset < data.startOffset + data.maxRows; offset += pageSize) {
        const page = (await fetchJson(
          parcelQueryUrl(data.layerUrl, { where: data.where, offset, count: pageSize }),
        )) as ArcGisFeatureSet;
        const feats = page.features ?? [];
        fetched += feats.length;
        const parsed = parseFeatures(kind, fields, feats);
        let written = 0;
        if (kind === "parcel") {
          const rows = parsed.parcels.map((c) => ({
            county: data.county,
            parcel_id: c.parcelId,
            source_key: `pva:${data.county}:${c.parcelId}`,
            // The property's own address when the county publishes one; else the owner's name
            // stands in as the building name so the row is findable.
            name: looksLikeAddress(c.location) ? "" : (c.location ?? c.ownerName ?? ""),
            address1: looksLikeAddress(c.location) ? c.location! : "",
            owner_name: c.ownerName,
            owner_address: c.ownerAddress,
            land_use: c.landUse,
            lot_sqft: c.lotSqFt,
            perimeter_ft: c.perimeterFt,
            deed: c.deed,
            tax_year: c.taxYear,
            notes: c.description,
            footprint: (c.geometry?.footprint ?? null) as Json | null,
            centroid_lat: c.geometry?.centroidLat ?? null,
            centroid_lng: c.geometry?.centroidLng ?? null,
            source: "pva",
            ...stamp,
          }));
          written = rows.length;
          if (rows.length > 0) {
            const { error, count } = await context.supabase.from("buildings").upsert(rows, {
              onConflict: "county,parcel_id",
              ignoreDuplicates: false,
              count: "exact",
            });
            if (error) throw new Error(error.message);
            upserted += count ?? rows.length;
          }
        } else if (kind === "footprint") {
          // upsert_buildings keeps what a person typed or a match filled (name, address, city,
          // zip, land use); size, outline and county refresh.
          const rows = parsed.footprints.map((c) => ({
            source_key: `ornl:${c.buildId}`,
            source: "ornl",
            county: c.county ?? (data.county || null),
            name: c.primaryOccupancy ?? "",
            address1: c.address ?? "",
            city: c.city,
            zip: c.zip,
            land_use: c.occupancyClass,
            roof_sqft: c.roofSqFt,
            perimeter_ft: c.geometry?.computedPerimeterFt ?? null,
            height_ft: c.heightFt,
            footprint: (c.geometry?.footprint ?? null) as Json | null,
            centroid_lat: c.lat,
            centroid_lng: c.lng,
            source_layer: data.layerUrl,
            created_by: context.userId,
            created_by_name: who,
          }));
          written = rows.length;
          if (rows.length > 0) {
            const { data: n, error } = await context.supabase.rpc("upsert_buildings", {
              rows: rows as unknown as Json,
            });
            if (error) throw new Error(error.message);
            upserted += n ?? rows.length;
          }
        } else if (kind === "address") {
          const rows = parsed.points.map((c) => ({
            source_key: `ky911:${c.key}`,
            county: c.county ?? (data.county || null),
            address: c.address,
            city: c.city,
            zip: c.zip,
            landmark: c.landmark,
            place_type: c.placeType,
            lat: c.lat,
            lng: c.lng,
            source_layer: data.layerUrl,
            imported_at: now,
          }));
          written = rows.length;
          if (rows.length > 0) {
            const { error, count } = await context.supabase.from("address_points").upsert(rows, {
              onConflict: "source_key",
              ignoreDuplicates: false,
              count: "exact",
            });
            if (error) throw new Error(error.message);
            upserted += count ?? rows.length;
          }
        } else {
          const rows = parsed.facilities.map((c) => ({
            source_key: `${layerName}:${c.key}`,
            source: "facility",
            county: c.county ?? (data.county || null),
            name: c.name,
            address1: c.address ?? "",
            city: c.city,
            zip: c.zip,
            land_use: c.kind,
            roof_sqft: null,
            perimeter_ft: null,
            height_ft: null,
            footprint: null,
            centroid_lat: c.lat,
            centroid_lng: c.lng,
            source_layer: data.layerUrl,
            created_by: context.userId,
            created_by_name: who,
          }));
          written = rows.length;
          if (rows.length > 0) {
            const { data: n, error } = await context.supabase.rpc("upsert_buildings", {
              rows: rows as unknown as Json,
            });
            if (error) throw new Error(error.message);
            upserted += n ?? rows.length;
          }
        }
        skipped += feats.length - written;
        if (feats.length < pageSize || !page.exceededTransferLimit) {
          done = true;
          offset += feats.length;
          break;
        }
      }
      return { kind, fetched, upserted, skipped, nextOffset: offset, done };
    },
  );

/** Give address-less footprints in a county the nearest imported 911 address point. */
export const fillFootprintAddresses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        county: z.string().trim().min(1).max(100),
        maxMetres: z.number().min(5).max(500).default(100),
        /** Start over on the county (after a fresh point import). */
        reset: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ updated: number; done: boolean }> => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const sb = context.supabase;
    const countAddressed = async () => {
      const { count } = await sb
        .from("buildings")
        .select("id", { count: "exact", head: true })
        .eq("county", data.county)
        .is("deleted_at", null)
        .neq("address1", "");
      return count ?? 0;
    };
    if (data.reset) {
      const { error } = await sb.rpc("reset_address_checks", { p_county: data.county });
      if (error) throw new Error(error.message);
    }
    const before = await countAddressed();
    // Chunks of 400 for up to ~20 s per call; the page calls again until done.
    const t0 = Date.now();
    let done = false;
    while (Date.now() - t0 < 20_000) {
      const { data: n, error } = await sb.rpc("fill_footprint_addresses", {
        p_county: data.county,
        p_max_m: data.maxMetres,
        p_limit: 400,
      });
      if (error) throw new Error(error.message);
      if ((n ?? 0) < 400) {
        done = true;
        break;
      }
    }
    return { updated: (await countAddressed()) - before, done };
  });

/** How many 911 address points are imported per county (so the fill button can say). */
export const countAddressPoints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ county: string; count: number }[]> => {
    await readAccess(context);
    const { data, error } = await context.supabase.from("address_points").select("county");
    if (error) throw new Error(error.message);
    const m = new Map<string, number>();
    for (const r of data ?? []) {
      const c = r.county ?? "(unknown)";
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([county, count]) => ({ county, count }))
      .sort((a, b) => a.county.localeCompare(b.county));
  });

/**
 * Named / commercially typed 911 points that no stored building claimed become buildings
 * (source ky911). Returns how many.
 */
export const promoteCommercialPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ county: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }): Promise<{ promoted: number; done: boolean }> => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const t0 = Date.now();
    let promoted = 0;
    let done = false;
    while (Date.now() - t0 < 20_000) {
      const { data: n, error } = await context.supabase.rpc("promote_commercial_points", {
        p_county: data.county,
        p_limit: 300,
      });
      if (error) throw new Error(error.message);
      promoted += n ?? 0;
      if ((n ?? 0) < 300) {
        done = true;
        break;
      }
    }
    return { promoted, done };
  });

/**
 * Give promoted buildings (a named business with no outline yet) their footprint: one spatial
 * request per batch of points asks the ORNL layer for the polygons that contain them, and each
 * point takes the polygon it falls in. Loops from the client until `done`.
 */
export const attachFootprints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        county: z.string().trim().min(1).max(100),
        batch: z.number().int().min(10).max(500).default(150),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ checked: number; attached: number; remaining: number; done: boolean }> => {
      await assertPageAccess(context.supabase, context.userId, "prospect");
      const sb = context.supabase;
      const { data: pending, error } = await sb
        .from("buildings")
        .select("id, centroid_lat, centroid_lng")
        .eq("county", data.county)
        .eq("source", "ky911")
        .is("deleted_at", null)
        .is("roof_sqft", null)
        .not("centroid_lat", "is", null)
        .order("id")
        .limit(data.batch + 1);
      if (error) throw new Error(error.message);
      const rows = (pending ?? []).slice(0, data.batch);
      if (rows.length === 0) return { checked: 0, attached: 0, remaining: 0, done: true };
      const req = footprintsAtPointsRequest(
        KY_FOOTPRINTS_LAYER,
        rows.map((r) => [r.centroid_lng!, r.centroid_lat!] as [number, number]),
      );
      const page = (await fetchJson(req.url, req.body)) as ArcGisFeatureSet;
      const polys = (page.features ?? [])
        .map(footprintFromFeature)
        .filter((c): c is NonNullable<typeof c> => c !== null && c.geometry !== null);
      let attached = 0;
      const unmatched: string[] = [];
      for (const r of rows) {
        const hit = polys.find((c) =>
          pointInFootprint(r.centroid_lng!, r.centroid_lat!, c.geometry!.footprint),
        );
        if (!hit) {
          unmatched.push(r.id);
          continue;
        }
        const { error: uErr } = await sb
          .from("buildings")
          .update({
            roof_sqft: hit.roofSqFt,
            perimeter_ft: hit.geometry!.computedPerimeterFt,
            height_ft: hit.heightFt,
            footprint: hit.geometry!.footprint as unknown as Json,
            notes: null,
          })
          .eq("id", r.id);
        if (uErr) throw new Error(uErr.message);
        attached++;
      }
      // A point with no outline under it (a lot, a sign, a kiosk) gets 0 so it is not asked again;
      // the salesperson can still type a size.
      if (unmatched.length > 0) {
        const { error: zErr } = await sb
          .from("buildings")
          .update({ roof_sqft: 0 })
          .in("id", unmatched);
        if (zErr) throw new Error(zErr.message);
      }
      const done = (pending ?? []).length <= data.batch;
      return {
        checked: rows.length,
        attached,
        remaining: done ? 0 : (pending ?? []).length - data.batch,
        done,
      };
    },
  );

/** Drop a county's address points that neither read commercial nor named a building. */
export const trimAddressPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ county: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }): Promise<{ trimmed: number; done: boolean }> => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const t0 = Date.now();
    let trimmed = 0;
    let done = false;
    while (Date.now() - t0 < 20_000) {
      const { data: n, error } = await context.supabase.rpc("trim_address_points", {
        p_county: data.county,
        p_limit: 5000,
      });
      if (error) throw new Error(error.message);
      trimmed += n ?? 0;
      if ((n ?? 0) < 5000) {
        done = true;
        break;
      }
    }
    return { trimmed, done };
  });

const refreshSchema = z.object({
  county: z.string().trim().min(1).max(100),
  ranBy: z.string().max(60).default("browser"),
  buildings: z.number().int().nullable().default(null),
  addressed: z.number().int().nullable().default(null),
  promoted: z.number().int().nullable().default(null),
  pointsKept: z.number().int().nullable().default(null),
  facilities: z.number().int().nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
});

/** Log a county refresh (the Buildings page shows "Data refreshed …"). */
export const recordRefresh = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => refreshSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const { error } = await context.supabase.from("data_refreshes").insert({
      county: data.county,
      ran_by: data.ranBy,
      buildings: data.buildings,
      addressed: data.addressed,
      promoted: data.promoted,
      points_kept: data.pointsKept,
      facilities: data.facilities,
      notes: data.notes,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type RefreshRow = Database["public"]["Tables"]["data_refreshes"]["Row"];

/** The latest refresh per county. */
export const listRefreshes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RefreshRow[]> => {
    await readAccess(context);
    const { data, error } = await context.supabase
      .from("data_refreshes")
      .select("*")
      .order("ran_at", { ascending: false })
      .limit(400);
    if (error) throw new Error(error.message);
    const seen = new Set<string>();
    return (data ?? []).filter((r) => {
      if (seen.has(r.county)) return false;
      seen.add(r.county);
      return true;
    });
  });

/**
 * Tap-to-add: the building outline under a tapped map point becomes a prospect (source ornl,
 * keyed by its BUILD_ID, so tapping a stored building again just returns it), with its size,
 * county from FIPS and the nearest 911 address when the county's points are loaded.
 */
export const addBuildingAtPoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ id: string | null; roofSqFt: number | null; existed: boolean }> => {
      await assertPageAccess(context.supabase, context.userId, "prospect");
      const page = (await fetchJson(
        footprintAtPointUrl(KY_FOOTPRINTS_LAYER, data.lng, data.lat),
      )) as ArcGisFeatureSet;
      const hit = (page.features ?? [])
        .map(footprintFromFeature)
        .find((c) => c !== null && pointInFootprint(data.lng, data.lat, c.geometry?.footprint));
      if (!hit) return { id: null, roofSqFt: null, existed: false };
      // Already a prospect (the map only draws the buildings in the current list)? Just open it.
      const { data: prior } = await context.supabase
        .from("buildings")
        .select("id")
        .eq("source_key", `ornl:${hit.buildId}`)
        .is("deleted_at", null)
        .maybeSingle();
      if (prior) return { id: prior.id, roofSqFt: hit.roofSqFt, existed: true };
      const who = await meName(context);
      const county = hit.county;
      const { error } = await context.supabase.rpc("upsert_buildings", {
        rows: [
          {
            source_key: `ornl:${hit.buildId}`,
            source: "ornl",
            county,
            name: hit.primaryOccupancy ?? "",
            address1: hit.address ?? "",
            city: hit.city,
            zip: hit.zip,
            land_use: hit.occupancyClass,
            roof_sqft: hit.roofSqFt,
            perimeter_ft: hit.geometry?.computedPerimeterFt ?? null,
            height_ft: hit.heightFt,
            footprint: hit.geometry?.footprint ?? null,
            centroid_lat: hit.lat,
            centroid_lng: hit.lng,
            source_layer: KY_FOOTPRINTS_LAYER,
            created_by: context.userId,
            created_by_name: who,
          },
        ] as unknown as Json,
      });
      if (error) throw new Error(error.message);
      if (county) {
        const { error: fErr } = await context.supabase.rpc("fill_footprint_addresses", {
          p_county: county,
        });
        if (fErr) throw new Error(fErr.message);
      }
      const { data: row, error: rErr } = await context.supabase
        .from("buildings")
        .select("id")
        .eq("source_key", `ornl:${hit.buildId}`)
        .maybeSingle();
      if (rErr) throw new Error(rErr.message);
      return { id: row?.id ?? null, roofSqFt: hit.roofSqFt, existed: false };
    },
  );
