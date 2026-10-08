/**
 * Owner, Oct 8: "the materials on service do need to sync with prices of the estimate pricing
 * materials where there is overlap … when estimate pricing materials are updated it should auto
 * update the service material pricing." The overlap is the stock link a service material carries
 * to its Estimate Pricing cell; migration 20261008170000 makes a linked material's cost that
 * cell's price (× stock units per unit) and keeps it there: a trigger on pricing_catalog re-costs
 * on every Estimate Pricing save, a trigger on service_materials on insert / update, and the
 * Material pricing screen shows the cost read-only with the cell it follows.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { priceSource } from "@/lib/service-materials";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const FILE = "supabase/migrations/20261008170000_service_materials_follow_estimate_pricing.sql";
const sql = read(FILE).replace(/--[^\n]*/g, "");
const flat = sql.replace(/\s+/g, " ");

describe("the migration", () => {
  it("reads a cell the way the app does: Description or Name label, 'label [Subtype|Part #]' for a repeat, Adhesives by product name, blank = null", () => {
    expect(flat).toContain(
      "create or replace function public.catalog_cell_price( p_screen text, p_row_label text, p_price_col text ) returns numeric",
    );
    expect(flat).toContain("where c in ('Description', 'Name') limit 1");
    expect(flat).toContain("if d->>'kind' = 'adhesives' then");
    expect(flat).toContain("where p->>'name' = p_row_label limit 1");
    expect(flat).toContain("p_row_label = lbl || ' [' || disc || ']'");
    expect(flat).toContain(
      "coalesce(nullif(btrim(coalesce(r->>'Subtype', '')), ''), nullif(btrim(coalesce(r->>'Part #', '')), ''))",
    );
    expect(flat).toContain("return case when v ~ '^-?[0-9]+(\\.[0-9]+)?$' then v::numeric end;");
    expect(flat).toContain("if p_price_col = label_col then return null; end if;");
  });
  it("costs a linked material at the cell price × stock units per unit (an ISO board = 32 sq ft)", () => {
    expect(flat).toContain(
      "select round(public.catalog_cell_price(p_screen, p_row_label, p_price_col) * coalesce(p_stock_per_unit, 1), 4);",
    );
  });
  it("re-costs on every Estimate Pricing save and never writes Estimate Pricing", () => {
    expect(flat).toContain(
      "create trigger pricing_catalog_recost_service after insert or update of data on public.pricing_catalog",
    );
    expect(flat).toContain(
      "if tg_op = 'UPDATE' and new.data is not distinct from old.data then return new; end if;",
    );
    expect(flat).toContain("perform public.sync_service_material_costs(new.id);");
    expect(sql).not.toMatch(
      /(update|insert into|delete from|alter table)\s+public\.pricing_catalog/i,
    );
  });
  it("the sync touches only linked rows whose cell has a price, and only when it differs", () => {
    expect(flat).toContain(
      "where m.stock_screen_id is not null and (p_screen is null or m.stock_screen_id = p_screen)",
    );
    expect(flat).toContain("where w.id = m.id and w.cost is not null and w.cost <> m.cost;");
    expect(flat).toContain("select public.sync_service_material_costs(null);");
  });
  it("a linked material takes the catalog cost on insert and update; a blank cell leaves the cost alone; service-only rows keep theirs", () => {
    expect(flat).toContain(
      "create trigger service_materials_follow_catalog before insert or update on public.service_materials",
    );
    expect(flat).toContain("if new.stock_screen_id is not null then");
    expect(flat).toContain("if c is not null then new.cost := c; end if;");
  });
  it("its functions are not callable by anyone (security definer, revoked from public)", () => {
    for (const f of [
      "catalog_cell_price(text, text, text)",
      "service_material_catalog_cost(text, text, text, numeric)",
      "sync_service_material_costs(text)",
      "pricing_catalog_recost_service()",
      "service_material_follows_catalog()",
    ])
      expect(flat).toContain(`revoke all on function public.${f} from public;`);
  });
});

describe("Setup › Material pricing", () => {
  it("names the Estimate Pricing cell a shared material follows", () => {
    expect(
      priceSource({
        stock_screen_id: "duro_last:pipe_stacks",
        stock_row_label: '2" Closed/Open',
        stock_price_col: "Price",
      }),
    ).toBe('Estimate Pricing › Pipe Stacks › 2" Closed/Open › Price');
    expect(
      priceSource({
        stock_screen_id: "duro_last:underlayment",
        stock_row_label: '2" ISO',
        stock_price_col: "Cost/Sq. Ft.",
        stock_per_unit: 32,
      }),
    ).toBe('Estimate Pricing › Underlayment › 2" ISO › Cost/Sq. Ft. × 32');
    expect(
      priceSource({ stock_screen_id: null, stock_row_label: null, stock_price_col: null }),
    ).toBeNull();
  });
  it("shows that cost read-only, with where to change it", () => {
    const tab = read("src/components/service/material-pricing-settings.tsx").replace(/\s+/g, " ");
    expect(tab).toContain("readOnly={!!r.source}");
    expect(tab).toContain("title={r.source ? `From ${r.source} — change it there` : undefined}");
    expect(tab).toContain("source: priceSource(m),");
    expect(tab).toContain(
      "takes its price from there (grey box: change it on Estimate Pricing and it follows)",
    );
  });
});
