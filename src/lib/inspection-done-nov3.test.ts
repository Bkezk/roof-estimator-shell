/**
 * Owner, Nov 3, on the Done inspection's banner and the inspection's stages:
 *  1. "the card says 'the checklist is still saving' … even though the checklist has very little
 *     info" — the banner kept a draft of its own, started before the close-out's save landed,
 *     so it never learned the record existed. It reads the saved record on the shared key now,
 *     and never shows the section's autosave guard.
 *  2. "no action needed is blanked out … can its button also be black" — enabled on the banner
 *     (the same `dirty` was the cause), and the primary button.
 *  3. "inspections just need the steps open, scheduled, and done" — an inspection ends at Done:
 *     its strip and stage picker stop there, no Needs authorization card, the Done notice asks
 *     the office to pick what happens next (not "mark it Authorized"), no Authorize timer
 *     (migration 20261103100000 closes the open ones), not on Work Overview's or the Owner
 *     page's Needs authorization.
 * Fails on the old code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { businessNumbers } from "@/lib/owner-business";
import { SERVICE_STAGES } from "@/lib/service.functions";
import { ticketStageStrip } from "@/lib/stage-dates";
import { endsAtDone, INSPECTION_STAGES, stageChoices, stagesForType } from "@/lib/ticket-stage";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const admin = { role: "admin", access: [], technician: false };
const tech = { role: "user", access: ["service"], technician: true };

describe("1 + 2. the banner", () => {
  const section = read("src/components/service/inspection-section.tsx");
  const banner = section.slice(
    section.indexOf("export function InspectionNextStep("),
    section.indexOf("export function FromInspectionNote("),
  );
  it("reads the saved record on the shared key, no draft of its own, and never says 'still saving'", () => {
    expect(banner).toContain("queryKey: inspectionKey(job.id),");
    expect(banner).toContain("queryFn: () => getFn({ data: { id: job.id } }),");
    expect(banner).not.toContain("useInspectionDraft(");
    expect(banner).toContain("<OfficeActions job={job} data={q.data} dirty={false} />");
    expect(banner).toContain("if (!applies || !q.data || q.data.outcome) return null;");
  });
  it("No action needed is the primary (black) button", () => {
    const btn = section.slice(
      section.indexOf('data-action="no-action-needed"') - 400,
      section.indexOf('data-action="no-action-needed"'),
    );
    expect(btn).not.toContain('variant="outline"');
    expect(btn).toContain('className="h-10"');
  });
});

describe("3. an inspection ends at Done", () => {
  it("the stages: Open, Scheduled, Done for an inspection; every stage for the rest", () => {
    expect([...INSPECTION_STAGES]).toEqual(["open", "scheduled", "done"]);
    expect(endsAtDone("inspection")).toBe(true);
    expect(endsAtDone("repair")).toBe(false);
    expect(endsAtDone(null)).toBe(false);
    expect([...stagesForType("inspection")]).toEqual(["open", "scheduled", "done"]);
    expect([...stagesForType("repair")]).toEqual([...SERVICE_STAGES]);
  });
  it("the picker: an admin on a Done inspection sees Open / Scheduled / Done; on a repair every stage; a technician as before", () => {
    expect(stageChoices(admin, "done", "inspection")).toEqual(["open", "scheduled", "done"]);
    expect(stageChoices(admin, "done", "repair")).toEqual([...SERVICE_STAGES]);
    expect(stageChoices(admin, "done")).toEqual([...SERVICE_STAGES]);
    expect(stageChoices(tech, "scheduled", "inspection")).toEqual(["open", "scheduled"]);
  });
  it("the strip: three cells for an inspection, Done current; six for a repair", () => {
    const events = [
      { kind: "stage", stage: "scheduled", at: "2026-11-02T14:00:00Z", by_name: "Braden Keck" },
      { kind: "stage", stage: "done", at: "2026-11-03T14:16:00Z", by_name: "Braden Keck" },
    ];
    const cells = ticketStageStrip("done", events as never, stagesForType("inspection"));
    expect(cells.map((c) => `${c.label}:${c.current ? "now" : c.at ? "dated" : "-"}`)).toEqual([
      "Open:dated",
      "Scheduled:dated",
      "Done:now",
    ]);
    expect(ticketStageStrip("done", events as never)).toHaveLength(6);
  });
  it("the ticket page: the strip and the picker take the type; no Needs authorization card on an inspection", () => {
    const page = read("src/components/service-page.tsx");
    expect(page).toContain("const inspectionTicket = endsAtDone(job?.service_type);");
    expect(page).toContain("stageChoices(profile, jobStage, job?.service_type)");
    expect(page).toContain(
      "ticketStageStrip(asStage(job.stage), eventsQ.data ?? [], stagesForType(job.service_type))",
    );
    expect(page).toContain(
      '{jobStage === "done" && !inspectionTicket && <InvoiceBlock job={job} />}',
    );
    expect(page).toContain(
      '{jobStage !== "done" && !inspectionTicket && <InvoiceBlock job={job} />}',
    );
  });
  it("the server: the Done notice asks for the next step, no Authorize timer for an inspection; the timer closes", () => {
    const src = read("src/lib/ticket-events.server.ts");
    expect(src).toContain('const reviewable = row.service_type !== "inspection";');
    expect(src).toContain(
      'const becameDone = row.stage === "done" && prevStage !== "done" && live;',
    );
    expect(src).toContain(
      "marked it done. Look it over and pick what happens next on the ticket: create a repair ticket, or no action needed.",
    );
    expect(src).toContain(
      'assigneeId: row.stage === "done" && live && reviewable ? assignee : null,',
    );
    expect(src).toContain('closing: row.stage !== "done" || !!row.deleted_at || !reviewable,');
    expect(src).toContain('"an inspection ends at Done"');
  });
  it("Needs authorization leaves inspections out: Work Overview's query and the Owner page's count", () => {
    expect(read("src/lib/my-work.functions.ts")).toContain('.neq("service_type", "inspection")');
    const base = {
      today: "2026-11-03",
      now: new Date("2026-11-03T15:00:00Z"),
      tickets: [
        {
          id: "a",
          stage: "done",
          stage_changed_at: "2026-11-01T00:00:00Z",
          scheduled_date: null,
          service_type: "repair",
        },
        {
          id: "b",
          stage: "done",
          stage_changed_at: "2026-11-01T00:00:00Z",
          scheduled_date: null,
          service_type: "inspection",
        },
      ],
      invoices: [],
      opps: [],
      bids: [],
      untouched: null,
    };
    expect(businessNumbers(base as never).toAuthorize.count).toBe(1);
    expect(read("src/lib/owner-business.functions.ts")).toContain(
      '"id, stage, stage_changed_at, scheduled_date, invoice_id, technician_id, service_type"',
    );
  });
  it("the migration closes the Authorize timers inspections already have", () => {
    const sql = flat("supabase/migrations/20261103100000_inspection_ends_at_done.sql");
    expect(sql).toContain(
      "update public.crm_followups f set status = 'closed', closed_at = now(), closed_reason = 'an inspection ends at Done', closed_by_sync = true from public.service_jobs j where j.id = f.item_id and f.kind = 'invoice' and f.status = 'open' and j.service_type = 'inspection';",
    );
  });
});
