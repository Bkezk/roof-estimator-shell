/**
 * Special instructions and who sees them (owner, Nov 18: "can we have the special instructions
 * be at the top of the timeline when techs are looking at history at this property as well as
 * add a viewable to technicians check box next to special instructions for the office". Chosen:
 * this ticket's instructions above the timeline; the box starts ticked; unticked hides them from
 * technicians everywhere).
 *
 *  rules     lib/ticket-instructions.ts: where the text lives by the box, what a save writes.
 *  server    saveServiceJob and getServiceJob (the office's whole text; a technician's none),
 *            the Tech Board's pop-up, the history's box.
 *  database  20261118200000: the box, the office's own table, the technician's limits.
 *  screens   the tick box on the ticket, the box above the timeline.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import { getBoardPeek } from "@/lib/board-peek.functions";
import { FIELD_DETAILS_NOTE_PLAIN } from "@/lib/field-ticket-page";
import { ticketInstructions } from "@/lib/service-history.functions";
import { TODAY_JOB_SELECT } from "@/lib/service-field.functions";
import { getServiceJob, saveServiceJob } from "@/lib/service.functions";
import {
  choosesInstructionsVisible,
  INSTRUCTIONS_HISTORY_TITLE,
  INSTRUCTIONS_OFFICE_ONLY,
  INSTRUCTIONS_TECH_LABEL,
  instructionsPatch,
  instructionsWrite,
  mergedInstructions,
  withInstructions,
} from "@/lib/ticket-instructions";
import { fakeSupabase } from "@/test/fake-supabase";
import { readGeneratedTypes } from "@/test/generated-types";

type Row = Record<string, unknown>;
type Env = ReturnType<typeof fakeSupabase>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

const OFFICE = "11111111-1111-4111-8111-111111111111";
const MGR = "22222222-2222-4222-8222-222222222222";
const TECH = "33333333-3333-4333-8333-333333333333";
const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const office = { role: "user", access: ["service", "customers"], technician: false };
const tech = { role: "user", access: ["service"], technician: true };
const profiles = [
  { id: OFFICE, ...office, full_name: "Olive Office", email: "o@x" },
  {
    id: MGR,
    role: "manager",
    access: [],
    technician: false,
    full_name: "Mo Manager",
    email: "m@x",
  },
  { id: TECH, ...tech, full_name: "Ted Tech", email: "t@x" },
];
const GATE = "Gate code is with the manager. No ladders on the east wall.";
const job = (over: Row = {}): Row => ({
  id: JOB,
  number: 6090,
  customer_name: "Made Up Customer",
  description: "Leak at the curb",
  service_type: "repair",
  stage: "scheduled",
  technician_id: TECH,
  scheduled_date: "2026-11-20",
  field_status: null,
  helper_count: 0,
  account_id: null,
  site_id: null,
  contact_id: null,
  invoice_id: null,
  deleted_at: null,
  po_number: null,
  centerpoint_ticket: null,
  centerpoint_invoice: null,
  notes: GATE,
  notes_tech_visible: true,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-12T15:00:00Z",
  ...over,
});
const world = (j: Row, officeNotes: Row[] = []): Env =>
  fakeSupabase({
    profiles,
    service_jobs: [j],
    service_job_office_notes: officeNotes,
    service_job_events: [],
    crm_followups: [],
    crm_accounts: [],
    crm_contacts: [],
    crm_opportunities: [],
    crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
  });
const callAs = <T>(fn: unknown, env: Env, userId: string, data: Row): Promise<T> =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const ticket = (env: Env) => env.tables["service_jobs"]![0]!;
const kept = (env: Env) => env.tables["service_job_office_notes"]!;
/** The form's save, as the office page sends it. */
const save = (env: Env, who: string, over: Row = {}) =>
  callAs<Row>(saveServiceJob, env, who, {
    id: JOB,
    customer_name: "Made Up Customer",
    description: "Leak at the curb",
    service_type: "repair",
    scheduled_date: "2026-11-20",
    technician_id: TECH,
    notes: GATE,
    ...over,
  });

beforeEach(() => vi.clearAllMocks());

describe("the rules", () => {
  it("the box is the office's: a technician-only login is not shown it", () => {
    expect(choosesInstructionsVisible(office)).toBe(true);
    expect(choosesInstructionsVisible({ role: "admin", access: [], technician: true })).toBe(true);
    expect(choosesInstructionsVisible(tech)).toBe(false);
    expect(choosesInstructionsVisible(null)).toBe(false);
    expect(INSTRUCTIONS_TECH_LABEL).toBe("Viewable to technicians");
  });
  it("ticked: the text is the ticket's own; unticked: the office's alone", () => {
    const base = { fieldOnly: false, text: ` ${GATE} `, currentVisible: true };
    expect(instructionsWrite({ ...base, ticked: true })).toEqual({ kind: "shown", jobNotes: GATE });
    expect(instructionsWrite({ ...base, ticked: false })).toEqual({
      kind: "hidden",
      officeNotes: GATE,
    });
    // The box left out: as it is stored. A new ticket (nothing stored) is ticked.
    expect(instructionsWrite({ ...base, ticked: undefined })).toEqual({
      kind: "shown",
      jobNotes: GATE,
    });
    expect(instructionsWrite({ ...base, ticked: undefined, currentVisible: false })).toEqual({
      kind: "hidden",
      officeNotes: GATE,
    });
    expect(instructionsWrite({ ...base, ticked: undefined, currentVisible: null })).toEqual({
      kind: "shown",
      jobNotes: GATE,
    });
    // Nothing typed is nothing kept.
    expect(instructionsWrite({ ...base, text: "  ", ticked: false })).toEqual({
      kind: "hidden",
      officeNotes: null,
    });
  });
  it("a technician never changes the box, and leaves hidden instructions alone", () => {
    const t = { fieldOnly: true, text: "", ticked: true };
    // Hidden: the blank they send is not an edit (they were never shown the text).
    expect(instructionsWrite({ ...t, currentVisible: false })).toEqual({ kind: "leave" });
    // Shown: their edit of the box is saved as before; the box itself stays ticked.
    expect(
      instructionsWrite({ ...t, text: "Dog on site", ticked: false, currentVisible: true }),
    ).toEqual({ kind: "shown", jobNotes: "Dog on site" });
  });
  it("what the ticket's own row gets", () => {
    expect(instructionsPatch({ kind: "leave" })).toEqual({});
    expect(instructionsPatch({ kind: "shown", jobNotes: GATE })).toEqual({
      notes: GATE,
      notes_tech_visible: true,
    });
    expect(instructionsPatch({ kind: "hidden", officeNotes: GATE })).toEqual({
      notes: null,
      notes_tech_visible: false,
    });
  });
  it("the office reads both halves; nothing typed is ever dropped", () => {
    expect(mergedInstructions(null, GATE)).toBe(GATE);
    expect(mergedInstructions(GATE, null)).toBe(GATE);
    expect(mergedInstructions(" ", " ")).toBeNull();
    expect(mergedInstructions("Typed later", GATE)).toBe(`${GATE}\nTyped later`);
    expect(mergedInstructions(GATE, GATE)).toBe(GATE);
  });
});

describe("the office saves the ticket", () => {
  it("box ticked (as every ticket starts): the instructions are on the ticket, as before", async () => {
    const env = world(job({ notes: null }));
    const row = await save(env, OFFICE, { notes_tech_visible: true });
    expect(row["notes"]).toBe(GATE);
    expect(ticket(env)).toMatchObject({ notes: GATE, notes_tech_visible: true });
    expect(kept(env)).toEqual([]);
    // A ticket whose box was ticked all along has no office copy: its save asks for nothing more.
    expect(env.writes.map((w) => w.table)).not.toContain("service_job_office_notes");
  });
  it("box unticked: the text leaves the ticket's row for the office's own table", async () => {
    const env = world(job());
    const row = await save(env, OFFICE, { notes_tech_visible: false });
    expect(ticket(env)).toMatchObject({ notes: null, notes_tech_visible: false });
    expect(kept(env)).toHaveLength(1);
    expect(kept(env)[0]).toMatchObject({
      service_job_id: JOB,
      notes: GATE,
      updated_by: OFFICE,
      updated_by_name: "Olive Office",
    });
    // The office's page gets the whole text back, so its box does not go blank.
    expect(row).toMatchObject({ notes: GATE, notes_tech_visible: false });
    // Kept first, then taken off the ticket: a failure in between never loses the text.
    const order = env.writes.map((w) => `${w.op} ${w.table}`);
    expect(order.indexOf("insert service_job_office_notes")).toBeLessThan(
      order.indexOf("update service_jobs"),
    );
  });
  it("a later save with the box still unticked keeps it so, and edits the office's copy", async () => {
    const env = world(job({ notes: null, notes_tech_visible: false }), [
      { service_job_id: JOB, notes: GATE },
    ]);
    // A screen that does not send the box (an older copy of the page): left unticked.
    await save(env, MGR, { notes: "New gate code 9920" });
    expect(ticket(env)).toMatchObject({ notes: null, notes_tech_visible: false });
    expect(kept(env)).toHaveLength(1);
    expect(kept(env)[0]!["notes"]).toBe("New gate code 9920");
  });
  it("ticked again: the text goes back on the ticket and the office's copy is removed", async () => {
    const env = world(job({ notes: null, notes_tech_visible: false }), [
      { service_job_id: JOB, notes: GATE },
    ]);
    const row = await save(env, OFFICE, { notes_tech_visible: true });
    expect(ticket(env)).toMatchObject({ notes: GATE, notes_tech_visible: true });
    expect(kept(env)).toEqual([]);
    expect(row["notes"]).toBe(GATE);
    const order = env.writes.map((w) => `${w.op} ${w.table}`);
    expect(order.indexOf("update service_jobs")).toBeLessThan(
      order.indexOf("delete service_job_office_notes"),
    );
  });
  it("unticked with nothing typed keeps no office copy", async () => {
    const env = world(job({ notes: null, notes_tech_visible: false }), [
      { service_job_id: JOB, notes: GATE },
    ]);
    await save(env, OFFICE, { notes: "", notes_tech_visible: false });
    expect(kept(env)).toEqual([]);
    expect(ticket(env)).toMatchObject({ notes: null, notes_tech_visible: false });
  });
});

describe("a technician-only login", () => {
  it("their save of a ticket with hidden instructions changes neither the text nor the box", async () => {
    const env = world(job({ notes: null, notes_tech_visible: false }), [
      { service_job_id: JOB, notes: GATE },
    ]);
    // The field page sends the instructions box as it has it: blank. And tries the box.
    await save(env, TECH, { notes: "", notes_tech_visible: true, description: "Leak at the curb" });
    expect(ticket(env)).toMatchObject({ notes: null, notes_tech_visible: false });
    expect(kept(env)).toEqual([{ service_job_id: JOB, notes: GATE }]);
    const sent = env.writes.find((w) => w.table === "service_jobs")!;
    expect(sent.payload).not.toHaveProperty("notes");
    expect(sent.payload).not.toHaveProperty("notes_tech_visible");
    expect(env.writes.filter((w) => w.table === "service_job_office_notes")).toEqual([]);
  });
  it("while the box is ticked their edit of the instructions saves as before", async () => {
    const env = world(job());
    await save(env, TECH, { notes: `${GATE} Dog on site.` });
    expect(ticket(env)).toMatchObject({ notes: `${GATE} Dog on site.`, notes_tech_visible: true });
  });
  it("is never handed the office's copy: the read does not even ask for it", async () => {
    const hidden = { id: JOB, notes: null, notes_tech_visible: false };
    const refuses = {
      from: () => {
        throw new Error("the office's table was read for a technician");
      },
    } as unknown as Parameters<typeof withInstructions>[0];
    await expect(withInstructions(refuses, tech, hidden)).resolves.toBe(hidden);
    // A ticked ticket is not looked up for anyone: its text is on its own row.
    const shown = { id: JOB, notes: GATE, notes_tech_visible: true };
    await expect(withInstructions(refuses, office, shown)).resolves.toBe(shown);
  });
});

describe("what each reader is given", () => {
  const hiddenWorld = () =>
    world(job({ notes: null, notes_tech_visible: false }), [{ service_job_id: JOB, notes: GATE }]);

  it("the ticket page: the office reads the whole text; a failed read is an error, not a blank", async () => {
    const env = hiddenWorld();
    const row = await callAs<Row>(getServiceJob, env, OFFICE, { id: JOB });
    expect(row).toMatchObject({ notes: GATE, notes_tech_visible: false });
    const tRow = await callAs<Row>(getServiceJob, env, TECH, { id: JOB });
    expect(tRow["notes"]).toBeNull();
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "timeout" } }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof withInstructions>[0];
    await expect(
      withInstructions(broken, office, { id: JOB, notes: null, notes_tech_visible: false }),
    ).rejects.toThrow("The office-only instructions could not be read: timeout");
  });
  // Found in the browser, Nov 18: the ticket page opens on getTicketBundle, not getServiceJob.
  // Left out, the office's box came up blank over text a save would then have removed.
  it("every read and write that hands the ticket page its ticket puts the office's text back", () => {
    const bundle = read("src/lib/service-field.functions.ts");
    const fn = bundle.slice(
      bundle.indexOf("export const getTicketBundle"),
      bundle.indexOf("export const getTicketBundle") + 4000,
    );
    expect(fn).toContain("const job = await withInstructions(sb, p, jobRes.data);");
    const svc = read("src/lib/service.functions.ts");
    expect(svc).toContain("await withInstructions(context.supabase, p, row)");
    expect(svc).toContain("const row = await withInstructions(sb, p, written);");
    expect(svc).toContain("const row = await withInstructions(sb, p, made);");
    // Nothing else plants a whole ticket row in the page's cache.
    const page = read("src/components/service-page.tsx");
    expect(page.match(/qc\.setQueryData\(\["service-job", row\.id\], row\);/g)).toHaveLength(2);
    expect(page).toContain("const b = await bundleFn({ data: { id } });");
  });
  it("the Tech Board's pop-up", async () => {
    const env = hiddenWorld();
    expect(await callAs<Row>(getBoardPeek, env, OFFICE, { id: JOB })).toMatchObject({
      notes: GATE,
    });
    expect(await callAs<Row>(getBoardPeek, env, TECH, { id: JOB })).toMatchObject({ notes: null });
  });
  it("the box above the history's timeline: this ticket's instructions, for whoever may read them", async () => {
    // Ticked: the technician reads them first; nobody is told "office only".
    const shown = world(job());
    expect(await callAs(ticketInstructions, shown, TECH, { id: JOB })).toEqual({
      text: GATE,
      officeOnly: false,
    });
    expect(await callAs(ticketInstructions, shown, OFFICE, { id: JOB })).toEqual({
      text: GATE,
      officeOnly: false,
    });
    // Unticked: nothing for the technician; the office reads them and is told who does not.
    const env = hiddenWorld();
    expect(await callAs(ticketInstructions, env, TECH, { id: JOB })).toEqual({
      text: null,
      officeOnly: false,
    });
    expect(await callAs(ticketInstructions, env, OFFICE, { id: JOB })).toEqual({
      text: GATE,
      officeOnly: true,
    });
    // No instructions, or a ticket the reader may not read: no box.
    expect(await callAs(ticketInstructions, world(job({ notes: " " })), TECH, { id: JOB })).toEqual(
      { text: null, officeOnly: false },
    );
    expect(
      await callAs(ticketInstructions, env, TECH, { id: "99999999-9999-4999-8999-999999999999" }),
    ).toEqual({ text: null, officeOnly: false });
  });
});

describe("the database (20261118200000_special_instructions_office_only.sql)", () => {
  const sql = read("supabase/migrations/20261118200000_special_instructions_office_only.sql")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join(" ")
    .replace(/\s+/g, " ");
  it("every ticket starts ticked", () => {
    expect(sql).toContain(
      "alter table public.service_jobs add column if not exists notes_tech_visible boolean not null default true;",
    );
  });
  it("the office's table: read and written by the office for a ticket it can read, never by a technician-only login", () => {
    expect(sql).toContain("create table if not exists public.service_job_office_notes (");
    expect(sql).toContain(
      "service_job_id uuid primary key references public.service_jobs(id) on delete cascade",
    );
    expect(sql).toContain("alter table public.service_job_office_notes enable row level security;");
    expect(sql).toContain("revoke all on public.service_job_office_notes from anon;");
    const rule =
      "not (select public.is_technician()) and exists (select 1 from public.service_jobs j where j.id = service_job_id)";
    expect(sql).toContain(`for all to authenticated using ( ${rule} ) with check ( ${rule} );`);
    expect(sql.match(/create policy/g)).toHaveLength(1);
  });
  it("a technician cannot tick the box, nor write instructions under an unticked one", () => {
    expect(sql).toContain(
      "before update of notes, notes_tech_visible on public.service_jobs for each row execute function public.service_jobs_instructions_rule();",
    );
    expect(sql).toContain(
      "raise exception 'Only the office chooses whether technicians see the special instructions'",
    );
    expect(sql).toContain(
      "if not old.notes_tech_visible and new.notes is distinct from old.notes then new.notes := old.notes;",
    );
  });
  it("the types know the box and the table", () => {
    const types = readGeneratedTypes();
    expect(types).toContain("notes_tech_visible: boolean");
    expect(types).toContain("service_job_office_notes: {");
  });
});

// Owner, Nov 18: "think of a solution for when there is no history but still special
// instructions" (then: "go on 1"). The instructions are on the My tickets card and at the top of
// the close-out, so they do not depend on the property having a history to open.
describe("the instructions where a technician works, history or not", () => {
  const today = read("src/components/service/today-page.tsx");
  const closeout = read("src/components/service/closeout.tsx");
  const box = read("src/components/service/special-instructions.tsx");
  it("My tickets reads them with the day, and the card shows them", () => {
    const cols = TODAY_JOB_SELECT.split(", ");
    expect(cols).toContain("notes");
    expect(cols).toContain("notes_tech_visible");
    expect(today).toContain('<SpecialInstructionsBox where="card" text={j.notes} />');
    // Not inside the history link, which a first ticket at a property does not have.
    expect(today.indexOf('where="card"')).toBeGreaterThan(today.indexOf("<HistoryLink"));
  });
  it("the close-out opens with them; the office is told when technicians do not see them", () => {
    expect(closeout.replace(/\s+/g, " ")).toContain(
      '<SpecialInstructionsBox where="closeout" text={job.notes} officeOnly={job.notes_tech_visible === false} />',
    );
  });
  it("one box for all three places: nothing without text, the words as typed", () => {
    expect(box).toContain("if (!body) return null;");
    expect(box).toContain("whitespace-pre-line");
    expect(box).toContain("data-special-instructions={where}");
    expect(box).toContain("{INSTRUCTIONS_OFFICE_ONLY}");
    // A technician is never handed the office's own instructions, so the card needs no rule
    // of its own: the row My tickets reads has none of that text.
    expect(read("src/lib/ticket-instructions.ts")).toContain("service_jobs.notes is then empty");
  });
});

describe("the screens", () => {
  const page = read("src/components/service-page.tsx");
  const history = read("src/components/service/site-history.tsx");
  it("the ticket: a tick box beside Special instructions for the office, ticked on a new ticket", () => {
    expect(page).toContain("data-instructions-visible");
    expect(page).toContain("{INSTRUCTIONS_TECH_LABEL}");
    expect(page).toContain('onCheckedChange={(v) => set("notes_tech_visible", v === true)}');
    expect(page).toContain("notes_tech_visible: job.notes_tech_visible !== false,");
    expect(page).toMatch(/notes: "",\s*notes_tech_visible: true,/);
    // Only the office's save sends the box.
    expect(flat("src/components/service-page.tsx")).toContain(
      "...(officeChoosesInstructions ? { notes_tech_visible: draft.notes_tech_visible } : {}),",
    );
    // Unticked, the office is told who does not see them.
    expect(page).toContain("{INSTRUCTIONS_OFFICE_ONLY}");
    expect(INSTRUCTIONS_OFFICE_ONLY).toBe(
      "Office only. Technicians do not see these instructions.",
    );
  });
  it("a technician on a ticket with hidden instructions is shown no instructions box", () => {
    expect(flat("src/components/service-page.tsx")).toContain(
      "const instructionsHidden = !officeChoosesInstructions && !!job && job.notes_tech_visible === false;",
    );
    expect(page).toContain("const notesField = instructionsHidden ? null : (");
    expect(page).toContain("instructionsHidden ? FIELD_DETAILS_NOTE_PLAIN : FIELD_DETAILS_NOTE");
    expect(FIELD_DETAILS_NOTE_PLAIN).not.toContain("Special instructions");
  });
  it("History at this property: this ticket's instructions sit above the timeline, in the fold and the pop-up", () => {
    expect(INSTRUCTIONS_HISTORY_TITLE).toBe("Special instructions for this ticket");
    expect(history).toContain('where="history"');
    expect(history).toContain("title={INSTRUCTIONS_HISTORY_TITLE}");
    // One timeline serves the fold and the pop-up, and the box is its first thing.
    // (Later on Nov 18: in the pop-up, this ticket's ticked Activity entries come between the
    // box and the timeline; ticket-shared-notes.test.tsx.)
    const body = history.replace(/\s+/g, " ");
    const boxAt = body.indexOf("<InstructionsBox jobId={jobId} enabled={enabled} />");
    expect(boxAt).toBeGreaterThan(-1);
    expect(boxAt).toBeLessThan(body.indexOf("{timeline} </>"));
    expect(body.slice(boxAt, body.indexOf("{timeline} </>"))).not.toContain("<HistoryRow");
    expect(history.match(/<HistoryTimeline /g)).toHaveLength(2);
    // A save of the ticket refreshes the box.
    expect(page).toContain("qc.invalidateQueries({ queryKey: fieldKeys.instructions(row.id) })");
  });
});
