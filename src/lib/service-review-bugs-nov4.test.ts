/**
 * The Nov 3 service review's bug list, fixed Nov 4 (owner: "fix the rest" — everything but 6 and
 * 7, the Sage export items). Each test fails on the code before the fix.
 *
 *   1  the office's ticket save re-leads the crew
 *   2  unticking the last helper saves the lead alone
 *   3  a timeline row goes in only from someone on the ticket, of the kinds the app writes
 *   4  a phone draft typed against an older ticket is a choice, not a silent overwrite
 *   5  Mark paid and Void say what really happens to the ticket
 *   8  the server refuses to void a paid invoice
 *   9  photos follow the field edit lock (server and close-out)
 *  10  "Usual here" samples the newest 50 tickets
 *  11  the short-stock dialog says what really happens
 *  12  the pricing list saves in one transaction
 *  13  the PDF preview redraws when the invoice's pictures change
 *  14  the editor is not "dirty" forever after adding a line
 *  15  a failed read of the ticket's stage is an error, not a blind write
 *  16  the server refuses Invoiced / Closed on an inspection
 *  17  the long-press flag lets go; a time row takes a background re-read
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DRAFT_CONFLICT_CHECKLIST,
  DRAFT_CONFLICT_MS,
  DRAFT_CONFLICT_NOTES,
  draftConflict,
} from "@/lib/draft-conflict";
import { LONG_PRESS_MS, LONG_PRESS_RESET_MS } from "@/lib/photo-select";
import { INSPECTION_STAGE_MESSAGE } from "@/lib/ticket-stage";

const read = (p: string) => readFileSync(p, "utf8");
const service = read("src/lib/service.functions.ts");
const fieldFns = read("src/lib/service-field.functions.ts");
const closeout = read("src/components/service/closeout.tsx");
const inspDraft = read("src/components/service/inspection-draft.ts");
const editor = read("src/components/service/invoice-editor.tsx");
const shared = read("src/components/service/field-shared.tsx");
const migration = read("supabase/migrations/20261104120000_events_policy_materials_save.sql");

describe("1. the office's ticket save re-leads the crew", () => {
  it("every save goes through saveCrew; only a manager's carries the form's crew and rates", () => {
    expect(service).toContain("const saved = await saveCrew(sb, row, manager ? crew : undefined);");
    expect(service).not.toContain("const saved = manager ? await saveCrew(sb, row, crew) : row;");
    // Without a crew to write, saveCrew moves the lead row to the ticket's technician.
    expect(service).toContain(
      "if (!crew) {\n    await syncCrewLead(sb, row.id, row.technician_id);",
    );
  });
});

describe("2. unticking the last helper saves the lead alone", () => {
  it("the crew box pushes the list whatever its length", () => {
    const crew = read("src/components/service/crew-box.tsx");
    expect(crew).toContain("    setPicked(next);\n    // An empty list is the lead alone");
    expect(crew).toMatch(/setPicked\(next\);\n(\s*\/\/[^\n]*\n)+\s*autosave\.push\(next\);/);
    expect(crew).not.toContain("if (next.length) autosave.push(next);");
  });
});

describe("3. who may write a timeline row", () => {
  it("the insert policy: works_on_ticket and the app's kinds", () => {
    expect(migration).toContain(
      "drop policy if exists service_job_events_insert on public.service_job_events;",
    );
    expect(migration).toContain(
      "create policy service_job_events_insert on public.service_job_events",
    );
    expect(migration).toContain("for insert to authenticated");
    expect(migration).toContain("public.works_on_ticket(service_job_id)");
    expect(migration).toContain(
      "and kind in ('field', 'note', 'assign', 'photo', 'signature', 'edit')",
    );
    // The kinds are the app's own (service-field.functions.ts AppEventKind), in the same order.
    expect(fieldFns).toContain(
      'export type AppEventKind = "field" | "note" | "assign" | "photo" | "signature" | "edit";',
    );
  });
});

describe("4. a phone draft against a changed ticket", () => {
  it("draftConflict: only when the draft differs, carries a stamp, and the stamp is not the server's", () => {
    expect(draftConflict("2026-11-04T10:00:00Z", "2026-11-04T10:05:00Z", true)).toBe(true);
    expect(draftConflict("2026-11-04T10:00:00Z", "2026-11-04T10:00:00Z", true)).toBe(false);
    expect(draftConflict("2026-11-04T10:00:00Z", "2026-11-04T10:05:00Z", false)).toBe(false);
    expect(draftConflict(null, "2026-11-04T10:05:00Z", true)).toBe(false);
    expect(draftConflict("2026-11-04T10:00:00Z", null, true)).toBe(false);
    expect(DRAFT_CONFLICT_MS).toBe(20_000);
    expect(DRAFT_CONFLICT_NOTES).toContain("Use mine");
    expect(DRAFT_CONFLICT_CHECKLIST).toContain("Use mine");
  });
  it("the close-out's draft carries the ticket's updated_at; a conflict keeps the server's text and offers Use mine / Keep theirs", () => {
    expect(closeout).toContain(
      "function writeDraft(id: string, d: TextDraft, base: string | null) {",
    );
    expect(closeout).toContain("if (base) window.localStorage.setItem(baseKey(id), base);");
    expect(closeout).toContain("writeDraft(job.id, next, job.updated_at);");
    expect(closeout).toContain(
      "draftConflict(readDraftBase(job.id), job.updated_at, !sameDraft(stored, fromJob(job)))",
    );
    expect(closeout).toContain("stored && !conflict ? stored : fromJob(job)");
    expect(closeout).toContain("toast.warning(DRAFT_CONFLICT_NOTES, {");
    expect(closeout).toContain('action: { label: "Use mine", onClick: () => update(stored) },');
    expect(closeout).toContain(
      'cancel: { label: "Keep theirs", onClick: () => clearDraft(job.id) },',
    );
    // Keep theirs drops the stamp with the draft.
    expect(closeout).toContain("window.localStorage.removeItem(baseKey(id));");
  });
  it("the checklist's draft carries the record's saved_at; the same choice on a conflict", () => {
    expect(inspDraft).toContain(
      "function writeInspectionDraft(id: string, d: InspectionDraft, base: string | null) {",
    );
    expect(inspDraft).toContain("baseRef.current = ins.saved_at ?? null;");
    expect(inspDraft).toContain("baseRef.current = q.data.inspection?.saved_at ?? null;");
    expect(inspDraft).toContain("writeInspectionDraft(job.id, next, baseRef.current);");
    expect(inspDraft).toContain(
      "draftConflict(readInspectionDraftBase(job.id), baseRef.current, differs)",
    );
    expect(inspDraft).toContain("const first = stored && !conflict ? stored : server;");
    expect(inspDraft).toContain("toast.warning(DRAFT_CONFLICT_CHECKLIST, {");
    expect(inspDraft).toContain(
      'cancel: { label: "Keep theirs", onClick: () => clearInspectionDraft(job.id) },',
    );
  });
});

describe("5. Mark paid and Void say what happens", () => {
  it("Void: back to Authorized; Mark paid: the stage does not change", () => {
    expect(editor).toContain(
      "The ticket goes back to Authorized unless another of its invoices is still",
    );
    expect(editor).not.toContain("The ticket goes back to Done");
    expect(editor).toContain(
      "Records the payment here (Sage stays the ledger). The ticket&apos;s stage does not",
    );
    expect(editor).not.toContain("and closes the ticket. Total");
    // What the server does: void → authorized; paid → the stage is left alone.
    const fns = read("src/lib/invoices.functions.ts");
    expect(fns).toContain('p_stage: "authorized",');
  });
});

describe("8. the server refuses to void a paid invoice", () => {
  it("voidInvoice checks the status before anything else", () => {
    const fns = read("src/lib/invoices.functions.ts");
    const fn = fns.slice(
      fns.indexOf("export const voidInvoice"),
      fns.indexOf("export const voidInvoice") + 1600,
    );
    expect(fn).toContain(
      'if (inv.status === "paid")\n      throw new Error("A paid invoice cannot be voided — edit the payment first");',
    );
    expect(fn.indexOf('inv.status === "paid"')).toBeLessThan(
      fn.indexOf('if (inv.status === "draft")'),
    );
  });
});

describe("9. photos follow the field edit lock", () => {
  it("registerJobPhoto and deleteJobPhoto use editableJob (the Open / Scheduled / Done lock)", () => {
    const reg = fieldFns.slice(
      fieldFns.indexOf("export const registerJobPhoto"),
      fieldFns.indexOf("export const deleteJobPhoto"),
    );
    expect(reg).toContain("const { job } = await editableJob(context, data.service_job_id);");
    expect(reg).not.toContain("ownJob(context, data.service_job_id)");
    const del = fieldFns.slice(
      fieldFns.indexOf("export const deleteJobPhoto"),
      fieldFns.indexOf("export const savePhotoAnnotations"),
    );
    expect(del).toContain("await editableJob(context, data.service_job_id);");
    expect(del).not.toContain("ownJob(context, data.service_job_id)");
  });
  it("the close-out's loose pictures get the X only while the ticket may be edited", () => {
    expect(closeout).toContain(
      "fieldEditProblem(profile, job.stage, job.technician_id === profile?.id) === null;",
    );
    expect(closeout).toContain("<TicketExtras job={job} canEdit={extrasEditable} />");
    expect(closeout).not.toContain("<TicketExtras job={job} canEdit />");
  });
});

describe("10. the 'Usual here' sample is the newest 50 tickets", () => {
  it("ordered by created_at desc before the limit", () => {
    expect(fieldFns).toContain(
      '.neq("id", data.id)\n      // The newest 50 (Nov 4, bug 10 of the Nov 3 review: with no order the sample was arbitrary).\n      .order("created_at", { ascending: false })\n      .limit(50);',
    );
  });
});

describe("11. the short-stock dialog", () => {
  it("says inventory keeps a note for the next count — not that the count is corrected", () => {
    const m = read("src/components/service/materials-section.tsx");
    expect(m).toContain("inventory keeps a note that");
    expect(m).toContain("the count there needs fixing, so it is set right at the next count.");
    expect(m).not.toContain("the count there gets");
  });
});

describe("12. the pricing list saves in one transaction", () => {
  it("save_service_materials: a manager's; the markup, the updates and the inserts in one function", () => {
    expect(migration).toContain(
      "create or replace function public.save_service_materials(p_updates jsonb, p_inserts jsonb, p_markup numeric default null)",
    );
    expect(migration).toContain("if not (public.is_admin() or public.is_manager()) then");
    expect(migration).toContain(
      "update public.service_settings set material_markup = p_markup, updated_at = now() where id = 1;",
    );
    expect(migration).toContain(
      "raise exception 'That material is no longer on the list — reload' using errcode = 'P0002';",
    );
    expect(migration).toContain(
      "insert into public.service_materials (name, unit, cost, active, category, sort)",
    );
    expect(migration).toContain(
      "grant execute on function public.save_service_materials(jsonb, jsonb, numeric) to authenticated;",
    );
  });
  it("the server function validates, then makes one call", () => {
    const fns = read("src/lib/service-materials.functions.ts");
    expect(fns).toContain('.rpc("save_service_materials", {');
    expect(fns).toContain(
      "p_updates: updates,\n        p_inserts: inserts,\n        p_markup: data.markup ?? null,",
    );
    expect(fns).not.toContain('.from("service_materials")\n          .update({');
    expect(fns).not.toContain('sb.from("service_materials").insert({');
    expect(fns).not.toContain('.from("service_settings")\n        .update({ material_markup');
  });
});

describe("13. the PDF preview follows the invoice's pictures", () => {
  it("the pane's version carries the chosen pictures; the editor listens to the card's cache entry", () => {
    expect(editor).toContain(
      "<PreviewPane invoiceId={inv.id} version={`${inv.updated_at}|${photoPickVersion}`} />",
    );
    expect(editor).toContain("queryKey: invoicePhotosKey(inv.id),");
    expect(editor).toContain("enabled: false,");
    expect(editor).toContain('const photoPickVersion = (photoPick.data?.chosen ?? []).join(",");');
    expect(read("src/components/service/invoice-utils.ts")).toContain(
      "export const invoicePhotosKey = (invoiceId: string)",
    );
  });
});

describe("14. the editor's dirty key leaves the server's original rate out", () => {
  it("editKey drops `orig` with `key`", () => {
    expect(editor).toContain(
      "JSON.stringify([h, lines.map(({ key: _k, orig: _o, ...rest }) => rest)]);",
    );
  });
});

describe("15 + 16. setServiceStage reads first, and an inspection ends at Authorized", () => {
  it("a failed read throws; a missing ticket throws; the stage check sees the ticket's type", () => {
    const fn = service.slice(
      service.indexOf("export const setServiceStage"),
      service.indexOf("export const assignServiceJob"),
    );
    expect(fn).toContain("const { data: prev, error: prevErr } = await context.supabase");
    expect(fn).toContain('.select("stage, number, service_type")');
    expect(fn).toContain("if (prevErr) throw new Error(prevErr.message);");
    expect(fn).toContain('if (!prev) throw new Error("Ticket not found");');
    expect(fn).toContain(
      "if (!stagesForType(prev.service_type).includes(data.stage))\n      throw new Error(INSPECTION_STAGE_MESSAGE);",
    );
    expect(fn).not.toContain("prev?.stage");
    expect(INSPECTION_STAGE_MESSAGE).toBe(
      "An inspection ends at Authorized — it is not invoiced or closed",
    );
  });
});

describe("17. the two possibles", () => {
  it("the long-press flag lets go on its own, after the press", () => {
    expect(LONG_PRESS_RESET_MS).toBe(600);
    expect(LONG_PRESS_RESET_MS).toBeGreaterThan(0);
    expect(LONG_PRESS_MS).toBeGreaterThan(0);
    expect(shared).toContain(
      "longPressed.current = true;\n              // Let go on its own (Nov 4, bug 17)",
    );
    expect(shared).toContain(
      "window.setTimeout(() => {\n                longPressed.current = false;\n              }, LONG_PRESS_RESET_MS);",
    );
  });
  it("a time row takes a background re-read unless it is being edited", () => {
    expect(shared).toContain(
      "const [seen, setSeen] = useState(entry);\n  if (seen !== entry) {\n    setSeen(entry);\n    if (sameVals(vals, valsOf(seen))) setVals(valsOf(entry));\n  }",
    );
  });
});
