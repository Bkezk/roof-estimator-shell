/**
 * "Is there an opened date stamped on tickets or opportunities?" (owner, Oct 1). The pure helpers
 * (stage-dates.ts), the migration 20261001130000_opened_and_stage_dates.sql (the opportunity log,
 * read-only under the opportunity's rule, both triggers, the backfill, the who), the generated
 * types, the app no longer writing 'stage' rows, the strip component, and the ticket and
 * opportunity pages ("Opened … by …" under the title, the strip under the header).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  openedLine,
  openerName,
  oppStatusStrip,
  OUTCOME_LABEL,
  shortDate,
  stageDates,
  statusDates,
  ticketStageStrip,
} from "@/lib/stage-dates";

const read = (p: string) => readFileSync(p, "utf8");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const flat = (s: string) => s.replace(/\s+/g, " ");

const MIGRATION = "supabase/migrations/20261001130000_opened_and_stage_dates.sql";
const TZ = "America/New_York";
const NOW = new Date("2026-10-01T15:00:00Z");
const opts = { now: NOW, timeZone: TZ };

const CREATOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------------------------

describe("shortDate / openedLine: 'Opened Sep 29 by RoAnna Sims'", () => {
  it("this year: month and day only", () => {
    expect(shortDate("2026-09-29T14:00:00Z", opts)).toBe("Sep 29");
    expect(openedLine("2026-09-29T14:00:00Z", "RoAnna Sims", opts)).toBe(
      "Opened Sep 29 by RoAnna Sims",
    );
  });
  it("another year: with the year", () => {
    expect(shortDate("2025-09-29T14:00:00Z", opts)).toBe("Sep 29, 2025");
    expect(openedLine("2025-09-29T14:00:00Z", "RoAnna Sims", opts)).toBe(
      "Opened Sep 29, 2025 by RoAnna Sims",
    );
  });
  it("read on the office's calendar (late evening stays that day)", () => {
    // 01:30 UTC on Sep 30 is 9:30 PM on Sep 29 in Kentucky.
    expect(shortDate("2026-09-30T01:30:00Z", opts)).toBe("Sep 29");
  });
  it("no name: the date alone; no date: nothing", () => {
    expect(openedLine("2026-09-29T14:00:00Z", null, opts)).toBe("Opened Sep 29");
    expect(openedLine("2026-09-29T14:00:00Z", "  ", opts)).toBe("Opened Sep 29");
    expect(openedLine(null, "RoAnna Sims", opts)).toBe("");
    expect(openedLine("not a date", "RoAnna Sims", opts)).toBe("");
    expect(shortDate(undefined)).toBe("");
  });
});

describe("openerName: the roster first, else the creator's earliest log row", () => {
  const roster = [
    { id: CREATOR, name: "RoAnna Sims" },
    { id: OTHER, name: "Braden Keck" },
  ];
  it("the roster's name", () => {
    expect(openerName(CREATOR, roster)).toBe("RoAnna Sims");
  });
  it("not on the roster: the earliest row the creator wrote", () => {
    const log = [
      { by_user: CREATOR, by_name: "R. Sims (later)", at: "2026-09-30T10:00:00Z" },
      { by_user: OTHER, by_name: "Braden Keck", at: "2026-09-28T10:00:00Z" },
      { by_user: CREATOR, by_name: "RoAnna Sims", at: "2026-09-29T10:00:00Z" },
    ];
    expect(openerName(CREATOR, [], log)).toBe("RoAnna Sims");
    expect(openerName(CREATOR, undefined, log)).toBe("RoAnna Sims");
  });
  it("no creator, or nobody knows them: null", () => {
    expect(openerName(null, roster)).toBeNull();
    expect(openerName(CREATOR, [], [])).toBeNull();
  });
});

describe("stageDates: the LAST time each ticket stage was entered", () => {
  it("back and forth: the latest entry wins, whatever the order of the rows", () => {
    const events = [
      { kind: "stage", stage: "done", at: "2026-09-30T18:00:00Z" },
      { kind: "stage", stage: "open", at: "2026-09-25T12:00:00Z" },
      { kind: "stage", stage: "scheduled", at: "2026-09-26T12:00:00Z" },
      { kind: "stage", stage: "done", at: "2026-09-27T18:00:00Z" },
      { kind: "stage", stage: "scheduled", at: "2026-09-28T09:00:00Z" },
    ];
    expect(stageDates(events)).toEqual({
      open: "2026-09-25T12:00:00Z",
      scheduled: "2026-09-28T09:00:00Z",
      done: "2026-09-30T18:00:00Z",
    });
  });
  it("only 'stage' rows with a known stage count", () => {
    expect(
      stageDates([
        { kind: "note", stage: "done", at: "2026-09-30T18:00:00Z" },
        { kind: "field", stage: null, at: "2026-09-30T18:00:00Z" },
        { kind: "stage", stage: "bogus", at: "2026-09-30T18:00:00Z" },
        { kind: "stage", stage: null, at: "2026-09-30T18:00:00Z" },
      ]),
    ).toEqual({});
  });
});

describe("statusDates: the LAST time each opportunity status was entered", () => {
  it("the 'created' row's status and every 'status' row; 'assign' rows do not count", () => {
    const events = [
      { kind: "created", status: "open", at: "2026-09-20T12:00:00Z" },
      { kind: "assign", status: null, at: "2026-09-21T12:00:00Z" },
      { kind: "status", status: "contacted", at: "2026-09-22T12:00:00Z" },
      { kind: "status", status: "open", at: "2026-09-23T12:00:00Z" },
      { kind: "status", status: "contacted", at: "2026-09-24T12:00:00Z" },
      { kind: "status", status: "won", at: "2026-09-29T12:00:00Z" },
    ];
    expect(statusDates(events)).toEqual({
      open: "2026-09-23T12:00:00Z",
      contacted: "2026-09-24T12:00:00Z",
      won: "2026-09-29T12:00:00Z",
    });
  });
  it("a backfilled 'created' row (no status) dates nothing", () => {
    expect(statusDates([{ kind: "created", status: null, at: "2026-09-20T12:00:00Z" }])).toEqual(
      {},
    );
  });
});

describe("ticketStageStrip: every stage in board order, the current one marked, dated", () => {
  const events = [
    { kind: "stage", stage: "open", at: "2026-09-25T12:00:00Z" },
    { kind: "stage", stage: "scheduled", at: "2026-09-26T12:00:00Z" },
    { kind: "note", stage: null, at: "2026-09-26T13:00:00Z" },
  ];
  const cells = ticketStageStrip("scheduled", events);
  it("Open, Scheduled, Done, Invoiced, Closed (STAGE_LABELS, SERVICE_STAGES order)", () => {
    expect(cells.map((c) => c.label)).toEqual(["Open", "Scheduled", "Done", "Invoiced", "Closed"]);
    expect(cells.map((c) => c.key)).toEqual(["open", "scheduled", "done", "invoiced", "closed"]);
  });
  it("the current stage only is marked", () => {
    expect(cells.filter((c) => c.current).map((c) => c.key)).toEqual(["scheduled"]);
  });
  it("each reached stage carries its date; one never reached is blank", () => {
    expect(cells.map((c) => c.at)).toEqual([
      "2026-09-25T12:00:00Z",
      "2026-09-26T12:00:00Z",
      null,
      null,
      null,
    ]);
  });
});

describe("oppStatusStrip: Open, Contacted, Quoted, then one outcome slot", () => {
  it("still open: three statuses and an undated 'Won / Lost / No response'", () => {
    const cells = oppStatusStrip("contacted", [
      { kind: "created", status: "open", at: "2026-09-20T12:00:00Z" },
      { kind: "status", status: "contacted", at: "2026-09-22T12:00:00Z" },
    ]);
    expect(cells.map((c) => c.label)).toEqual(["Open", "Contacted", "Quoted", OUTCOME_LABEL]);
    expect(OUTCOME_LABEL).toBe("Won / Lost / No response");
    expect(cells.map((c) => c.at)).toEqual([
      "2026-09-20T12:00:00Z",
      "2026-09-22T12:00:00Z",
      null,
      null,
    ]);
    expect(cells.filter((c) => c.current).map((c) => c.key)).toEqual(["contacted"]);
  });
  it("closed: the slot names the outcome reached, dated and marked", () => {
    const cells = oppStatusStrip("lost", [
      { kind: "created", status: "open", at: "2026-09-20T12:00:00Z" },
      { kind: "status", status: "quoted", at: "2026-09-25T12:00:00Z" },
      { kind: "status", status: "lost", at: "2026-09-30T12:00:00Z" },
    ]);
    expect(cells[3]).toEqual({
      key: "outcome",
      label: "Lost",
      at: "2026-09-30T12:00:00Z",
      current: true,
    });
    expect(cells[2]!.at).toBe("2026-09-25T12:00:00Z");
  });
  it("reopened after an outcome: the slot keeps the last one, unmarked", () => {
    const cells = oppStatusStrip("quoted", [
      { kind: "status", status: "no_response", at: "2026-09-21T12:00:00Z" },
      { kind: "status", status: "won", at: "2026-09-24T12:00:00Z" },
      { kind: "status", status: "quoted", at: "2026-09-26T12:00:00Z" },
    ]);
    expect(cells[3]).toMatchObject({ label: "Won", at: "2026-09-24T12:00:00Z", current: false });
    expect(cells[2]).toMatchObject({ label: "Quoted", current: true });
  });
});

// ---------------------------------------------------------------------------------------------

describe("migration: the opportunity log", () => {
  const sql = flatSql(MIGRATION);
  it("the table, its columns, kinds and cascade (idempotent)", () => {
    expect(sql).toContain("create table if not exists public.crm_opportunity_events (");
    expect(sql).toContain("id bigserial primary key");
    expect(sql).toContain(
      "opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade",
    );
    expect(sql).toContain("kind text not null check (kind in ('created', 'status', 'assign'))");
    for (const col of ["status text", "assignee uuid", "by_user uuid", "by_name text"])
      expect(sql).toContain(col);
    expect(sql).toContain("at timestamptz not null default now()");
    expect(sql).toContain(
      "create index if not exists crm_opportunity_events_opp_idx on public.crm_opportunity_events (opportunity_id, at)",
    );
  });
  it("RLS: read = whoever reads the opportunity (crm_opportunities_read, exactly)", () => {
    expect(sql).toContain("alter table public.crm_opportunity_events enable row level security");
    const orig = flatSql("supabase/migrations/20260927100000_crm_followups.sql");
    const origRule =
      /create policy crm_opportunities_read on public\.crm_opportunities for select to authenticated using \((.*?)\);/.exec(
        orig,
      )?.[1];
    expect(origRule).toBe(
      "public.has_access('customers') or public.has_access('estimate') or assignee_id = auth.uid()",
    );
    expect(sql).toContain(
      "create policy crm_opportunity_events_read on public.crm_opportunity_events for select to authenticated",
    );
    expect(sql).toContain("where o.id = crm_opportunity_events.opportunity_id");
    expect(sql).toContain(`and (${origRule!.replace("assignee_id", "o.assignee_id")})`);
  });
  it("read-only for clients: no insert / update / delete / all policy; writes revoked", () => {
    expect(sql).not.toMatch(
      /create policy \w+ on public\.crm_opportunity_events for (insert|update|delete|all)/,
    );
    expect(sql).toContain(
      "revoke insert, update, delete, truncate on public.crm_opportunity_events from anon, authenticated",
    );
  });
  it("crm_opportunities_log: SECURITY DEFINER; created / status / assign rows", () => {
    expect(sql).toContain(
      "create or replace function public.crm_opportunities_log() returns trigger language plpgsql security definer set search_path = public",
    );
    expect(sql).toContain(
      "values (new.id, 'created', new.status, new.assignee_id, v_uid, v_name, coalesce(new.created_at, now()))",
    );
    expect(sql).toContain(
      "if new.status is distinct from old.status then insert into public.crm_opportunity_events (opportunity_id, kind, status, by_user, by_name) values (new.id, 'status', new.status, v_uid, v_name)",
    );
    expect(sql).toContain(
      "if new.assignee_id is distinct from old.assignee_id then insert into public.crm_opportunity_events (opportunity_id, kind, assignee, by_user, by_name) values (new.id, 'assign', new.assignee_id, v_uid, v_name)",
    );
    expect(sql).toContain("v_uid uuid := auth.uid()");
    expect(sql).toContain(
      "drop trigger if exists crm_opportunities_log on public.crm_opportunities",
    );
    expect(sql).toContain(
      "create trigger crm_opportunities_log after insert or update of status, assignee_id on public.crm_opportunities for each row execute function public.crm_opportunities_log()",
    );
  });
  it("backfill: one 'created' row per opportunity at created_at by created_by, once", () => {
    expect(sql).toContain(
      "select o.id, 'created', null, null, o.created_by, public.event_actor_name(o.created_by), o.created_at from public.crm_opportunities o where not exists ( select 1 from public.crm_opportunity_events e where e.opportunity_id = o.id and e.kind = 'created' )",
    );
    // After the trigger, so a new opportunity is never left without its row.
    expect(sql.indexOf("create trigger crm_opportunities_log")).toBeLessThan(
      sql.indexOf("select o.id, 'created'"),
    );
  });
});

describe("migration: who — the exact resolution of audit_row()", () => {
  const sql = flatSql(MIGRATION);
  const WHO = "coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'Unknown user')";
  it("audit_row resolves the name this way", () => {
    expect(flatSql("supabase/migrations/20261001110000_vendors.sql")).toContain(WHO);
  });
  it("event_actor_name: the same, 'system' without a user, 'Unknown user' without a profile", () => {
    expect(sql).toContain(
      "create or replace function public.event_actor_name(p_uid uuid) returns text language plpgsql stable security definer set search_path = public",
    );
    expect(sql).toContain("if p_uid is null then return 'system'; end if;");
    expect(sql).toContain(`select ${WHO} into v_name from public.profiles p where p.id = p_uid;`);
    expect(sql).toContain("if not found then v_name := 'Unknown user'; end if;");
    expect(sql).toContain(
      "revoke all on function public.event_actor_name(uuid) from public, anon, authenticated",
    );
  });
  it("both triggers name the signed-in user through it", () => {
    expect(sql).toContain("v_name text := public.event_actor_name(auth.uid())");
    expect(sql).toContain("auth.uid(), public.event_actor_name(auth.uid()), now()");
  });
});

describe("migration: a ticket's stage on its timeline, from the database", () => {
  const sql = flatSql(MIGRATION);
  it("service_jobs_stage_log: SECURITY DEFINER; the first stage and every change", () => {
    expect(sql).toContain(
      "create or replace function public.service_jobs_stage_log() returns trigger language plpgsql security definer set search_path = public",
    );
    expect(sql).toContain(
      "if tg_op = 'INSERT' or new.stage is distinct from old.stage then insert into public.service_job_events (service_job_id, kind, stage, by_user, by_name, at) values (new.id, 'stage', new.stage, auth.uid(), public.event_actor_name(auth.uid()), now())",
    );
    expect(sql).toContain("drop trigger if exists service_jobs_stage_log on public.service_jobs");
    expect(sql).toContain(
      "create trigger service_jobs_stage_log after insert or update of stage on public.service_jobs for each row execute function public.service_jobs_stage_log()",
    );
  });
  it("the invoice path updates the stage column, so its changes are caught too", () => {
    const inv = flatSql("supabase/migrations/20261001080000_audit_triggers_stage_rule.sql");
    expect(inv).toMatch(/update public\.service_jobs set stage = p_stage/);
  });
  it("trigger functions are not callable by clients", () => {
    expect(sql).toContain("revoke all on function public.crm_opportunities_log() from public");
    expect(sql).toContain("revoke all on function public.service_jobs_stage_log() from public");
  });
});

describe("types: crm_opportunity_events", () => {
  const types = read("src/integrations/supabase/types.ts");
  const start = types.indexOf("      crm_opportunity_events: {");
  const block = types.slice(start, types.indexOf("      crm_site_contacts: {", start));
  it("Row / Insert / Update and the cascade's relationship", () => {
    expect(start).toBeGreaterThan(0);
    expect(flat(block)).toContain(
      "Row: { assignee: string | null; at: string; by_name: string | null; by_user: string | null; id: number; kind: string; opportunity_id: string; status: string | null; }",
    );
    expect(flat(block)).toContain("Insert: { assignee?: string | null; at?: string;");
    expect(block).toContain("kind: string;\n          opportunity_id: string;");
    expect(flat(block)).toContain("Update: { assignee?: string | null;");
    expect(block).toContain('foreignKeyName: "crm_opportunity_events_opportunity_id_fkey"');
    expect(block).toContain('referencedRelation: "crm_opportunities"');
  });
});

// ---------------------------------------------------------------------------------------------

describe("the app writes no 'stage' rows (the database does, once)", () => {
  const field = read("src/lib/service-field.functions.ts");
  it("setFieldStatus's Done no longer logs a stage row", () => {
    expect(field).not.toMatch(/kind:\s*"stage"/);
    expect(field).toContain("trigger service_jobs_stage_log");
  });
  it("logEvent cannot write one: its kinds leave 'stage' out", () => {
    expect(field).toContain(
      'export type AppEventKind = "field" | "note" | "assign" | "photo" | "signature" | "edit";',
    );
    expect(flat(field)).toContain("ev: { kind: AppEventKind;");
    expect(field).not.toMatch(/stage: ev\.stage/);
  });
  it("no other server file inserts a 'stage' row", () => {
    for (const f of [
      "src/lib/service.functions.ts",
      "src/lib/invoices.functions.ts",
      "src/lib/service-aerial.functions.ts",
      "src/lib/service-inspection.functions.ts",
      "src/lib/ticket-events.server.ts",
    ])
      expect(read(f), f).not.toMatch(/kind:\s*["']stage["']/);
  });
});

describe("listOpportunityEvents: the log, oldest first, under the table's RLS", () => {
  const src = read("src/lib/opportunities.functions.ts");
  const start = src.indexOf("export const listOpportunityEvents = createServerFn");
  const fn = src.slice(start, src.indexOf("\nconst ", start));
  it("reads crm_opportunity_events for the one opportunity", () => {
    expect(start).toBeGreaterThan(0);
    expect(fn).toContain(".middleware([requireSupabaseAuth])");
    expect(fn).toContain('.from("crm_opportunity_events")');
    expect(fn).toContain('.eq("opportunity_id", data.id)');
    expect(fn).toContain('.order("at", { ascending: true })');
    expect(fn).toContain("context.supabase");
  });
});

describe("StageStrip: a compact stepper — dots on a line, label and date beneath", () => {
  const src = read("src/components/stage-strip.tsx");
  it("left-aligned and capped in width, wrapping on a phone; no full-width boxes", () => {
    expect(src).toContain('className="flex max-w-3xl flex-wrap gap-y-3 text-xs"');
    expect(src).not.toContain("grid-cols-");
    expect(src).not.toContain("rounded-md border px-2 py-1.5");
  });
  it("the current step is the primary ringed dot with a bold label; reached steps filled; ahead hollow", () => {
    expect(src).toContain('aria-current={c.current ? "step" : undefined}');
    expect(src).toContain("bg-primary ring-2 ring-primary ring-offset-2 ring-offset-background");
    expect(src).toContain("const past = !!c.at && !c.current;");
    expect(src).toContain('? "bg-foreground/60"');
    expect(src).toContain('"border border-muted-foreground/40 bg-background"');
    expect(src).toContain(
      'c.current ? "font-semibold" : past ? "font-medium" : "text-muted-foreground"',
    );
  });
  it("a connector line after every step but the last; each date, blank when never reached", () => {
    expect(src).toContain("const last = i === cells.length - 1;");
    expect(src).toContain("{!last && (");
    expect(src).toContain('{c.at ? shortDate(c.at) : "\u00a0"}');
  });
});

describe("the ticket page: 'Opened … by …' under the title, the stage strip under the header", () => {
  const src = read("src/components/service-page.tsx");
  it("imports the helpers, the strip and the timeline's reader", () => {
    expect(src).toContain(
      'import { openedLine, openerName, ticketStageStrip } from "@/lib/stage-dates";',
    );
    expect(src).toContain('import { StageStrip } from "@/components/stage-strip";');
    expect(src).toContain('import { listJobEvents } from "@/lib/service-field.functions";');
  });
  it("the timeline's query (shared with the Timeline section) dates the strip", () => {
    expect(flat(src)).toContain(
      'queryKey: fieldKeys.events(job?.id ?? "new"), queryFn: () => eventsFn({ data: { id: job!.id } })',
    );
    expect(src).toContain(
      "const stageCells = job ? ticketStageStrip(asStage(job.stage), eventsQ.data ?? []) : [];",
    );
    expect(flat(src)).toContain(
      "openedLine(job.created_at, openerName(job.created_by, techs.data, eventsQ.data ?? []))",
    );
  });
  it("the Opened line sits right under the <h1> row, before the ticket numbers", () => {
    const h1 = src.indexOf('<h1 className="flex min-w-0 items-center gap-2 text-2xl');
    const opened = src.indexOf('data-line="opened"');
    const numbers = src.indexOf('aria-label="Ticket numbers"');
    expect(h1).toBeGreaterThan(0);
    expect(opened).toBeGreaterThan(h1);
    expect(opened).toBeLessThan(numbers);
    expect(src).toContain('<p className="text-sm text-muted-foreground" data-line="opened">');
  });
  it("the strip closes the header, on every width; the stage picker stays", () => {
    const strip = src.indexOf('<StageStrip cells={stageCells} label="Stages" />');
    expect(strip).toBeGreaterThan(src.indexOf('aria-label="Ticket numbers"'));
    expect(src.slice(strip, strip + 80)).toMatch(/\/>}\s*\n\s*<\/div>/);
    expect(src).toContain("value={asStage(job.stage)}");
    expect(src).toContain("onValueChange={(v) => stageMut.mutate(v as ServiceStage)}");
  });
  it("a stage change (picker, save, or from elsewhere) re-reads the dates", () => {
    expect(src).toContain("void qc.invalidateQueries({ queryKey: fieldKeys.events(job!.id) });");
    expect(src).toContain("void qc.invalidateQueries({ queryKey: fieldKeys.events(row.id) });");
    expect(src).toContain("void qc.invalidateQueries({ queryKey: fieldKeys.events(job.id) });");
  });
});

describe("the opportunity page: 'Opened … by …' and the status strip", () => {
  const src = read("src/components/opportunities-page.tsx");
  it("imports the helpers, the strip and the log's reader", () => {
    expect(src).toContain(
      'import { oppStatusStrip, openedLine, openerName } from "@/lib/stage-dates";',
    );
    expect(src).toContain('import { StageStrip } from "@/components/stage-strip";');
    expect(src).toMatch(/listOpportunityEvents,\n/);
  });
  it("the log's query dates the strip and names the opener", () => {
    expect(flat(src)).toContain(
      'queryKey: ["opportunity-events", opp?.id ?? "new"], queryFn: () => eventsFn({ data: { id: opp!.id } })',
    );
    expect(src).toContain(
      "const statusCells = opp ? oppStatusStrip(asStatus(opp.status), events.data ?? []) : [];",
    );
    expect(flat(src)).toContain(
      "openedLine(opp.created_at, openerName(opp.created_by, techs.data, events.data ?? []))",
    );
  });
  it("the Opened line under the title; the strip ends the header; the status select stays", () => {
    const h1 = src.indexOf("<h1 ");
    const opened = src.indexOf('data-line="opened"');
    const strip = src.indexOf('<StageStrip cells={statusCells} label="Status history" />');
    expect(opened).toBeGreaterThan(h1);
    expect(strip).toBeGreaterThan(opened);
    expect(src.slice(strip, strip + 90)).toMatch(/\/>}\s*\n\s*<\/div>/);
    expect(src).toContain("{statusSelect}");
  });
  it("every status change, save or logged contact re-reads the log", () => {
    const inv = src.slice(src.indexOf("const invalidate = (id: string) =>"));
    expect(inv.slice(0, 400)).toContain(
      'void qc.invalidateQueries({ queryKey: ["opportunity-events", id] });',
    );
  });
});
