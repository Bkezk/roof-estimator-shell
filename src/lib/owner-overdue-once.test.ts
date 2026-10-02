/**
 * Audit, Oct 2 (reproduced): the Owner view counted an overdue opportunity twice. An assigned,
 * open opportunity past its expected close has an open follow-up whose due date is that expected
 * close; the follow-up is in My Work's Overdue bucket AND `oppCounts` added the opportunity again
 * (`overdue: b.overdue + o.overdue`), so Owner said Overdue 2 while the My Work list it links to
 * showed 1; the person's detail listed both rows (`followup:…` and `opportunity:…`). And the
 * per-person "Open opportunities" number opened everyone's list.
 *
 * Fix: each number is "the rows the linked list shows" (owner-view.ts). An overdue opportunity
 * with an open follow-up of its assignee is counted once, as that follow-up's row (the follow-up
 * row wins; it opens the opportunity too); only overdue opportunities with NO open follow-up are
 * added. The per-person opportunity links carry `assignee=<id>` (oppsHref), which /opportunities
 * now reads (opportunities-search.ts) and the list filters on.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { listGroups, mergeWork, presetGroups, type FollowupIn } from "@/lib/my-work";
import {
  bucketCounts,
  bucketsFor,
  detailGroups,
  digestLine,
  oppCounts,
  oppsHref,
  ownerTotals,
  personNumbers,
  type DetailOppIn,
  type OwnerRow,
} from "@/lib/owner-view";
import { matchesAssignee, parseOpportunitiesSearch } from "@/lib/opportunities-search";

const read = (p: string) => readFileSync(p, "utf8");
const TODAY = "2026-10-02";
const BOB = "11111111-1111-4111-8111-111111111111";
const ANN = "22222222-2222-4222-8222-222222222222";
const OPP = "33333333-3333-4333-8333-333333333333";
const OPP2 = "44444444-4444-4444-8444-444444444444";
const toYmd = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** The auditor's data: one open opportunity, its follow-up due at the (past) expected close. */
const opp: DetailOppIn = {
  id: OPP,
  title: "Reroof — Yellow Creek gym",
  assignee_id: BOB,
  status: "contacted",
  expected_close: "2026-09-25",
  est_value: 50000,
};
const followup: FollowupIn = {
  id: "f-opp",
  title: "Reroof — Yellow Creek gym",
  url: `/opportunities?id=${OPP}`,
  due_at: "2026-09-25T12:00:00.000Z",
  status: "open",
  kind: "opportunity",
  item_id: OPP,
  assignee_id: BOB,
};

/** Bob's numbers composed as the server composes them, and the lists they link to. */
function bobsOverdue(followups: FollowupIn[], opps: DetailOppIn[]) {
  const items = mergeWork({ tickets: [], tasks: [], followups }, toYmd);
  const b = bucketsFor(bucketCounts(items, TODAY), BOB);
  const o = oppCounts(opps, TODAY, followups)[BOB];
  // The old server's composition: `overdue: b.overdue + o.overdue`.
  const inline = b.overdue + (o?.overdue ?? 0);
  const mine = items.filter((i) => i.assigneeId === BOB);
  const myWorkOverdue = presetGroups(listGroups(mine, TODAY), "overdue")[0]?.items.length ?? 0;
  const detail = detailGroups(BOB, items, opps, TODAY, followups);
  return { b, o, inline, myWorkOverdue, detail };
}

describe("the auditor's reproduction: an overdue opportunity with its open follow-up", () => {
  it("Owner Overdue = 1 = the My Work Overdue list it links to (old code: 2)", () => {
    const r = bobsOverdue([followup], [opp]);
    expect(r.myWorkOverdue).toBe(1);
    expect(r.inline).toBe(1);
  });
  it("the detail lists one row for it: the follow-up row (it opens the opportunity)", () => {
    const r = bobsOverdue([followup], [opp]);
    expect(r.detail.overdue.map((i) => i.key)).toEqual(["followup:f-opp"]);
    expect(r.detail.overdue[0]!.href).toBe(`/opportunities?id=${OPP}`);
  });
  it("personNumbers: the row's numbers, defined once (Overdue 1, still 1 open opportunity)", () => {
    const r = bobsOverdue([followup], [opp]);
    const n = personNumbers(r.b, r.o);
    expect(n.overdue).toBe(r.myWorkOverdue);
    expect(n.overdue).toBe(r.detail.overdue.length);
    expect(n).toMatchObject({ overdue: 1, overdueOpps: 0, openOpps: 1, oppValue: 50000 });
  });
  it("the totals row and the digest line agree with the rows", () => {
    const r = bobsOverdue([followup], [opp]);
    const row: OwnerRow = {
      id: BOB,
      name: "Bob",
      role: "Sales-PM",
      ...personNumbers(r.b, r.o),
      doneThisWeek: 0,
      lastActivity: null,
      stale: false,
    };
    const t = ownerTotals([row]);
    expect(t.overdue).toBe(1);
    expect(digestLine(t)).toContain("1 overdue across the team");
  });
});

describe("an overdue opportunity is still counted when nothing else lists it", () => {
  it("no open follow-up (closed by hand): Overdue 1, its opportunity row in the detail", () => {
    const r = bobsOverdue([{ ...followup, status: "closed" }], [opp]);
    expect(r.myWorkOverdue).toBe(0);
    expect(r.inline).toBe(1);
    expect(r.detail.overdue.map((i) => i.key)).toEqual([`opportunity:${OPP}`]);
  });
  it("a follow-up of someone else's does not hide Bob's opportunity", () => {
    const r = bobsOverdue([{ ...followup, assignee_id: ANN }], [opp]);
    expect(r.inline).toBe(1);
    expect(r.detail.overdue.map((i) => i.key)).toEqual([`opportunity:${OPP}`]);
  });
  it("two overdue opportunities, one with a follow-up: 2 counted, one row each", () => {
    const other: DetailOppIn = { ...opp, id: OPP2, title: "Gutters" };
    const r = bobsOverdue([followup], [opp, other]);
    expect(r.inline).toBe(2);
    expect(r.detail.overdue.map((i) => i.key).sort()).toEqual(
      [`opportunity:${OPP2}`, "followup:f-opp"].sort(),
    );
  });
});

describe("the per-person opportunity links carry the person", () => {
  it("Open opportunities → that person's All open list; the totals row → everyone's", () => {
    expect(oppsHref(BOB)).toEqual({
      to: "/opportunities",
      search: { status: "allopen", assignee: BOB },
    });
    expect(oppsHref(BOB, true)).toEqual({
      to: "/opportunities",
      search: { status: "allopen", assignee: BOB, overdue: 1 },
    });
    expect(oppsHref("all")).toEqual({ to: "/opportunities", search: { status: "allopen" } });
  });
  it("/opportunities reads the assignee back and the list filters on it", () => {
    expect(parseOpportunitiesSearch(oppsHref(BOB).search)).toEqual({
      status: "allopen",
      assignee: BOB,
    });
    expect(matchesAssignee({ assignee_id: BOB }, BOB)).toBe(true);
    expect(matchesAssignee({ assignee_id: ANN }, BOB)).toBe(false);
    expect(matchesAssignee({ assignee_id: null }, undefined)).toBe(true);
  });
  it("the Owner view uses oppsHref for every opportunity link", () => {
    const src = read("src/components/owner-view.tsx");
    expect(src).toContain("{...oppsHref(r.id)}");
    expect(src).toContain("{...oppsHref(r.id, true)}");
    expect(src).toContain('{...oppsHref("all")}');
    expect(src).not.toMatch(/search=\{\{ status: OPP_ALL_OPEN/);
  });
  it("the route passes assignee to the page and the list filters with matchesAssignee", () => {
    expect(read("src/routes/opportunities.tsx")).toContain("assignee={search.assignee}");
    const page = read("src/components/opportunities-page.tsx");
    expect(page).toContain("presetAssignee={assignee}");
    expect(page).toContain("if (!matchesAssignee(o, assigneeOnly)) return false;");
  });
  it("the server composes the row with personNumbers and passes the follow-ups", () => {
    const fn = read("src/lib/owner-view.functions.ts");
    expect(fn).not.toContain("overdue: b.overdue + o.overdue");
    expect(fn).toContain("...personNumbers(bucketsFor(buckets, p.id), oppsBy[p.id])");
    expect(fn).toContain('oppCounts(must("Opportunities", opps), today, followupRows)');
    expect(fn).toMatch(/detailGroups\([\s\S]*?today,\s*followupRows,\s*\)/);
    expect(fn).toContain('.select("id, assignee_id, status, expected_close, est_value")');
  });
});
