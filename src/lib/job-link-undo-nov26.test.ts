/**
 * Link a repair ticket, then Unlink (the audit of Nov 25, finding 21; owner: "go on ... 21, 22,
 * 23, 24").
 *
 * Before: the window linked on one press and said nothing of Won; a linked repair marked the
 * opportunity Won; Unlink only cleared the link, so the opportunity stayed Won, off Work
 * Overview and the overdue tile, with no reminder, and could not be linked again. The same
 * press on a public Roof Care request's opportunity marked it Won before its plan was paid.
 * Linking an inspection made Open into Contacted, and Unlink left it Contacted, where the
 * "Not started" escalation never looks.
 *
 * Every name, title and number here is made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => "reopened") }));
vi.mock("@/lib/work-steps.server", () => ({ tellStep: vi.fn(async () => []) }));

import { syncFollowup } from "@/lib/followups.server";
import { linkOpportunityTicket, listLinkTickets } from "@/lib/job-link.functions";
import {
  LINK_CARE_NOT_WON,
  LINK_MOVES_LEAD,
  LINK_MOVES_LEAD_CARE,
  LINK_WON_NOT_CHECKED,
  linkRows,
  linkWinsAsk,
  linkWouldWin,
  unlinkedWords,
  type LinkTicketIn,
} from "@/lib/job-steps";
import { OPP_STATUSES } from "@/lib/opportunities.functions";
import { oppStatusFromTicket } from "@/lib/ticket-moves";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

const src = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const OPP = "0bb00000-0000-4000-8000-000000000001";
const TICKET = "7cc00000-0000-4000-8000-000000000071";
const ME = "user-mo";
const RO = "user-ro";
const ACME = "acct-acme";

type Row = Record<string, unknown>;
const job = (over: Row = {}): Row => ({
  id: TICKET,
  number: 7071,
  service_type: "repair",
  stage: "scheduled",
  scheduled_date: "2026-12-04",
  account_id: ACME,
  from_opportunity_id: null,
  from_job_id: null,
  deleted_at: null,
  site_name: "North plant",
  ...over,
});
const opportunity = (over: Row = {}): Row => ({
  id: OPP,
  title: "Leak at the dock",
  status: "quoted",
  account_id: ACME,
  assignee_id: RO,
  expected_close: "2026-12-10",
  deleted_at: null,
  ...over,
});

/** move_opportunity_from_ticket as the database answers it: an inspection, or anything else. */
const move: FakeRpc = (args, tables) => {
  const t = (tables["service_jobs"] ?? []).find((r) => r["id"] === args["p_job"]);
  const o = (tables["crm_opportunities"] ?? []).find((r) => r["id"] === t?.["from_opportunity_id"]);
  if (!t || !o) return { action: "none" };
  const to = oppStatusFromTicket(String(t["service_type"]), String(o["status"]));
  if (!to) return { action: "unchanged" };
  const from = o["status"];
  o["status"] = to;
  return {
    action: "updated",
    opportunity_id: o["id"],
    title: o["title"],
    from,
    to,
    ticket: t["number"],
    account_id: o["account_id"],
    assignee_id: o["assignee_id"],
    expected_close: o["expected_close"],
  };
};

function world(tables: Record<string, Row[]> = {}, rpcs: Record<string, FakeRpc> = {}) {
  const env = fakeSupabase(
    {
      profiles: [
        {
          id: ME,
          role: "manager",
          access: ["service"],
          technician: false,
          full_name: "Mo Manager",
          email: "mo@example.test",
        },
      ],
      crm_opportunities: [opportunity()],
      service_jobs: [job()],
      service_job_events: [],
      ...tables,
    },
    {
      rpcs: {
        move_opportunity_from_ticket: move,
        opportunity_from_care_request: () => false,
        ...rpcs,
      },
    },
  );
  const context = { supabase: env.db, userId: ME };
  const press = (link: boolean, confirmed?: boolean) =>
    linkOpportunityTicket({
      data: { opportunityId: OPP, ticketId: TICKET, link, confirmed },
      context,
    } as never) as unknown as Promise<{ message: string; moved: boolean; ask?: boolean }>;
  const list = () =>
    listLinkTickets({ data: { id: OPP }, context } as never) as unknown as Promise<{
      rows: { id: string; linked: boolean; ask: string | null }[];
      care: boolean;
    }>;
  const called = (fn: string) => env.rpcCalls.filter((c) => c.fn === fn).length;
  return { ...env, press, list, called };
}

beforeEach(() => {
  vi.mocked(syncFollowup).mockClear();
});

describe("(b) a link that would mark the opportunity Won asks first", () => {
  it("the rule is the database's own: every type and status agree with it", () => {
    for (const type of ["inspection", "warranty", "repair", "maintenance", "other"])
      for (const status of OPP_STATUSES)
        expect(linkWouldWin(type, { status })).toBe(oppStatusFromTicket(type, status) === "won");
  });

  it("the question, word for word", () => {
    expect(linkWinsAsk("repair")).toBe("Linking a repair marks this opportunity Won. Link it?");
    expect(linkWinsAsk("other")).toBe("Linking this ticket marks this opportunity Won. Link it?");
  });

  it("the window's row for a repair carries the question; an inspection's and a linked row's do not", () => {
    const t = (over: Partial<LinkTicketIn>) => ({ ...job(), ...over }) as unknown as LinkTicketIn;
    const rows = linkRows({ id: OPP, account_id: ACME, status: "quoted" }, [
      t({ id: "a", number: 7001 }),
      t({ id: "b", number: 7002, service_type: "inspection" }),
      t({ id: "c", number: 7003, from_opportunity_id: OPP }),
    ]);
    expect(rows.map((r) => [r.number, r.ask])).toEqual([
      [7003, null],
      [7001, "Linking a repair marks this opportunity Won. Link it?"],
      [7002, null],
    ]);
  });

  it("the server asks too: a repair linked without a yes changes nothing", async () => {
    const env = world();
    const out = await env.press(true);
    expect(out).toEqual({
      message: "Linking a repair marks this opportunity Won. Link it?",
      moved: false,
      ask: true,
    });
    expect(env.writes).toEqual([]);
    expect(env.tables["service_jobs"]![0]!["from_opportunity_id"]).toBeNull();
    expect(env.tables["crm_opportunities"]![0]!["status"]).toBe("quoted");
    expect(env.called("move_opportunity_from_ticket")).toBe(0);
  });

  it("with the yes it is linked and marked Won, and the message says so", async () => {
    const env = world();
    const out = await env.press(true, true);
    expect(out).toEqual({
      message: "Repair #7071 is linked to this opportunity. The opportunity is now Won.",
      moved: true,
    });
    expect(env.tables["service_jobs"]![0]!["from_opportunity_id"]).toBe(OPP);
  });

  it("an inspection is linked on the one press, as before: it marks nothing Won", async () => {
    const env = world({
      service_jobs: [job({ service_type: "inspection" })],
      crm_opportunities: [opportunity({ status: "open" })],
    });
    const out = await env.press(true);
    expect(out).toEqual({
      message: "Inspection #7071 is linked to this opportunity. The opportunity is now Contacted.",
      moved: true,
    });
    // Nothing to ask the Roof Care question for.
    expect(env.called("opportunity_from_care_request")).toBe(0);
  });

  it("the window asks on the row itself, and says what a link does before any press", () => {
    const w = src("src/components/link-ticket.tsx");
    expect(w).toContain("data-link-ask");
    expect(w).toContain("? setAsking({ id: r.id, text: r.ask })");
    expect(w).toContain("press.mutate({ ticketId: r.id, link: true, confirmed: true })");
    expect(w).toContain("{LINK_WINS_YES}");
    expect(w).toContain("{LINK_WINS_NO}");
    // The server's own question is shown too, whatever the window knew.
    expect(flat(w)).toContain(
      "if (out.ask) { setAsking({ id: v.ticketId, text: out.message }); return; }",
    );
    expect(w).toContain("{rows.data?.care ? LINK_MOVES_LEAD_CARE : LINK_MOVES_LEAD}");
    expect(LINK_MOVES_LEAD).toBe(
      "Linking an inspection makes an Open opportunity Contacted. Linking a repair marks it Won. Unlink puts the status back when nothing else has changed it since.",
    );
    // No new screen: the same one window.
    expect(w.match(/<Dialog\b/g)).toHaveLength(1);
  });
});

describe("(c) a Roof Care request's opportunity is never marked Won by a link", () => {
  const care = { opportunity_from_care_request: () => true };

  it("the link is made, the opportunity stays where it was, and the message says why", async () => {
    const env = world({}, care);
    const out = await env.press(true);
    expect(out).toEqual({
      message: `Repair #7071 is linked to this opportunity. ${LINK_CARE_NOT_WON}`,
      moved: false,
    });
    expect(LINK_CARE_NOT_WON).toBe(
      "The opportunity was not marked Won: it came from a Roof Care request and turns Won when its plan is paid.",
    );
    expect(env.tables["service_jobs"]![0]!["from_opportunity_id"]).toBe(OPP);
    expect(env.tables["crm_opportunities"]![0]!["status"]).toBe("quoted");
    expect(env.called("move_opportunity_from_ticket")).toBe(0);
  });

  it("an inspection linked to it still makes an Open one Contacted", async () => {
    const env = world(
      {
        service_jobs: [job({ service_type: "inspection" })],
        crm_opportunities: [opportunity({ status: "open" })],
      },
      care,
    );
    expect((await env.press(true)).message).toBe(
      "Inspection #7071 is linked to this opportunity. The opportunity is now Contacted.",
    );
  });

  it("the window asks nothing for it and says a link never marks it Won", async () => {
    const env = world({}, care);
    const out = await env.list();
    expect(out.care).toBe(true);
    expect(out.rows.map((r) => r.ask)).toEqual([null]);
    expect(LINK_MOVES_LEAD_CARE).toContain("A link never marks this one Won");
    // Any other opportunity: the row asks.
    const plain = await world().list();
    expect(plain.care).toBe(false);
    expect(plain.rows[0]?.ask).toBe("Linking a repair marks this opportunity Won. Link it?");
  });

  it("when the site cannot ask, it moves nothing and says so plainly", async () => {
    const env = world(
      {},
      {
        opportunity_from_care_request: () => {
          throw new Error("permission denied");
        },
      },
    );
    const out = await env.press(true, true);
    expect(out).toEqual({
      message: `Repair #7071 is linked to this opportunity. ${LINK_WON_NOT_CHECKED}`,
      moved: false,
    });
    expect(env.called("move_opportunity_from_ticket")).toBe(0);
    expect(env.tables["crm_opportunities"]![0]!["status"]).toBe("quoted");
  });

  it("before the migration is applied there is no such function: a link works as it did, after the question", async () => {
    const env = world();
    // The missing-function answer is PostgREST's own, given here.
    const missing = fakeSupabase(env.tables, {
      rpcs: { move_opportunity_from_ticket: move },
      rpc: (fn) =>
        fn === "opportunity_from_care_request"
          ? {
              data: null,
              error: { code: "PGRST202", message: `Could not find the function public.${fn}` },
            }
          : undefined,
    });
    const out = (await linkOpportunityTicket({
      data: { opportunityId: OPP, ticketId: TICKET, link: true, confirmed: true },
      context: { supabase: missing.db, userId: ME },
    } as never)) as unknown as { message: string };
    expect(out.message).toBe(
      "Repair #7071 is linked to this opportunity. The opportunity is now Won.",
    );
  });

  it("the database function answers only the people who create tickets, from the requests", () => {
    const sql = flat(src("supabase/migrations/20261125400000_job_link_undo.sql"));
    const fn = sql.slice(
      sql.indexOf("create or replace function public.opportunity_from_care_request(p_opp uuid)"),
      sql.indexOf("revoke all on function public.opportunity_from_care_request(uuid)"),
    );
    expect(fn).toContain("security definer set search_path to 'public'");
    expect(fn).toContain("raise exception 'Forbidden' using errcode = '42501';");
    expect(fn).toContain(
      "select 1 from public.public_requests q where q.opportunity_id = p_opp and q.kind = 'care'",
    );
    expect(sql).toContain(
      "revoke all on function public.opportunity_from_care_request(uuid) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.opportunity_from_care_request(uuid) to authenticated, service_role;",
    );
  });
});

describe("(a) Unlink puts the opportunity back when the link was what moved it", () => {
  const linked = () => ({
    service_jobs: [job({ from_opportunity_id: OPP })],
    crm_opportunities: [opportunity({ status: "won" })],
  });
  /** undo_opportunity_from_ticket: the link's move was the last step, so it goes back. */
  const back: FakeRpc = (args, tables) => {
    const o = (tables["crm_opportunities"] ?? []).find((r) => r["id"] === args["p_opp"])!;
    o["status"] = "quoted";
    return {
      action: "updated",
      opportunity_id: OPP,
      title: o["title"],
      from: "won",
      to: "quoted",
      ticket: 7071,
      account_id: o["account_id"],
      assignee_id: o["assignee_id"],
      expected_close: o["expected_close"],
    };
  };

  it("the words", () => {
    expect(unlinkedWords("Repair #7071")).toBe(
      "Repair #7071 is no longer linked to this opportunity.",
    );
    expect(unlinkedWords("Repair #7071", { back: "Quoted" })).toBe(
      "Repair #7071 is no longer linked to this opportunity. The opportunity is Quoted again.",
    );
    expect(unlinkedWords("Repair #7071", { still: "Won" })).toBe(
      "Repair #7071 is no longer linked to this opportunity. The opportunity is still Won.",
    );
  });

  it("Won by the link, nothing since: it is Quoted again, its follow-up is reopened, and the message says so", async () => {
    const env = world(linked(), { undo_opportunity_from_ticket: back });
    const out = await env.press(false);
    expect(out).toEqual({
      message:
        "Repair #7071 is no longer linked to this opportunity. The opportunity is Quoted again.",
      moved: true,
    });
    expect(env.tables["service_jobs"]![0]!["from_opportunity_id"]).toBeNull();
    expect(env.tables["crm_opportunities"]![0]!["status"]).toBe("quoted");
    // The function is asked with this ticket and this opportunity, after the link is off.
    expect(env.rpcCalls.filter((c) => c.fn === "undo_opportunity_from_ticket")).toEqual([
      { fn: "undo_opportunity_from_ticket", args: { p_job: TICKET, p_opp: OPP } },
    ]);
    expect(vi.mocked(syncFollowup)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncFollowup).mock.calls[0]![0]).toMatchObject({
      kind: "opportunity",
      itemId: OPP,
      assigneeId: RO,
      closing: false,
      reopened: true,
      dueDate: "2026-12-10",
    });
  });

  it("moved by something else since: it is left, and the message says where it stands", async () => {
    const env = world(linked(), {
      undo_opportunity_from_ticket: () => ({
        action: "unchanged",
        opportunity_id: OPP,
        status: "won",
        by_ticket: true,
      }),
    });
    const out = await env.press(false);
    expect(out).toEqual({
      message:
        "Repair #7071 is no longer linked to this opportunity. The opportunity is still Won.",
      moved: false,
    });
    expect(env.tables["crm_opportunities"]![0]!["status"]).toBe("won");
    expect(vi.mocked(syncFollowup)).not.toHaveBeenCalled();
  });

  it("the cousin: an inspection's link made Open into Contacted, and Unlink makes it Open again", async () => {
    const env = world(
      {
        service_jobs: [job({ service_type: "inspection", from_opportunity_id: OPP })],
        crm_opportunities: [opportunity({ status: "contacted" })],
      },
      {
        undo_opportunity_from_ticket: () => ({
          action: "updated",
          opportunity_id: OPP,
          title: "Leak at the dock",
          from: "contacted",
          to: "open",
          account_id: ACME,
          assignee_id: RO,
          expected_close: "2026-12-10",
        }),
      },
    );
    expect((await env.press(false)).message).toBe(
      "Inspection #7071 is no longer linked to this opportunity. The opportunity is Open again.",
    );
  });

  it("an inspection that never moved it says nothing of the status", async () => {
    const env = world(
      {
        service_jobs: [job({ service_type: "inspection", from_opportunity_id: OPP })],
        crm_opportunities: [opportunity({ status: "quoted" })],
      },
      {
        undo_opportunity_from_ticket: () => ({
          action: "unchanged",
          opportunity_id: OPP,
          status: "quoted",
          by_ticket: false,
        }),
      },
    );
    expect((await env.press(false)).message).toBe(
      "Inspection #7071 is no longer linked to this opportunity.",
    );
  });

  it("a failure to look at the status is said, and the link is off all the same", async () => {
    const env = world(linked(), {
      undo_opportunity_from_ticket: () => {
        throw new Error("permission denied");
      },
    });
    const out = await env.press(false);
    expect(out.message).toBe(
      "Repair #7071 is no longer linked to this opportunity. The site could not check the opportunity's status, so open the opportunity and look at it (permission denied).",
    );
    expect(env.tables["service_jobs"]![0]!["from_opportunity_id"]).toBeNull();
  });

  it("the database function: only this ticket's own last step, still in place, goes back", () => {
    const sql = flat(src("supabase/migrations/20261125400000_job_link_undo.sql"));
    const fn = sql.slice(
      sql.indexOf(
        "create or replace function public.undo_opportunity_from_ticket(p_job uuid, p_opp uuid)",
      ),
      sql.indexOf("revoke all on function public.undo_opportunity_from_ticket(uuid, uuid)"),
    );
    expect(fn).toContain("security definer set search_path to 'public'");
    // The same people as the move.
    expect(fn).toContain(
      "public.has_access('service') and (public.is_admin() or public.is_manager() or not public.is_technician())",
    );
    // Only once the ticket is off this opportunity.
    expect(fn).toContain(
      "if v_job.from_opportunity_id is not distinct from p_opp then return jsonb_build_object('action', 'none', 'reason', 'still linked');",
    );
    // The last status step is the one this ticket made, and the opportunity still stands there.
    expect(fn).toContain("v_note := 'from ticket #' || v_job.number;");
    expect(fn).toContain("order by e.at desc, e.id desc limit 1;");
    expect(fn).toContain(
      "if not found or v_last.status is distinct from v_opp.status or v_last.note is distinct from v_note then",
    );
    // Where it stood before, and never back into a closed status.
    expect(fn).toContain("and (e.at, e.id) < (v_last.at, v_last.id)");
    expect(fn).toContain(
      "if v_prev is null or v_prev = v_opp.status or v_prev in ('won', 'lost', 'no_response') then",
    );
    // The log says where the step back came from.
    expect(fn).toContain(
      "perform set_config('app.opportunity_move_note', 'ticket #' || v_job.number || ' unlinked', true);",
    );
    // What the follow-up needs comes back, as from the move.
    expect(fn).toContain(
      "'account_id', v_opp.account_id, 'assignee_id', v_opp.assignee_id, 'expected_close', v_opp.expected_close",
    );
    expect(sql).toContain(
      "revoke all on function public.undo_opportunity_from_ticket(uuid, uuid) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.undo_opportunity_from_ticket(uuid, uuid) to authenticated, service_role;",
    );
    // The move itself is not replaced: the live one stays as it is.
    expect(sql).not.toContain("function public.move_opportunity_from_ticket");
  });

  it("Unlink asks the database after the link is off, and never throws for it", () => {
    const f = src("src/lib/job-link.functions.ts");
    const unlink = f.slice(f.indexOf("if (!data.link) {"), f.indexOf("if (opp.deleted_at"));
    expect(unlink.indexOf(".update({ from_opportunity_id: null")).toBeLessThan(
      unlink.indexOf("undoOpportunityFromTicket(context, t.id, opp.id)"),
    );
    const o = src("src/lib/opportunities.functions.ts");
    const undo = o.slice(
      o.indexOf("export async function undoOpportunityFromTicket("),
      o.indexOf("export async function opportunityFromCareRequest("),
    );
    expect(undo).toContain("return { error: e instanceof Error ? e.message : String(e) };");
    expect(undo).toContain("if (isMissingDatabaseFunction(error)) return {};");
  });
});
