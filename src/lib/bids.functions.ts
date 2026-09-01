import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

// All bid operations require a signed-in user. The user-scoped Supabase client
// from the auth middleware runs under RLS, so the database is the final guard.
export const listBids = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("bids")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

const createBidSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(["draft", "sent", "won", "lost"]).optional(),
});

export const createBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => createBidSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: bid, error } = await context.supabase
      .from("bids")
      .insert({ name: data.name, status: data.status ?? "draft" })
      .select()
      .single();
    if (error) throw error;
    return bid;
  });

const saveBidSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()),
  grandTotal: z.number(),
});

/** Create a new bid or update an existing one (by id) with the full estimator payload. */
export const saveBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => saveBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    const payload = {
      name: data.name,
      data: data.data as Json,
      grand_total: data.grandTotal,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
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
      .insert({ ...payload, status: "draft" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return bid;
  });

const getBidSchema = z.object({ id: z.string().uuid() });

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

/** Warranty + high-wind pricing tables for the estimator's warranty picker. Authenticated read. */
export const getWarrantyData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [wRes, hwRes] = await Promise.all([
      context.supabase
        .from("warranties")
        .select("name, price_per_sqft, non_master_elite_surcharge")
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
