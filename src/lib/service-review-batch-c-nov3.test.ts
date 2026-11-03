/**
 * Service review, Nov 3 (owner: "go with … 32 … 42, 43, 44, … 47, 48, 49, 50 (data in that
 * should be useful not just raw data) 52, 53"), batch C — the data layer and the tidying. Each
 * test fails on the code before the change.
 *
 *   32  Setup asks before a checklist item is removed
 *   42  stock on hand comes summed from the database (inventory_stock_cells)
 *   43  quick + taps on one cell are one write
 *   44  a ticket save: the roster once, the stage notices only when the stage moved, the
 *       pre-reads together
 *   47  the invoice autosave sets the page cache only; the preview waits four seconds
 *   49  error messages in plain English; the internal strings gone
 *   50  the audit log: the ticket's field bookkeeping is silent, the inspection is a sentence,
 *       a contact has one source
 *   52  one set of ticket stages (ticket-stages.test.ts has the rest)
 *   53  the dead code and the stale header
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { TAP_QUIET_MS } from "@/components/service/materials-section";
import { PREVIEW_DEBOUNCE_MS } from "@/components/service/invoice-editor";
import { errText as fieldErrText } from "@/components/service/field-utils";
import { errText as invoiceErrText } from "@/components/service/invoice-utils";
import { plainError, plainErrText } from "@/lib/plain-error";
import { technicianRoster, rosterDisplayName } from "@/lib/roster.server";
import { readStock } from "@/lib/inventory.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const inventory = read("src/lib/inventory.functions.ts");
const materials = read("src/components/service/materials-section.tsx");
const service = read("src/lib/service.functions.ts");
const events = read("src/lib/ticket-events.server.ts");
const editor = read("src/components/service/invoice-editor.tsx");
const audit = read("supabase/migrations/20261103210000_audit_ticket_quiet.sql");

describe("32. Setup asks before a checklist item is removed", () => {
  const src = read("src/components/service/inspection-checklist-settings.tsx");
  it("the trash can opens a dialog; Remove there takes the item off the list", () => {
    expect(src).toContain("const [removing, setRemoving] = useState<Row | null>(null);");
    expect(src).toContain("onClick={() => setRemoving(r)}");
    expect(src).not.toContain("onClick={() => edit(rows.filter((x) => x.key !== r.key))}");
    expect(src).toContain("from the checklist?");
    expect(src).toContain("<AlertDialogCancel>Keep it</AlertDialogCancel>");
    expect(src).toContain(
      "if (removing && rows) edit(rows.filter((x) => x.key !== removing.key));",
    );
    expect(src).toContain("Nothing changes until you press Save.");
  });
});

describe("42. stock on hand comes summed from the database", () => {
  it("the view: one row per cell and location, the sum, the newest unit and time; security_invoker", () => {
    const sql = read("supabase/migrations/20261103200000_stock_cells_view.sql");
    expect(sql).toContain("create or replace view public.inventory_stock_cells");
    expect(sql).toContain("security_invoker = true");
    expect(sql).toContain("sum(m.qty)::numeric as on_hand");
    expect(sql).toContain("max(m.created_at) as last_at");
    expect(sql).toContain("(array_agg(m.unit order by m.created_at desc, m.id desc))[1] as unit");
    expect(sql).toContain("group by m.location_id, m.screen_id, m.row_label, m.price_col;");
    expect(sql).toContain(
      "grant select on public.inventory_stock_cells to authenticated, service_role;",
    );
  });
  it("readStock reads the view, not the ledger page by page", () => {
    expect(inventory).toContain('.from("inventory_stock_cells")');
    expect(inventory).toContain(
      '.select("location_id, screen_id, row_label, price_col, on_hand, last_at, unit")',
    );
    expect(inventory).not.toContain("readAllMovements(");
    expect(inventory).not.toContain('from "@/lib/inventory-reconcile.functions"');
  });
  it("the rows are the cells: summed on hand, the newest unit and time, the labels as before", async () => {
    const cell = { screen_id: "s1", row_label: "Plates", price_col: "a" };
    const env = fakeSupabase({
      inventory_locations: [{ id: "shop", name: "Shop", kind: "shop", sort: 0, active: true }],
      inventory_movements: [
        {
          id: "m1",
          location_id: "shop",
          ...cell,
          unit: "box",
          qty: 5,
          created_at: "2026-10-01T00:00:00Z",
        },
        {
          id: "m2",
          location_id: "shop",
          ...cell,
          unit: "case",
          qty: -2,
          created_at: "2026-10-02T00:00:00Z",
        },
        {
          id: "m3",
          location_id: "truck",
          ...cell,
          unit: "box",
          qty: 1,
          created_at: "2026-10-03T00:00:00Z",
        },
      ],
      pricing_catalog: [{ id: "s1", branch: "duro_last", category: "Fasteners", data: {} }],
      catalog_item_numbers: [{ ...cell, item_no: "1106" }],
      service_materials_catalog: [],
      service_materials: [],
    });
    const rows = await readStock(env.db);
    expect(rows.map((r) => [r.location_id, r.on_hand, r.unit, r.last_at, r.item_nos])).toEqual([
      ["shop", 3, "case", "2026-10-02T00:00:00Z", ["1106"]],
      ["truck", 1, "box", "2026-10-03T00:00:00Z", ["1106"]],
    ]);
    expect(rows[0]?.category).toBe("Fasteners");
  });
});

describe("43. quick + taps on one cell are one write", () => {
  it("600 ms after the last tap the total goes as one entry; the count moves at once", () => {
    expect(TAP_QUIET_MS).toBe(600);
    const add = materials.slice(
      materials.indexOf(
        "const add = (r: ListRow, units: number, checkStock = true, shortOk = false) => {",
      ),
      materials.indexOf("const sendAdd = (r: ListRow, units: number, ok: boolean) => {"),
    );
    expect(add).toContain("queueAdd(r, units, ok);");
    expect(add).not.toContain("enqueue(r.key, units,");
    expect(add).toContain("bump(r.key, units);");
    expect(add).toContain("const total = round6((prev?.units ?? 0) + units);");
    expect(add).toContain("timer: setTimeout(() => flushTap(r.key), TAP_QUIET_MS),");
    expect(add).toContain("if (prev) clearTimeout(prev.timer);");
    // The flush hands the total to the one write and takes the optimistic count back (the
    // pending entry puts it on again).
    expect(add).toContain("bump(key, -t.units);\n    sendAdd(t.r, t.units, t.ok);");
    // The screen closing sends what is still waiting.
    expect(add).toContain("for (const key of [...taps.keys()]) flushTap(key);");
  });
});

describe("44. a ticket save: the roster once, the notices only when the stage moved, the pre-reads together", () => {
  it("technicianRoster reads technician_options once per client", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { id: "t1", full_name: " Tia ", email: "tia@x.com", technician: true },
        { id: "o1", full_name: "", email: "office@x.com", technician: false },
      ],
      error: null,
    }));
    const sb = { rpc } as never;
    const [a, b] = await Promise.all([technicianRoster(sb), technicianRoster(sb)]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.map(rosterDisplayName)).toEqual(["Tia", "office@x.com"]);
    // Another request (another client object) reads for itself.
    await technicianRoster({ rpc } as never);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("a failed read is an empty roster, said in the log", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = { rpc: vi.fn(async () => ({ data: null, error: { message: "down" } })) } as never;
    expect(await technicianRoster(sb)).toEqual([]);
    expect(err).toHaveBeenCalledWith("technician_options failed — down");
    err.mockRestore();
  });
  it("the ticket save, the stage notices and the dispatch notices read the roster through it", () => {
    expect(service).toContain("const techs = await technicianRoster(sb);");
    expect(service).not.toContain('const { data: techs } = await sb.rpc("technician_options");');
    expect(events).toContain("return (await technicianRoster(sb))");
    expect(events).toContain("const u = (await technicianRoster(sb)).find((r) => r.id === id);");
    expect(events).not.toContain('await sb.rpc("technician_options")');
  });
  it("afterTicketStage runs only when the stage moved, the ticket was deleted or restored", () => {
    expect(service).toContain(
      "if (prevStage !== row.stage || !!row.deleted_at || opts.quiet)\n    await afterTicketStage(row, prevStage, actor, sb);",
    );
    expect(service).not.toContain("\n  await afterTicketStage(row, prevStage, actor, sb);");
  });
  it("saveServiceJob reads the customer, the property (or its count) and the site together", () => {
    const save = service.slice(
      service.indexOf("const { id, ...fields } = data;"),
      service.indexOf('if (!customer_name.trim()) throw new Error("Pick or add the customer");'),
    );
    expect(save).toContain(
      "const [accountRead, siteRead, siteCountRead, locationRead] = await Promise.all([",
    );
    expect(save).toContain('if (!a) throw new Error("Customer not found");');
    expect(save).toContain('throw new Error("That property does not belong to the customer");');
    expect(save).toContain("siteProblem({ siteCount: siteCountRead.count ?? 0, site_id: null })");
    expect(save).toContain("if (!loc || loc.property_id !== fields.site_id)");
    expect(save.match(/await /g)?.length).toBe(1);
  });
});

describe("47. the invoice autosave sets the page cache only; the preview waits", () => {
  it("applied(r, { quiet }) marks the lists stale without a read; finalize / paid refresh the ticket", () => {
    expect(editor).toContain(
      "applied: (r: InvoiceWithLines, opts?: { stage?: boolean; quiet?: boolean }) => void;",
    );
    expect(editor).toContain("const refreshLists = (jid: string, refetch = true) => {");
    expect(editor).toContain('const refetchType = refetch ? "active" : "none";');
    expect(editor).toContain('void qc.invalidateQueries({ queryKey: ["invoices"], refetchType });');
    expect(editor).toContain(
      "refreshLists(job.id, !opts?.quiet);\n      if (opts?.stage) refreshTicket(job.id);",
    );
    expect(editor).toContain("ctx.applied(r, { quiet: true });");
    expect(editor).toContain("ctx.applied(r, { stage: true });");
    expect(editor).toContain("ctx.applied(r, { stage: r.ticket_closed });");
    expect(editor).not.toContain("ctx.applied(r, true)");
  });
  it("the PDF preview is drawn four seconds after a save, at once when the pane opens", () => {
    expect(PREVIEW_DEBOUNCE_MS).toBe(4000);
    expect(editor).toContain("hasView.current ? PREVIEW_DEBOUNCE_MS : 0,");
  });
});

describe("49. error messages in plain English", () => {
  it("what the database or the server said becomes a sentence; a sentence passes through", () => {
    expect(plainError('new row violates row-level security policy for table "service_jobs"')).toBe(
      "You do not have permission to change this. Ask the office.",
    );
    expect(plainError('duplicate key value violates unique constraint "x"')).toBe(
      "That one already exists.",
    );
    expect(plainError("JSON object requested, multiple (or no) rows returned")).toBe(
      "That record was not found. It may have been deleted.",
    );
    expect(plainError("TypeError: Failed to fetch")).toBe(
      "No signal. Check your connection and try again.",
    );
    expect(plainError("Unauthorized")).toBe("You are signed out. Sign in again.");
    expect(plainError("Forbidden: Service access required")).toBe(
      "You do not have Service access. Ask an admin.",
    );
    expect(plainError("Forbidden: admin only")).toBe("Only an admin can do this.");
    expect(plainError("Forbidden: only the assignee")).toBe("Only the assignee");
    expect(plainError('violates check constraint "service_jobs_stage_check"')).toBe(
      "That value is not allowed here.",
    );
    expect(plainError("canceling statement due to statement timeout")).toBe(
      "That took too long. Try again in a moment.",
    );
    expect(plainError("Pick or add the customer")).toBe("Pick or add the customer");
  });
  it("a refused input (zod's JSON) is its messages, once each", () => {
    const issues = JSON.stringify([
      { code: "too_small", path: ["description"], message: "Say what the ticket is for" },
      { code: "invalid_type", path: ["scheduled_date"], message: "Pick a day" },
      { code: "custom", path: ["x"], message: "Pick a day" },
    ]);
    expect(plainError(issues)).toBe("Say what the ticket is for; Pick a day");
    expect(plainError("[]")).toBe("Something in the form is not right");
    expect(plainError("[not json")).toBe("[not json");
  });
  it("plainErrText takes an Error or anything else", () => {
    expect(plainErrText(new Error("Forbidden: admin only"))).toBe("Only an admin can do this.");
    expect(plainErrText("Failed to fetch")).toBe("No signal. Check your connection and try again.");
    expect(fieldErrText).toBe(plainErrText);
    expect(invoiceErrText).toBe(plainErrText);
  });
  it("the service screens' own errText copies read through it", () => {
    for (const f of [
      "src/components/service-page.tsx",
      "src/components/service/board-page.tsx",
      "src/components/service/inspection-checklist-settings.tsx",
      "src/components/service/invoice-photos.tsx",
      "src/components/service/material-pricing-settings.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("const errText = plainErrText;");
      expect(src, f).not.toContain("(e instanceof Error ? e.message : String(e))");
    }
  });
  it("the internal strings are gone", () => {
    const materialsFns = read("src/lib/service-materials.functions.ts");
    expect(materialsFns).toContain('"Material pricing is not set up yet. Ask an admin."');
    expect(materialsFns).not.toContain("apply 20261006130000_service_materials.sql");
    expect(materialsFns).toContain('"Only a manager changes material pricing"');
    expect(materialsFns).not.toContain("Material pricing is a manager's");
    const field = read("src/lib/service-field.functions.ts");
    expect(field).not.toContain("loose ticket photo");
    expect(field).toContain(
      "Only a ticket photo that is not on a repair (and not the signature) goes on a checklist item",
    );
    expect(materials).not.toContain("what is left where is unknown — the server checks");
    expect(materials).toContain("the shelf count could not be read, so it is checked when you add");
    const invoices = read("src/lib/invoices.server.ts");
    expect(invoices).not.toContain("Admin › Settings › Service rates");
    expect(invoices).toContain("a manager sets them under Setup › Service rates");
    for (const f of ["src/lib/invoices.server.ts", "src/lib/notify.server.ts"]) {
      expect(read(f), f).not.toContain('"RESEND_API_KEY is not set (Lovable Cloud › secrets)"');
      expect(read(f), f).toContain("Email is not set up yet: the RESEND_API_KEY secret is missing");
    }
  });
});

describe("50. the audit log says what matters", () => {
  it("the ticket's field bookkeeping joins v_skip", () => {
    const skip = audit.slice(
      audit.indexOf("v_skip constant text[]"),
      audit.indexOf("v_parent text;"),
    );
    for (const col of [
      "contacted_at",
      "field_status",
      "en_route_at",
      "on_site_at",
      "helper_count",
      "escalated_at",
      "assigned_at",
      "crew_confirmed_at",
      "nothing_used_at",
      "notes_skipped_at",
      "site_city",
      "site_state",
    ])
      expect(skip, col).toContain(`'${col}'`);
    // Everything 20261026120000 skipped is still skipped.
    const prev = read("supabase/migrations/20261026120000_bid_content_saved_at.sql");
    const prevSkip = prev.slice(
      prev.indexOf("v_skip constant text[]"),
      prev.indexOf("v_parent text;"),
    );
    for (const col of prevSkip.match(/'[a-z_]+'/g) ?? []) expect(skip, col).toContain(col);
    // And the stage, the technician, the description … are not.
    for (const col of [
      "'stage'",
      "'technician_id'",
      "'description'",
      "'scheduled_date'",
      "'inspection'",
    ])
      expect(skip).not.toContain(col);
  });
  it("the inspection is one sentence, in the summary and in changes", () => {
    expect(audit).toContain("create or replace function public.audit_inspection(p_value jsonb)");
    expect(audit).toContain("'checklist saved: '");
    expect(audit).toContain("where i ->> 'status' = 'issue'");
    expect(audit).toContain("' items flagged'");
    expect(audit).toContain("', grade ' || (p_value ->> 'grade')");
    expect(audit).toContain("', repairs recommended'");
    expect(audit).toContain(
      "if v_col = 'inspection' then\n        v_from := to_jsonb(public.audit_inspection(v_from));\n        v_to := to_jsonb(public.audit_inspection(v_to));",
    );
    expect(audit).toContain(
      "when v_col = 'inspection'\n              then 'inspection ' || coalesce(v_to #>> '{}', 'checklist cleared')",
    );
    expect(audit).toContain(
      "revoke all on function public.audit_inspection(jsonb) from public, anon, authenticated;",
    );
  });
  it("a signature reads 'signed'; an invoice link reads its number", () => {
    expect(audit).toContain("when p_col = 'signature_path' then 'signature'");
    expect(audit).toContain("if p_col = 'signature_path' then\n    return 'signed';");
    expect(audit).toContain("'bid_id', 'opportunity_id', 'invoice_id')");
    expect(audit).toContain("elsif p_col = 'invoice_id' then");
    expect(audit).toContain(
      "select rtrim('Invoice ' || coalesce(i.display_number, abs(i.number)::text, '')) into v_out",
    );
  });
  it("a ticket contact stamps the ticket and writes no second copy", () => {
    const apply = audit.slice(
      audit.indexOf("create or replace function public.crm_contact_log_apply()"),
    );
    expect(apply).toContain("update public.service_jobs set contacted_at = new.at");
    expect(apply).not.toContain("insert into public.service_job_events");
    // The ticket page reads the contact log itself; the copies that exist are still skipped.
    const timeline = read("src/lib/ticket-timeline.ts");
    expect(timeline).toContain(
      'if (e.kind === "contact" && copied.has(copyKey(e.at, meta.method, e.note))) continue;',
    );
    expect(read("src/components/service/ticket-activity.tsx")).toContain(
      "mergeTimeline(contacts.data, events.data)",
    );
  });
  it("the rest of audit_row is 20261026120000's body", () => {
    const prev = read("supabase/migrations/20261026120000_bid_content_saved_at.sql");
    const body = (s: string) =>
      s
        .slice(s.indexOf("  v_parent text;"), s.indexOf("\n$$;", s.indexOf("  v_parent text;")))
        .replace(
          /\n\s*-- The inspection checklist \(Nov 3\)[^\n]*\n\s*-- answers[^\n]*\n\s*if v_col = 'inspection' then\n[\s\S]*?end if;\n/,
          "\n",
        )
        .replace(
          /\s*when v_col = 'inspection'\n\s*then 'inspection ' \|\| coalesce\(v_to #>> '\{\}', 'checklist cleared'\)\n/,
          "\n",
        );
    expect(body(audit)).toBe(body(prev));
  });
});

describe("53. the dead code and the stale header", () => {
  it("unused imports and an unused return are gone", () => {
    const closeout = read("src/components/service/closeout.tsx");
    expect(closeout).not.toMatch(/^\s+Minus,$/m);
    expect(read("src/components/service/ticket-field-sections.tsx")).not.toContain(
      'import { toast } from "sonner";',
    );
    expect(read("src/components/service/purchase-orders-section.tsx")).toContain(
      "  return { refresh };",
    );
  });
  it("the close-out's header tells today's story: the picture queue, the four inspection steps", () => {
    const closeout = read("src/components/service/closeout.tsx");
    expect(closeout).not.toContain("Photos are NOT queued offline");
    expect(closeout).toContain(
      "Photos go through the picture queue (picture-queue.ts; owner, Oct 28)",
    );
    expect(closeout).not.toContain("closes out through its own six");
    expect(closeout).toContain("closes out through its own four\n * steps");
    expect(closeout).toContain("No crew question and no materials\n * step since Oct 28");
  });
});
