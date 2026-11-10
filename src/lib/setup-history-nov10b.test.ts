/**
 * A change on Setup leaves a History row (owner, Nov 10; re-check record finding 4). Before, a
 * rate, the markup, the authorizer or the checklist could change and only a date moved. Proved
 * live as the test login, rolled back: "Urgent Helper Travel bill rate 40 → 41", "Authorizer
 * Brandon Keck → Admins and managers; email subject '…' → '…'", "Rates confirmed", "Material
 * markup 75 % → 76 %", "Quick Prime 1 Gal cost $54.35 → $55.00", "Checklist: “Seams” moved from 2
 * to 3", "Checklist item “…” added / renamed “…” / removed"; a save that changes nothing and an
 * updated_at-only update wrote no row.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AUDIT_ENTITIES } from "@/lib/audit";
import {
  SETUP_AUDIT_ENTITIES,
  SETUP_HISTORY_ENTITY,
  SETUP_HISTORY_LIMIT,
  SETUP_HISTORY_TABS,
  lastChangedLine,
} from "@/lib/setup-history";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const one = (s: string) => s.replace(/\s+/g, " ");
const flat = one(
  read("supabase/migrations/20261110214000_setup_history.sql").replace(/--[^\n]*/g, ""),
);
const fn = (name: string) => {
  const start = flat.indexOf(`create or replace function public.${name}(`);
  return start < 0 ? "" : flat.slice(start, flat.indexOf("$$;", start) + 3);
};

describe("setup-history.ts", () => {
  it("one audit entity per Setup tab that keeps a History", () => {
    expect([...SETUP_HISTORY_TABS]).toEqual(["rates", "materials", "inspection"]);
    expect(SETUP_HISTORY_ENTITY).toEqual({
      rates: "setup_rates",
      materials: "setup_materials",
      inspection: "setup_checklist",
    });
    expect([...SETUP_AUDIT_ENTITIES]).toEqual([
      "setup_rates",
      "setup_materials",
      "setup_checklist",
    ]);
    expect(SETUP_HISTORY_LIMIT).toBe(20);
  });
  it("lastChangedLine names the newest row's person and day", () => {
    const rows = [
      { at: "2026-11-10T20:36:07.387Z", by_name: "Claude" },
      { at: "2026-11-06T13:58:54.020Z", by_name: "RoAnna Sims" },
    ];
    expect(lastChangedLine(rows, "America/New_York")).toBe("Last changed by Claude, Nov 10, 2026");
    expect(lastChangedLine(rows.slice(1), "America/New_York")).toBe(
      "Last changed by RoAnna Sims, Nov 6, 2026",
    );
  });
  it("nothing logged is not a line, and a row with no name says someone", () => {
    expect(lastChangedLine([])).toBeNull();
    expect(lastChangedLine([{ at: "2026-11-10T20:36:07.387Z", by_name: null }], "UTC")).toBe(
      "Last changed by someone, Nov 10, 2026",
    );
    expect(lastChangedLine([{ at: "2026-11-10T20:36:07.387Z", by_name: "  " }], "UTC")).toBe(
      "Last changed by someone, Nov 10, 2026",
    );
  });
});

describe("20261110214000: the entity check", () => {
  it("is every entity so far plus Setup's three", () => {
    const m = /add constraint audit_log_entity_check check \(entity in \(([^)]*)\)\);/.exec(flat);
    expect(m).not.toBeNull();
    expect(m![1]!.split(",").map((x) => x.trim().replace(/'/g, ""))).toEqual([
      ...AUDIT_ENTITIES,
      ...SETUP_AUDIT_ENTITIES,
    ]);
  });
});

describe("20261110214000: the triggers", () => {
  it.each([
    ["service_rates_audit", "after update on public.service_rates", "audit_setup_rates"],
    ["service_settings_audit", "after update on public.service_settings", "audit_setup_settings"],
    [
      "service_materials_audit",
      "after insert or update or delete on public.service_materials",
      "audit_setup_materials",
    ],
    [
      "inspection_checklist_items_audit",
      "after insert or update or delete on public.inspection_checklist_items",
      "audit_setup_checklist",
    ],
  ])("%s", (name, when, f) => {
    expect(flat).toContain(
      `create trigger ${name} ${when} for each row execute function public.${f}();`,
    );
    expect(fn(f)).toContain(
      "returns trigger language plpgsql security definer set search_path = public",
    );
  });
  it("only the triggers can write a Setup row (users cannot call the logger)", () => {
    expect(flat).toContain(
      "revoke all on function public.audit_setup_log(text, uuid, text, text, jsonb) from public, anon, authenticated;",
    );
    expect(fn("audit_setup_log")).toContain("v_uid uuid := auth.uid();");
    expect(fn("audit_setup_log")).toContain(
      "insert into public.audit_log (by_user, by_name, by_role, entity, entity_id, action, summary, changes)",
    );
  });
  it("a rate: its name, then bill rate / cost rate old → new; an unchanged row writes nothing", () => {
    const f = fn("audit_setup_rates");
    expect(f).toContain("if new.bill_rate is distinct from old.bill_rate then");
    expect(f).toContain("if new.cost_rate is distinct from old.cost_rate then");
    expect(f).toContain("if cardinality(v_parts) = 0 then return null; end if;");
    expect(f).toContain(
      "initcap(new.rate_kind) || ' ' || initcap(new.role) || ' ' || initcap(new.time_kind) || ' ' || array_to_string(v_parts, '; ')",
    );
    expect(f).not.toContain("updated_at");
  });
  it("the settings: authorizer by name, the wording, tax, the confirm stamp; the markup on its own tab", () => {
    const f = fn("audit_setup_settings");
    expect(f).toContain("case when old.authorizer_id is null then 'Admins and managers'");
    expect(f).toContain(
      "foreach v_col in array array['email_subject', 'email_message', 'payment_terms', 'invoice_contact'] loop",
    );
    expect(f).toContain("'tax rate ' || public.audit_setup_pct(old.tax_rate)");
    expect(f).toContain("then 'rates confirmation cleared' else 'rates confirmed' end");
    expect(f).toContain(
      "perform public.audit_setup_log('setup_rates', null, 'update', upper(left(v_line, 1)) || substr(v_line, 2), v_changes);",
    );
    expect(f).toContain(
      "perform public.audit_setup_log('setup_materials', null, 'update', 'Material markup ' || public.audit_setup_pct(old.material_markup) || ' → ' || public.audit_setup_pct(new.material_markup)",
    );
    expect(f).not.toMatch(/old\.updated_at|new\.updated_at|rates_confirmed_by_name/);
  });
  it("a material: added, removed, renamed, cost in dollars, unit, group, hidden / shown again", () => {
    const f = fn("audit_setup_materials");
    expect(f).toContain("new.name || ' added: cost ' || public.audit_setup_money(new.cost)");
    expect(f).toContain("old.name || ' removed'");
    expect(f).toContain(
      "'cost ' || public.audit_setup_money(old.cost) || ' → ' || public.audit_setup_money(new.cost)",
    );
    expect(f).toContain("case when new.active then 'shown again' else 'hidden' end");
    expect(f).toContain(
      "perform public.audit_setup_log('setup_materials', new.id, 'update', old.name || ' ' || array_to_string(v_parts, '; '), v_changes);",
    );
    expect(fn("audit_setup_money")).toContain("'$' || to_char(v, 'FM999,999,990.00')");
    expect(fn("audit_setup_pct")).toContain("trim_scale(round(v * 100, 4))::text || ' %'");
  });
  it("a checklist item: added, removed, renamed (a move is the save's line, below)", () => {
    const f = fn("audit_setup_checklist");
    expect(f).toContain("'Checklist item “' || new.label || '” added'");
    expect(f).toContain("'Checklist item “' || old.label || '” removed'");
    expect(f).toContain("'Checklist item “' || old.label || '” renamed “' || new.label || '”'");
    expect(f).not.toContain("sort");
  });
});

describe("20261110214000: save_checklist_items", () => {
  const f = fn("save_checklist_items");
  it("is an admin's or Estimate Pricing's, as the table's own policy", () => {
    expect(f).toContain(
      "if not (public.is_admin() or public.has_access('pricing')) then raise exception 'Only an admin (or Estimate Pricing) edits the checklist' using errcode = '42501'; end if;",
    );
    expect(flat).toContain(
      "revoke all on function public.save_checklist_items(jsonb) from public, anon;",
    );
    expect(flat).toContain(
      "grant execute on function public.save_checklist_items(jsonb) to authenticated;",
    );
  });
  it("removes what was left out, then updates or adds in the order given (10, 20, …)", () => {
    expect(f).toContain(
      "delete from public.inspection_checklist_items c where not (c.id = any (v_keep));",
    );
    expect(f).toContain("with ordinality t(value, o) order by t.o");
    expect(f).toContain("set label = v ->> 'label', sort = i * 10 where id = (v ->> 'id')::uuid");
    expect(f).toContain(
      "insert into public.inspection_checklist_items (label, sort) values (v ->> 'label', i * 10)",
    );
    expect(f).toContain(
      "raise exception 'That checklist item is no longer on the list — reload' using errcode = 'P0002';",
    );
  });
  it("writes one moved line only when the kept items' order changed", () => {
    expect(f).toContain("if v_old_kept is distinct from v_new_kept then");
    expect(f).toContain("'Checklist: “' || v_label || '” moved from ' || v_from || ' to ' || v_to");
    expect(f).toContain(
      "jsonb_build_object('from', to_jsonb(v_old_labels), 'to', to_jsonb(v_new_labels))",
    );
  });
});

describe("the server side", () => {
  const save = read("src/lib/service-inspection.functions.ts");
  const list = read("src/lib/setup-history.functions.ts");
  it("saveChecklistItems saves through the one function, no longer row by row", () => {
    const body = one(save.slice(save.indexOf("export const saveChecklistItems")));
    const end = body.indexOf("// ── A ticket's inspection");
    const handler = body.slice(0, end);
    expect(handler).toContain('await sb.rpc("save_checklist_items", { p_items:');
    expect(handler).not.toMatch(/\.delete\(\)|\.insert\(|\.update\(/);
    // It still checks who and refuses a label twice before the database is asked.
    expect(handler).toContain('canAccess(p, "pricing")');
    expect(handler).toContain("is on the list twice");
  });
  it("the generated types list the function", () => {
    expect(read("src/integrations/supabase/types.ts")).toContain(
      "      save_checklist_items: { Args: { p_items: Json }; Returns: undefined }\n",
    );
  });
  it("listSetupHistory is an admin's or a manager's, one tab, newest first, 20 lines", () => {
    const body = one(list);
    expect(body).toContain("z.object({ tab: z.enum(SETUP_HISTORY_TABS) })");
    expect(body).toContain(
      'if (!seesEveryone(p)) throw new Error("The history is for admins and managers");',
    );
    expect(body).toContain('.eq("entity", SETUP_HISTORY_ENTITY[data.tab])');
    expect(body).toContain(
      '.order("at", { ascending: false }) .order("id", { ascending: false }) .limit(SETUP_HISTORY_LIMIT);',
    );
  });
});

describe("the Setup page", () => {
  const box = read("src/components/setup-history.tsx");
  it.each([
    ["src/components/service-rates-settings.tsx", "rates", 2],
    ["src/components/service/material-pricing-settings.tsx", "materials", 1],
    ["src/components/service/inspection-checklist-settings.tsx", "inspection", 1],
  ])("%s shows its History and refreshes it after a save", (file, tab, saves) => {
    const src = read(file);
    expect(src).toContain(
      'import { SETUP_HISTORY_KEY, SetupHistory } from "@/components/setup-history";',
    );
    expect(src).toContain(`<SetupHistory tab="${tab}" />`);
    expect(
      src.match(/void qc\.invalidateQueries\(\{ queryKey: SETUP_HISTORY_KEY \}\);/g),
    ).toHaveLength(saves);
  });
  it("the line says who changed it last; the fold lists the lines; others see nothing", () => {
    expect(box).toContain("if (!allowed) return null;");
    expect(box).toContain('<span data-line="last-changed">{lastChangedLine(rows)}</span>');
    expect(box).toContain("No changes logged yet. Changes are recorded from Nov 10, 2026.");
    expect(box).toContain("{auditLine(r)}");
    expect(box).toContain("enabled: !!session && allowed,");
  });
});
