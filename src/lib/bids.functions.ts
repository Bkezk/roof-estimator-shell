import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Json } from "@/integrations/supabase/types";
import { BID_STATUSES } from "@/lib/bid-status";
import { liveLockHeldElsewhere } from "@/lib/bid-locks.functions";

// All bid operations require a signed-in user. The user-scoped Supabase client
// from the auth middleware runs under RLS, so the database is the final guard.
export const listBids = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("bids")
      .select("*")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

/** Soft-deleted bids are kept this long, then purged (lazily, whenever the bin is listed). */
export const DELETED_BID_RETENTION_DAYS = 30;

/** The "Recently deleted" bin: soft-deleted bids still inside the retention window. */
export const listDeletedBids = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cutoff = new Date(
      Date.now() - DELETED_BID_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    // Purge anything past the window before listing what is left.
    const { error: purgeError } = await context.supabase
      .from("bids")
      .delete()
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);
    if (purgeError) throw new Error(purgeError.message);
    const { data, error } = await context.supabase
      .from("bids")
      .select("id, name, status, grand_total, updated_at, deleted_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const saveBidSchema = z.object({
  // Prospecting link (nullable spine column); absent = leave as is.
  buildingId: z.string().uuid().nullable().optional(),
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()),
  grandTotal: z.number(),
  status: z.enum(BID_STATUSES).optional(),
  /** The saving tab's edit-lock session key (see bid-locks); a live lock elsewhere refuses the save. */
  sessionKey: z.string().min(8).max(80).optional(),
});

/** Create a new bid or update an existing one (by id) with the full estimator payload. */
export const saveBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => saveBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Who is saving — shown on the Bids page as "Last saved … by <name>".
    const { data: me } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const payload = {
      name: data.name,
      data: data.data as Json,
      grand_total: data.grandTotal,
      updated_at: new Date().toISOString(),
      updated_by_name: (me?.full_name ?? "").trim() || me?.email || null,
      ...(data.status ? { status: data.status } : {}),
      ...(data.buildingId !== undefined ? { building_id: data.buildingId } : {}),
    };
    if (data.id) {
      const other = await liveLockHeldElsewhere(context.supabase, data.id, data.sessionKey);
      if (other)
        throw new Error(
          `Read only: ${other.holderName} is currently editing this bid — your changes were not saved.`,
        );
      const { data: bid, error } = await context.supabase
        .from("bids")
        .update(payload)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return bid;
    }
    const { data: bid, error } = await context.supabase
      .from("bids")
      .insert({ ...payload, status: data.status ?? "draft" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return bid;
  });

const getBidSchema = z.object({ id: z.string().uuid() });

/**
 * Delete one bid — a SOFT delete: the row is stamped `deleted_at`, hidden from the list, and
 * kept in "Recently deleted" for DELETED_BID_RETENTION_DAYS with Restore. RLS
 * (`bids_authenticated_all`) is the final guard.
 */
export const deleteBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => getBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error, count } = await context.supabase
      .from("bids")
      .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", data.id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Bid not found (it may already have been deleted).");
    return { id: data.id };
  });

/** Bring a soft-deleted bid back to the list. */
export const restoreBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => getBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error, count } = await context.supabase
      .from("bids")
      .update({ deleted_at: null }, { count: "exact" })
      .eq("id", data.id)
      .not("deleted_at", "is", null);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Bid not found in Recently deleted.");
    return { id: data.id };
  });

/** Permanently remove a bid that is already in Recently deleted. Cannot be undone. */
export const purgeBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => getBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error, count } = await context.supabase
      .from("bids")
      .delete({ count: "exact" })
      .eq("id", data.id)
      .not("deleted_at", "is", null);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Bid not found in Recently deleted.");
    return { id: data.id };
  });

/** Fetch one bid (with its stored estimator payload) by id. */
export const getBid = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => getBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: bid, error } = await context.supabase
      .from("bids")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    return bid;
  });

export interface CompanyInfo {
  company_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
}

export interface MarkupPreset {
  name: string;
  hourlyRate: number;
  markupAmount: number;
  markupType: string;
  includePerDiem: boolean;
  includeCommission: boolean;
  isDefault: boolean;
}

/** Labor & markup presets for the estimator's preset picker. Authenticated read. */
export const getMarkupPresets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MarkupPreset[]> => {
    const { data, error } = await context.supabase
      .from("markup_options")
      .select(
        "name, hourly_rate, markup_amount, markup_type, include_per_diem, include_commission, is_default",
      )
      .order("sort");
    if (error) throw error;
    return (data ?? []).map((m) => ({
      name: m.name,
      hourlyRate: Number(m.hourly_rate),
      markupAmount: Number(m.markup_amount),
      markupType: m.markup_type,
      includePerDiem: !!m.include_per_diem,
      includeCommission: !!m.include_commission,
      isDefault: !!m.is_default,
    }));
  });

/** Warranty + high-wind pricing tables for the estimator's warranty picker. Authenticated read. */
export const getWarrantyData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [wRes, hwRes] = await Promise.all([
      context.supabase
        .from("warranties")
        .select(
          "name, price_per_sqft, non_master_elite_surcharge, req_thickness, is_high_wind, term_years",
        )
        .order("sort"),
      context.supabase
        .from("high_wind_upcharges")
        .select("term_years, wind_band, mech_per_sqft, adhered_per_sqft")
        .order("sort"),
    ]);
    if (wRes.error) throw wRes.error;
    if (hwRes.error) throw hwRes.error;
    return {
      warranties: (wRes.data ?? []).map((w) => ({
        name: w.name,
        pricePerSqFt: Number(w.price_per_sqft),
        nonMasterEliteSurcharge: Number(w.non_master_elite_surcharge),
        reqThickness: Number(w.req_thickness ?? 40),
        isHighWind: !!w.is_high_wind,
        termYears: Number(w.term_years ?? 15),
      })),
      highWind: (hwRes.data ?? []).map((h) => ({
        termYears: Number(h.term_years),
        windBand: h.wind_band,
        mechPerSqFt: Number(h.mech_per_sqft),
        adheredPerSqFt: Number(h.adhered_per_sqft),
      })),
    };
  });

/** Company header fields for the proposal (any signed-in user; no admin gate). */
export const getCompanyInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CompanyInfo> => {
    const { data, error } = await context.supabase
      .from("company_settings")
      .select("company_name, address, city, state, zip, phone")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    return (
      data ?? {
        company_name: null,
        address: null,
        city: null,
        state: null,
        zip: null,
        phone: null,
      }
    );
  });
