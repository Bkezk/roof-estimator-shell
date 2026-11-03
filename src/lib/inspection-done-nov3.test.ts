/**
 * Owner, Nov 3, on the Done inspection's banner and the inspection's stages:
 *  1. "the card says 'the checklist is still saving' … even though the checklist has very little
 *     info" — the banner kept a draft of its own, started before the close-out's save landed,
 *     so it never learned the record existed. It reads the saved record on the shared key now,
 *     and never shows the section's autosave guard.
 *  2. "no action needed is blanked out … can its button also be black" — enabled on the banner
 *     (the same `dirty` was the cause), and the primary button.
 *  3. "inspections just need the steps open, scheduled, and done", then "we may need the
 *     authorized step just so the owner can see it was completed and signed off on it … when
 *     authorized that's when it's considered done" — an inspection ends at Authorized: its strip
 *     and stage picker run Open, Scheduled, Done, Authorized; the Needs authorization card asks
 *     for the sign-off and says nothing is invoiced; no invoice card after it; the Done notice
 *     says the sign-off completes it; no "ready to invoice" notice; the Authorize timer runs as
 *     on any ticket (migration 20261103150000 reopens the ones 20261103100000 closed); Work
 *     Overview and the Owner page count it under Needs authorization.
 * Fails on the old code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { businessNumbers } from "@/lib/owner-business";
import { SERVICE_STAGES } from "@/lib/service.functions";
import { ticketStageStrip } from "@/lib/stage-dates";
import {
  endsAtAuthorized,
  INSPECTION_STAGES,
  stageChoices,
  stagesForType,
} from "@/lib/ticket-stage";

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

describe("3. an inspection ends at Authorized", () => {
  it("the stages: Open, Scheduled, Done, Authorized for an inspection; every stage for the rest", () => {
    expect([...INSPECTION_STAGES]).toEqual(["open", "scheduled", "done", "authorized"]);
    expect(endsAtAuthorized("inspection")).toBe(true);
    expect(endsAtAuthorized("repair")).toBe(false);
    expect(endsAtAuthorized(null)).toBe(false);
    expect([...stagesForType("inspection")]).toEqual(["open", "scheduled", "done", "authorized"]);
    expect([...stagesForType("repair")]).toEqual([...SERVICE_STAGES]);
  });
  it("the picker: an admin on a Done inspection sees up to Authorized; on a repair every stage; a technician as before", () => {
    expect(stageChoices(admin, "done", "inspection")).toEqual([
      "open",
      "scheduled",
      "done",
      "authorized",
    ]);
    expect(stageChoices(admin, "done", "repair")).toEqual([...SERVICE_STAGES]);
    expect(stageChoices(admin, "done")).toEqual([...SERVICE_STAGES]);
    expect(stageChoices(tech, "scheduled", "inspection")).toEqual(["open", "scheduled"]);
  });
  it("the strip: four cells for an inspection, Done current, Authorized ahead; six for a repair", () => {
    const events = [
      { kind: "stage", stage: "scheduled", at: "2026-11-02T14:00:00Z", by_name: "Braden Keck" },
      { kind: "stage", stage: "done", at: "2026-11-03T14:16:00Z", by_name: "Braden Keck" },
    ];
    const cells = ticketStageStrip("done", events as never, stagesForType("inspection"));
    expect(cells.map((c) => `${c.label}:${c.current ? "now" : c.at ? "dated" : "-"}`)).toEqual([
      "Open:dated",
      "Scheduled:dated",
      "Done:now",
      "Authorized:-",
    ]);
    expect(ticketStageStrip("done", events as never)).toHaveLength(6);
  });
  it("the ticket page: the strip and the picker take the type; the Needs authorization card stays", () => {
    const page = read("src/components/service-page.tsx");
    expect(page).toContain("stageChoices(profile, jobStage, job?.service_type)");
    expect(page).toContain(
      "ticketStageStrip(asStage(job.stage), eventsQ.data ?? [], stagesForType(job.service_type))",
    );
    expect(page).toContain('{jobStage === "done" && <InvoiceBlock job={job} />}');
    expect(page).not.toContain("inspectionTicket");
  });
  it("the card: asks for the sign-off and says nothing is invoiced; no invoice card after it", () => {
    const block = read("src/components/service/invoice-block.tsx");
    expect(block).toContain("const signOff = endsAtAuthorized(job.service_type);");
    expect(block).toContain(
      'if (job.stage === "done" && !job.invoice_id) return <AuthorizeCard job={job} signOff={signOff} />;',
    );
    expect(block).toContain("if (signOff) return null;");
    expect(block).toContain(
      '"The inspection is done. Once it is reviewed and authorized, it is complete — nothing is invoiced."',
    );
    expect(block).toContain("`Inspection #${job.number} authorized — complete`");
  });
  it("the server: the Done notice says the sign-off completes it; no 'ready to invoice' notice; the timer runs", () => {
    const src = read("src/lib/ticket-events.server.ts");
    expect(src).toContain('const inspection = row.service_type === "inspection";');
    expect(src).toContain(
      "marked it done. Review it and mark it Authorized; that completes the inspection.",
    );
    expect(src).toContain("if (becameAuthorized && !inspection) {");
    expect(src).toContain('assigneeId: row.stage === "done" && live ? assignee : null,');
    expect(src).toContain('closing: row.stage !== "done" || !!row.deleted_at,');
    expect(src).not.toContain("an inspection ends at Done");
  });
  it("Needs authorization counts inspections: Work Overview's query and the Owner page's count", () => {
    expect(read("src/lib/my-work.functions.ts")).not.toContain('.neq("service_type"');
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
    expect(businessNumbers(base as never).toAuthorize.count).toBe(2);
    expect(read("src/lib/owner-business.ts")).not.toContain('service_type !== "inspection"');
  });
  it("the migration reopens the Authorize timers the Done-only rule closed, through the sync's flag", () => {
    const sql = flat("supabase/migrations/20261103150000_inspection_ends_at_authorized.sql");
    expect(sql).toContain("select set_config('jbk.followup_sync', 'on', true);");
    expect(sql).toContain(
      "update public.crm_followups f set status = 'open', closed_at = null, closed_reason = null, closed_by_sync = false from public.service_jobs j where j.id = f.item_id and f.kind = 'invoice' and f.status = 'closed' and f.closed_reason = 'an inspection ends at Done' and j.service_type = 'inspection' and j.stage = 'done' and j.deleted_at is null",
    );
  });
});
