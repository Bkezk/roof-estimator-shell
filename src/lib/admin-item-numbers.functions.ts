import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";

export type ItemNumberRow = Database["public"]["Tables"]["catalog_item_numbers"]["Row"];

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (!data || data.role !== "admin") throw new Error("Forbidden: admin access required");
}

/** Every item-number mapping (Duro-Last catalog), ordered by screen then product. */
export const listItemNumbers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ItemNumberRow[]> => {
    const { data, error } = await context.supabase
      .from("catalog_item_numbers")
      .select("*")
      .order("screen_id")
      .order("row_label")
      .order("price_col");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** A price cell an item number can point at. */
export interface PriceTarget {
  screen_id: string;
  category: string;
  rows: string[];
  price_cols: string[];
  /** Current catalog value per row label → price column (null when blank / non-numeric). */
  values: Record<string, Record<string, number | null>>;
}

const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const LABEL_COLS = new Set(["Description", "Name"]);
const NON_PRICE_COLS = new Set([
  "Part #",
  "Open Part #",
  "Closed Part #",
  "Subtype",
  "Size",
  "Fasteners/Box",
  "Parts/Bag",
  "Parts/Package",
]);

/** The Duro-Last screens' product rows and price columns, for the mapping pickers. */
export const listPriceTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PriceTarget[]> => {
    const { data, error } = await context.supabase
      .from("pricing_catalog")
      .select("id, category, data")
      .eq("branch", "duro_last")
      .order("sort");
    if (error) throw new Error(error.message);
    const out: PriceTarget[] = [];
    for (const s of data ?? []) {
      const d = s.data as {
        kind?: string;
        columns?: string[];
        rows?: Record<string, unknown>[];
        products?: { name: string; price?: unknown }[];
      } | null;
      if (!d) continue;
      if (d.kind === "adhesives") {
        const values: PriceTarget["values"] = {};
        for (const p of d.products ?? []) values[p.name] = { price: numOrNull(p.price) };
        out.push({
          screen_id: s.id,
          category: s.category,
          rows: (d.products ?? []).map((p) => p.name),
          price_cols: ["price"],
          values,
        });
        continue;
      }
      if (d.kind) continue; // Exceptional Metals: no Duro-Last item numbers.
      const cols = d.columns ?? [];
      const labelCol = cols.find((c) => LABEL_COLS.has(c)) ?? cols[0] ?? "Description";
      const priceCols = cols.filter((c) => c !== labelCol && !NON_PRICE_COLS.has(c));
      const values: PriceTarget["values"] = {};
      const rows: string[] = [];
      for (const r of d.rows ?? []) {
        const label = String(r[labelCol] ?? "");
        if (label === "") continue;
        rows.push(label);
        const v: Record<string, number | null> = {};
        for (const c of priceCols) v[c] = numOrNull(r[c]);
        values[label] = v;
      }
      out.push({ screen_id: s.id, category: s.category, rows, price_cols: priceCols, values });
    }
    return out;
  });

const mappingKey = z.object({
  item_no: z.string().trim().min(1),
  screen_id: z.string().min(1),
  row_label: z.string().min(1),
  price_col: z.string().min(1),
});

export const upsertItemNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    mappingKey.extend({ dl_description: z.string().nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("catalog_item_numbers").upsert(
      {
        item_no: data.item_no,
        screen_id: data.screen_id,
        row_label: data.row_label,
        price_col: data.price_col,
        ...(data.dl_description !== undefined ? { dl_description: data.dl_description } : {}),
      },
      { onConflict: "item_no,screen_id,row_label,price_col" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteItemNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => mappingKey.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("catalog_item_numbers")
      .delete()
      .eq("item_no", data.item_no)
      .eq("screen_id", data.screen_id)
      .eq("row_label", data.row_label)
      .eq("price_col", data.price_col);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const importSchema = z.object({
  updates: z
    .array(
      mappingKey.extend({
        price: z.number().finite(),
        dl_description: z.string().optional(),
      }),
    )
    .min(1),
});

export interface AppliedUpdate {
  item_no: string;
  screen_id: string;
  row_label: string;
  price_col: string;
  old: number | null;
  new: number;
}

/**
 * Write the matched prices into the catalog screens (flat rows by label, Adhesives products by
 * name) and stamp the mapping rows with the imported price / date / Duro-Last description.
 * Cells whose row or column no longer exists are reported back, not silently skipped.
 */
export const applyPriceImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => importSchema.parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ applied: AppliedUpdate[]; missing: { item_no: string; reason: string }[] }> => {
      await assertAdmin(context.supabase, context.userId);
      const sb = context.supabase;
      const byScreen = new Map<string, typeof data.updates>();
      for (const u of data.updates) {
        const arr = byScreen.get(u.screen_id);
        if (arr) arr.push(u);
        else byScreen.set(u.screen_id, [u]);
      }
      const applied: AppliedUpdate[] = [];
      const missing: { item_no: string; reason: string }[] = [];
      const now = new Date().toISOString();
      for (const [screenId, ups] of byScreen) {
        const { data: row, error } = await sb
          .from("pricing_catalog")
          .select("data")
          .eq("id", screenId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!row) {
          for (const u of ups)
            missing.push({ item_no: u.item_no, reason: `screen ${screenId} not found` });
          continue;
        }
        const d = row.data as {
          kind?: string;
          columns?: string[];
          rows?: Record<string, unknown>[];
          products?: { name: string; price?: number }[];
        };
        let changed = false;
        for (const u of ups) {
          if (d.kind === "adhesives") {
            const p = (d.products ?? []).find((x) => x.name === u.row_label);
            if (!p) {
              missing.push({ item_no: u.item_no, reason: `adhesive "${u.row_label}" not found` });
              continue;
            }
            const old = typeof p.price === "number" ? p.price : null;
            p.price = u.price;
            changed = true;
            applied.push({ ...u, old, new: u.price });
            continue;
          }
          const cols = d.columns ?? [];
          const labelCol = cols.find((c) => LABEL_COLS.has(c)) ?? cols[0] ?? "Description";
          if (!cols.includes(u.price_col)) {
            missing.push({
              item_no: u.item_no,
              reason: `column "${u.price_col}" not on ${screenId}`,
            });
            continue;
          }
          const target = (d.rows ?? []).find((r) => String(r[labelCol] ?? "") === u.row_label);
          if (!target) {
            missing.push({ item_no: u.item_no, reason: `row "${u.row_label}" not on ${screenId}` });
            continue;
          }
          const oldRaw = target[u.price_col];
          const old = typeof oldRaw === "number" ? oldRaw : oldRaw == null ? null : Number(oldRaw);
          target[u.price_col] = u.price;
          changed = true;
          applied.push({
            ...u,
            old: Number.isFinite(old as number) ? (old as number) : null,
            new: u.price,
          });
        }
        if (changed) {
          const { error: saveErr } = await sb
            .from("pricing_catalog")
            .update({ data: d as unknown as Json })
            .eq("id", screenId);
          if (saveErr) throw new Error(saveErr.message);
        }
      }
      // Stamp the mappings that were applied.
      for (const a of applied) {
        const src = data.updates.find(
          (u) =>
            u.item_no === a.item_no &&
            u.screen_id === a.screen_id &&
            u.row_label === a.row_label &&
            u.price_col === a.price_col,
        );
        const { error: stampErr } = await sb
          .from("catalog_item_numbers")
          .update({
            last_price: a.new,
            last_import_at: now,
            ...(src?.dl_description ? { dl_description: src.dl_description } : {}),
          })
          .eq("item_no", a.item_no)
          .eq("screen_id", a.screen_id)
          .eq("row_label", a.row_label)
          .eq("price_col", a.price_col);
        if (stampErr) throw new Error(stampErr.message);
      }
      return { applied, missing };
    },
  );
