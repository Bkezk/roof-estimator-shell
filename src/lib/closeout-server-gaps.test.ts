/**
 * The close-out's completeness is the server's rule too (owner, Oct 12, item 7). The screen
 * computed the gaps in the browser with a "Complete anyway" button for everyone, and setFieldStatus
 * "done" checked nothing — a technician could complete a ticket with no repair, no photo, no time
 * and no signature. Now the same pure rules (closeout-check.ts closeoutGaps) run on the server: a
 * technician's Complete is refused with the gaps in the message; a manager completes anyway. The
 * screen shows "Complete anyway" to managers only; a technician sees the list with Complete
 * disabled and what to do. No "the office" in any of it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));

import {
  CLOSEOUT_ADD_MISSING,
  CLOSEOUT_INCOMPLETE,
  closeoutGaps,
  closeoutRefusal,
  completeGaps,
} from "@/lib/closeout-check";
import { setFieldStatus } from "@/lib/service-field.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const JOB = "11111111-1111-4111-8111-111111111111";
const TECH = "22222222-2222-4222-8222-222222222222";
const MANAGER = "33333333-3333-4333-8333-333333333333";

const profiles: Row[] = [
  {
    id: TECH,
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Ted Tech",
    email: "ted@example.test",
  },
  {
    id: MANAGER,
    role: "manager",
    access: [],
    technician: false,
    full_name: "Mo Manager",
    email: "mo@example.test",
  },
];
const job = (over: Row = {}): Row => ({
  id: JOB,
  number: 6010,
  customer_name: "Acme",
  service_type: "leak",
  technician_id: TECH,
  stage: "scheduled",
  field_status: null,
  en_route_at: null,
  on_site_at: null,
  completed_at: null,
  signature_path: null,
  helper_count: 0,
  scheduled_date: "2026-10-12",
  ...over,
});
const whole = () => ({
  service_jobs: [job({ signature_path: `${JOB}/signature.png` })],
  service_job_repairs: [{ id: "r1", service_job_id: JOB, name: "Seam" }],
  service_job_photos: [
    { id: "p1", service_job_id: JOB, repair_id: "r1", role: "before" },
    { id: "p2", service_job_id: JOB, repair_id: "r1", role: "after" },
  ],
  service_time_entries: [{ id: 1, service_job_id: JOB, kind: "labor", hours: 1.5 }],
});
const bare = () => ({
  service_jobs: [job()],
  service_job_repairs: [],
  service_job_photos: [],
  service_time_entries: [],
});
const complete = (tables: Record<string, Row[]>, userId: string) =>
  (setFieldStatus as unknown as (a: { data: Row; context: unknown }) => Promise<{ row: Row }>)({
    data: { id: JOB, to: "done" },
    context: { supabase: fakeSupabase({ profiles, service_job_events: [], ...tables }).db, userId },
  }).then((r) => r.row);

describe("the shared rule", () => {
  it("closeoutGaps is completeGaps with the rows in hand", () => {
    const rows = {
      service_type: "leak",
      signature_path: null,
      on_site_at: null,
      repairs: [{ id: "r1", name: "Seam" }],
      photos: [{ repair_id: "r1", role: "before" }],
      time: [],
    };
    const gaps = closeoutGaps(rows);
    expect(gaps).toEqual(["Seam has no After photo", "No time logged", "No customer signature"]);
    expect(gaps).toEqual(
      completeGaps({
        finished: false,
        service_type: rows.service_type,
        signature_path: null,
        on_site_at: null,
        repairs: { data: rows.repairs, error: null },
        photos: { data: rows.photos, error: null },
        time: { data: [], error: null },
      }).gaps,
    );
    expect(closeoutGaps({ ...rows, repairs: [], photos: [] })).toEqual([
      "No repairs recorded",
      "No time logged",
      "No customer signature",
    ]);
    // An On site stamp supplies the labor; an inspection needs no repair line.
    expect(
      closeoutGaps({
        ...rows,
        service_type: "inspection",
        repairs: [],
        photos: [],
        on_site_at: "2026-10-12T14:00:00Z",
        signature_path: "x.png",
      }),
    ).toEqual([]);
  });
  it("the refusal names the gaps and what to do, without 'the office'", () => {
    const msg = closeoutRefusal(["No repairs recorded", "No customer signature"]);
    expect(msg).toBe(
      "The close-out is not complete: No repairs recorded; No customer signature. Add what is missing, then press Complete again.",
    );
    expect(CLOSEOUT_INCOMPLETE).toBe("The close-out is not complete");
    expect(CLOSEOUT_ADD_MISSING).toBe("Add what is missing, then press Complete again.");
    for (const s of [msg, CLOSEOUT_ADD_MISSING])
      expect(s.toLowerCase()).not.toContain("the office");
  });
});

describe("setFieldStatus 'done' on the server", () => {
  it("refuses a technician while anything is missing, listing it; nothing is written", async () => {
    const tables = bare();
    await expect(complete(tables, TECH)).rejects.toThrow(
      "The close-out is not complete: No repairs recorded; No time logged; No customer signature. Add what is missing, then press Complete again.",
    );
    expect(tables["service_jobs"]![0]).toMatchObject({ stage: "scheduled", completed_at: null });
  });
  it("lets a technician through once the close-out is whole: the ticket goes Done", async () => {
    const tables = whole();
    const row = await complete(tables, TECH);
    expect(row["stage"]).toBe("done");
    expect(typeof row["completed_at"]).toBe("string");
  });
  it("a manager completes anyway (the gaps are theirs to judge)", async () => {
    const tables = bare();
    const row = await complete(tables, MANAGER);
    expect(row["stage"]).toBe("done");
  });
  it("a ticket already finished by the office is stamped, never judged (as before)", async () => {
    const tables = { ...bare(), service_jobs: [job({ stage: "invoiced" })] };
    const row = await complete(tables, TECH);
    expect(row["stage"]).toBe("invoiced");
    expect(typeof row["completed_at"]).toBe("string");
  });
  it("the server reads the same three tables the screen does and refuses with closeoutRefusal", () => {
    const fn = read("src/lib/service-field.functions.ts");
    expect(fn).toContain('import { closeoutGaps, closeoutRefusal } from "@/lib/closeout-check";');
    expect(fn).toContain("if (!finished && !managesTickets(p)) {");
    expect(fn).toContain(
      'sb.from("service_job_repairs").select("id, name").eq("service_job_id", job.id)',
    );
    expect(fn).toContain(
      'sb.from("service_job_photos").select("repair_id, role").eq("service_job_id", job.id)',
    );
    expect(fn).toContain(
      'sb.from("service_time_entries").select("hours").eq("service_job_id", job.id)',
    );
    expect(fn).toContain("if (gaps.length) throw new Error(closeoutRefusal(gaps));");
  });
});

describe("the screen", () => {
  const src = read("src/components/service/closeout.tsx");
  it("Complete anyway is a manager's; a technician sees Complete disabled with the reasons and what to do", () => {
    expect(src).toContain("const manager = managesTickets(profile);");
    expect(src).toMatch(
      /\{manager \? \(\s*<AlertDialogAction[\s\S]*?Complete anyway\s*<\/AlertDialogAction>\s*\) : \(/,
    );
    expect(src).toMatch(
      /<Button[^>]*\n\s*type="button"\n\s*className="h-12"\n\s*disabled\n\s*title=\{missing\.join\("; "\)\}\n\s*data-action="complete-blocked"/,
    );
    expect(src).toContain("{!manager && (");
    expect(src).toContain("{CLOSEOUT_ADD_MISSING}");
    expect(src).toContain('import { isOffice, managesTickets } from "@/lib/access";');
  });
});
