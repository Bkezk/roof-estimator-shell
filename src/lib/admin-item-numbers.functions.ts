import { createServerFn } from "@tanstack/react-start";
import {
  PACK_QTY_COLS,
  pieceDefFromPack,
  pieceDefFromUnitType,
  type PieceDef,
} from "@/lib/stock-units";
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
  /** The screen's pack-quantity column ("Fasteners/Box", "Parts/Bag", "Parts/Package"), if any. */
  pack_col?: string;
  /** Pack quantity per row label (units per box / bag / package) when the screen has one. */
  packs?: Record<string, number | null>;
  /** Adhesives: the product's own unit ("5-gal. Box Set", "4-Cartridge Case", …) per row. */
  row_units?: Record<string, string>;
  /** Pieces one priced pack holds, per row, where the catalog says (stock-units.ts). */
  pieces?: Record<string, PieceDef>;
}

const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

import { labelColOf, rowKeys } from "@/lib/catalog-row-key";
import {
  applyUpdatesToScreen,
  revertChangesOnScreen,
  type AppliedUpdate,
  type ScreenData,
} from "@/lib/price-import-apply";
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
        products?: { name: string; price?: unknown; unit_type?: unknown }[];
      } | null;
      if (!d) continue;
      if (d.kind === "adhesives") {
        const values: PriceTarget["values"] = {};
        const rowUnits: Record<string, string> = {};
        const pieces: Record<string, PieceDef> = {};
        for (const p of d.products ?? []) {
          values[p.name] = { price: numOrNull(p.price) };
          if (typeof p.unit_type === "string" && p.unit_type.trim()) {
            rowUnits[p.name] = p.unit_type.trim();
            const def = pieceDefFromUnitType(p.unit_type);
            if (def) pieces[p.name] = def;
          }
        }
        out.push({
          screen_id: s.id,
          category: s.category,
          rows: (d.products ?? []).map((p) => p.name),
          price_cols: ["price"],
          values,
          row_units: rowUnits,
          pieces,
        });
        continue;
      }
      if (d.kind) continue; // Exceptional Metals: no Duro-Last item numbers.
      const cols = d.columns ?? [];
      const labelCol = labelColOf(cols);
      const priceCols = cols.filter((c) => c !== labelCol && !NON_PRICE_COLS.has(c));
      const values: PriceTarget["values"] = {};
      const rows: string[] = [];
      const packCol = PACK_QTY_COLS.find((c) => cols.includes(c));
      const packs: Record<string, number | null> = {};
      // Rows are addressed by their KEY: the label, or "label [Subtype|Part #]" where the label
      // repeats on the screen (catalog-row-key.ts).
      const keys = rowKeys(cols, d.rows ?? []);
      for (const [i, r] of (d.rows ?? []).entries()) {
        const label = keys[i]!;
        if (label === "") continue;
        rows.push(label);
        const v: Record<string, number | null> = {};
        for (const c of priceCols) v[c] = numOrNull(r[c]);
        values[label] = v;
        if (packCol) packs[label] = numOrNull(r[packCol]);
      }
      const pieces: Record<string, PieceDef> = {};
      if (packCol)
        for (const [label, q] of Object.entries(packs)) {
          const def = pieceDefFromPack(packCol, q);
          if (def) pieces[label] = def;
        }
      out.push({
        screen_id: s.id,
        category: s.category,
        rows,
        price_cols: priceCols,
        values,
        ...(packCol ? { pack_col: packCol, packs, pieces } : {}),
      });
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
    mappingKey
      .extend({
        dl_description: z.string().nullable().optional(),
        /** The admin vouches for this number → product pairing under this sheet wording. */
        confirmed_description: z.string().nullable().optional(),
      })
      .parse(d),
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
        ...(data.confirmed_description !== undefined
          ? {
              confirmed_description: data.confirmed_description,
              confirmed_at: data.confirmed_description ? new Date().toISOString() : null,
            }
          : {}),
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

const addProductSchema = z.object({
  screen_id: z.string().min(1),
  /** The new product's name (label column). */
  row_label: z.string().trim().min(1),
  price_col: z.string().min(1),
  price: z.number().finite(),
  item_no: z.string().trim().min(1),
  dl_description: z.string().optional(),
});

/**
 * Add a product the catalog never had (from a price-sheet line): appends a row to a flat
 * Duro-Last screen — name in the label column, the price in the chosen column, every other
 * price/count column 0, the legacy "Part #" column(s) set to the item number — and maps the item
 * number to that cell so later imports keep it current. Master-detail screens (Adhesives,
 * Exceptional Metals) keep their own editors.
 */
export const addCatalogProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => addProductSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const { data: row, error } = await sb
      .from("pricing_catalog")
      .select("data, branch")
      .eq("id", data.screen_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(`Screen ${data.screen_id} not found`);
    if (row.branch !== "duro_last")
      throw new Error("Only Duro-Last screens take imported products");
    const d = row.data as {
      kind?: string;
      columns?: string[];
      rows?: Record<string, unknown>[];
    };
    if (d.kind) throw new Error("This screen has its own editor — add the product there");
    const cols = d.columns ?? [];
    const labelCol = labelColOf(cols);
    if (!cols.includes(data.price_col) || data.price_col === labelCol)
      throw new Error(`"${data.price_col}" is not a price column on this screen`);
    const rows = d.rows ?? [];
    const dup = rows.find(
      (r) =>
        String(r[labelCol] ?? "")
          .trim()
          .toLowerCase() === data.row_label.toLowerCase(),
    );
    if (dup) throw new Error(`"${data.row_label}" is already on this screen — map it instead`);
    const next: Record<string, unknown> = {};
    for (const c of cols) {
      if (c === labelCol) next[c] = data.row_label;
      else if (/part\s*#/i.test(c)) next[c] = data.item_no;
      else if (NON_PRICE_COLS.has(c)) next[c] = 0;
      else next[c] = c === data.price_col ? data.price : 0;
    }
    rows.push(next);
    d.rows = rows;
    const { error: saveErr } = await sb
      .from("pricing_catalog")
      .update({ data: d as unknown as Json })
      .eq("id", data.screen_id);
    if (saveErr) throw new Error(saveErr.message);
    const { error: mapErr } = await sb.from("catalog_item_numbers").upsert(
      {
        item_no: data.item_no,
        screen_id: data.screen_id,
        row_label: data.row_label,
        price_col: data.price_col,
        dl_description: data.dl_description ?? null,
        last_price: data.price,
        last_import_at: new Date().toISOString(),
      },
      { onConflict: "item_no,screen_id,row_label,price_col" },
    );
    if (mapErr) throw new Error(mapErr.message);
    return { ok: true };
  });

const importSchema = z.object({
  file_name: z.string().max(300).optional(),
  updates: z
    .array(
      mappingKey.extend({
        price: z.number().finite(),
        dl_description: z.string().optional(),
      }),
    )
    .min(1),
});

export type { AppliedUpdate } from "@/lib/price-import-apply";

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
    }): Promise<{
      applied: AppliedUpdate[];
      missing: { item_no: string; reason: string }[];
      run_id: string | null;
    }> => {
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
        const d = row.data as ScreenData;
        const r = applyUpdatesToScreen(screenId, d, ups);
        applied.push(...r.applied);
        missing.push(...r.missing);
        const changed = r.changed;
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
      // Audit log: the run and every cell it wrote (old → new), so it can be reverted.
      let runId: string | null = null;
      if (applied.length) {
        const { data: me } = await sb
          .from("profiles")
          .select("full_name, email")
          .eq("id", context.userId)
          .maybeSingle();
        const { data: run, error: runErr } = await sb
          .from("price_import_runs")
          .insert({
            created_by: context.userId,
            created_by_name: me?.full_name?.trim() || me?.email || null,
            file_name: data.file_name ?? "(price sheet)",
            cells_written: applied.length,
            cells_changed: applied.filter((a) => a.old !== a.new).length,
          })
          .select("id")
          .single();
        if (runErr) throw new Error(runErr.message);
        runId = run.id;
        const { error: chErr } = await sb.from("price_import_changes").insert(
          applied.map((a) => ({
            run_id: run.id,
            screen_id: a.screen_id,
            row_label: a.row_label,
            price_col: a.price_col,
            item_no: a.item_no,
            sheet_description:
              data.updates.find(
                (u) =>
                  u.item_no === a.item_no &&
                  u.screen_id === a.screen_id &&
                  u.row_label === a.row_label &&
                  u.price_col === a.price_col,
              )?.dl_description ?? null,
            old_price: a.old,
            new_price: a.new,
          })),
        );
        if (chErr) throw new Error(chErr.message);
      }
      return { applied, missing, run_id: runId };
    },
  );

export interface PriceImportRun {
  id: string;
  created_at: string;
  created_by_name: string | null;
  file_name: string;
  cells_written: number;
  cells_changed: number;
  reverted_at: string | null;
  revert_note: string | null;
}
export interface PriceImportChange {
  id: number;
  screen_id: string;
  row_label: string;
  price_col: string;
  item_no: string;
  sheet_description: string | null;
  old_price: number | null;
  new_price: number;
  reverted_at: string | null;
}

/** Import history, newest first. */
export const listPriceImportRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PriceImportRun[]> => {
    const { data, error } = await context.supabase
      .from("price_import_runs")
      .select(
        "id, created_at, created_by_name, file_name, cells_written, cells_changed, reverted_at, revert_note",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** The cells one run wrote. */
export const listPriceImportChanges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ run_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PriceImportChange[]> => {
    const { data: rows, error } = await context.supabase
      .from("price_import_changes")
      .select(
        "id, screen_id, row_label, price_col, item_no, sheet_description, old_price, new_price, reverted_at",
      )
      .eq("run_id", data.run_id)
      .order("id");
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      ...r,
      old_price: r.old_price === null ? null : Number(r.old_price),
      new_price: Number(r.new_price),
    }));
  });

/**
 * Put back every cell a run wrote — only where the cell STILL holds the run's new price (a
 * cell edited since is left alone and reported) — and mark the run reverted.
 */
export const revertPriceImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ run_id: z.string().uuid() }).parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ reverted: number; skipped: { cell: string; reason: string }[] }> => {
      await assertAdmin(context.supabase, context.userId);
      const sb = context.supabase;
      const { data: run, error: runErr } = await sb
        .from("price_import_runs")
        .select("id, reverted_at")
        .eq("id", data.run_id)
        .maybeSingle();
      if (runErr) throw new Error(runErr.message);
      if (!run) throw new Error("Import run not found");
      if (run.reverted_at) throw new Error("This import was already reverted");
      const { data: changes, error: chErr } = await sb
        .from("price_import_changes")
        .select("id, screen_id, row_label, price_col, old_price, new_price, reverted_at")
        .eq("run_id", data.run_id)
        .is("reverted_at", null);
      if (chErr) throw new Error(chErr.message);
      const byScreen = new Map<string, typeof changes>();
      for (const c of changes ?? []) {
        const arr = byScreen.get(c.screen_id);
        if (arr) arr.push(c);
        else byScreen.set(c.screen_id, [c]);
      }
      const skipped: { cell: string; reason: string }[] = [];
      const revertedIds: number[] = [];
      const now = new Date().toISOString();
      for (const [screenId, list] of byScreen) {
        const { data: row, error } = await sb
          .from("pricing_catalog")
          .select("data")
          .eq("id", screenId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!row) {
          for (const c of list ?? [])
            skipped.push({ cell: `${c.row_label} · ${c.price_col}`, reason: "screen gone" });
          continue;
        }
        const d = row.data as ScreenData;
        const r = revertChangesOnScreen(
          screenId,
          d,
          (list ?? []).map((c) => ({
            id: c.id,
            screen_id: c.screen_id,
            row_label: c.row_label,
            price_col: c.price_col,
            old_price: c.old_price === null ? null : Number(c.old_price),
            new_price: Number(c.new_price),
          })),
        );
        skipped.push(...r.skipped);
        revertedIds.push(...r.revertedIds);
        const changed = r.changed;
        if (changed) {
          const { error: saveErr } = await sb
            .from("pricing_catalog")
            .update({ data: d as unknown as Json })
            .eq("id", screenId);
          if (saveErr) throw new Error(saveErr.message);
        }
      }
      if (revertedIds.length) {
        const { error } = await sb
          .from("price_import_changes")
          .update({ reverted_at: now })
          .in("id", revertedIds);
        if (error) throw new Error(error.message);
      }
      const { error: markErr } = await sb
        .from("price_import_runs")
        .update({
          reverted_at: now,
          reverted_by: context.userId,
          revert_note: skipped.length ? `${skipped.length} cell(s) left as edited since` : null,
        })
        .eq("id", data.run_id);
      if (markErr) throw new Error(markErr.message);
      return { reverted: revertedIds.length, skipped };
    },
  );
