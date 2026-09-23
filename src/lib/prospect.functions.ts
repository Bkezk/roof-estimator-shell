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
  type ParcelFieldMap,
} from "@/lib/gis/arcgis";
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
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<BuildingRow[]> => {
    await readAccess(context);
    let q = context.supabase
      .from("buildings")
      .select("*")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (data.county) q = q.eq("county", data.county);
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

// ── Kentucky PVA parcel import (src/lib/gis/arcgis.ts) ──────────────────────────────────────
// The server fetches the county's ArcGIS layer (the browser never talks to the state server),
// parses features into building candidates and upserts them on (county, parcel_id). Parcels
// are land: lot_sqft is filled, roof_sqft is not.

const layerUrlSchema = z
  .string()
  .url()
  .refine((u) => /\/MapServer\/\d+\/?$/.test(u) || /\/FeatureServer\/\d+\/?$/.test(u), {
    message: "Give the LAYER url — it ends in /MapServer/<n> (or /FeatureServer/<n>)",
  });

const fetchJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  const body = (await res.json()) as { error?: { message?: string } };
  if (body && typeof body === "object" && body.error) {
    throw new Error(body.error.message ?? "ArcGIS error");
  }
  return body;
};

export interface ParcelPreview {
  county: string | null;
  fieldMap: ParcelFieldMap;
  fields: string[];
  total: number;
  maxRecordCount: number | null;
  sample: ParcelCandidate[];
}

/** Read the layer's fields, count the matching parcels and parse the first few. */
export const previewParcels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ layerUrl: layerUrlSchema, where: z.string().max(500).default("1=1") }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ParcelPreview> => {
    await assertPageAccess(context.supabase, context.userId, "prospect");
    const info = (await fetchJson(layerInfoUrl(data.layerUrl))) as {
      fields?: ArcGisField[];
      maxRecordCount?: number;
    };
    const fields = info.fields ?? [];
    const fieldMap = guessFieldMap(fields);
    const countBody = (await fetchJson(
      parcelQueryUrl(data.layerUrl, { where: data.where, countOnly: true }),
    )) as { count?: number };
    const page = (await fetchJson(
      parcelQueryUrl(data.layerUrl, { where: data.where, count: 10 }),
    )) as ArcGisFeatureSet;
    const sample = (page.features ?? [])
      .map((f) => parcelFromFeature(f, fieldMap))
      .filter((c): c is ParcelCandidate => c !== null);
    return {
      county: countyFromServiceUrl(data.layerUrl),
      fieldMap,
      fields: fields.map((f) => f.name),
      total: countBody.count ?? 0,
      maxRecordCount: info.maxRecordCount ?? null,
      sample,
    };
  });

/**
 * Import every parcel matching `where` into buildings (upsert on county + parcel_id), paging
 * through the layer. Capped per call so a runaway filter cannot flood the table; run again to
 * continue (existing parcels are updated, not duplicated).
 */
export const importParcels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        layerUrl: layerUrlSchema,
        where: z.string().max(500).default("1=1"),
        county: z.string().trim().min(1).max(100),
        maxRows: z.number().int().min(1).max(5000).default(2000),
      })
      .parse(d),
  )
  .handler(
    async ({ data, context }): Promise<{ fetched: number; upserted: number; skipped: number }> => {
      await assertPageAccess(context.supabase, context.userId, "prospect");
      const info = (await fetchJson(layerInfoUrl(data.layerUrl))) as {
        fields?: ArcGisField[];
        maxRecordCount?: number;
      };
      const fieldMap = guessFieldMap(info.fields ?? []);
      const pageSize = Math.min(500, info.maxRecordCount ?? 500);
      const who = await meName(context);
      const now = new Date().toISOString();
      let fetched = 0;
      let upserted = 0;
      let skipped = 0;
      for (let offset = 0; offset < data.maxRows; offset += pageSize) {
        const page = (await fetchJson(
          parcelQueryUrl(data.layerUrl, { where: data.where, offset, count: pageSize }),
        )) as ArcGisFeatureSet;
        const feats = page.features ?? [];
        fetched += feats.length;
        const rows = feats
          .map((f) => parcelFromFeature(f, fieldMap))
          .filter((c): c is ParcelCandidate => c !== null)
          .map((c) => ({
            county: data.county,
            parcel_id: c.parcelId,
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
            source_layer: data.layerUrl,
            imported_at: now,
            deleted_at: null, // a re-imported parcel comes back
            created_by: context.userId,
            created_by_name: who,
          }));
        skipped += feats.length - rows.length;
        if (rows.length > 0) {
          const { error, count } = await context.supabase.from("buildings").upsert(rows, {
            onConflict: "county,parcel_id",
            ignoreDuplicates: false,
            count: "exact",
          });
          if (error) throw new Error(error.message);
          upserted += count ?? rows.length;
        }
        if (feats.length < pageSize || !page.exceededTransferLimit) break;
      }
      return { fetched, upserted, skipped };
    },
  );
