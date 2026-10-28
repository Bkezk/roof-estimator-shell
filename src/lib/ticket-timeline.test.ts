/**
 * The ticket's Activity stream (owner, Oct 27): the contact log and the ticket's events as one
 * list, newest first, the database's copies of contacts dropped in favour of the contact-log
 * row. The copy fixture is built from what the trigger writes (crm_contact_log_apply,
 * 20260928120000_untouched.sql / 20261015090000_timeline_comments_service.sql): kind 'contact',
 * the same note, by_user, by_name and `at`, meta {method}.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { ContactLogRow } from "@/lib/contact-log.functions";
import type { JobEventRow } from "@/lib/service-field.functions";
import {
  ACTIVITY_EMPTY,
  contactEntry,
  entriesLine,
  eventEntry,
  mergeTimeline,
  TIMELINE_LIST_CLASS,
  TIMELINE_ROWS_SHOWN,
} from "@/lib/ticket-timeline";

const JOB = "11111111-1111-4111-8111-111111111111";
const BOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const contact = (
  over: Partial<ContactLogRow> & Pick<ContactLogRow, "id" | "at">,
): ContactLogRow => ({
  kind: "ticket",
  item_id: JOB,
  method: "called",
  note: null,
  by_user: BOB,
  by_name: "Bob Tech",
  ...over,
});
const event = (over: Partial<JobEventRow> & Pick<JobEventRow, "id" | "at">): JobEventRow => ({
  service_job_id: JOB,
  kind: "note",
  stage: null,
  field_status: null,
  note: null,
  by_user: BOB,
  by_name: "Bob Tech",
  meta: null,
  ...over,
});
/** The row crm_contact_log_apply inserts for a logged contact — exactly its columns. */
const copyOf = (c: ContactLogRow, id: number): JobEventRow =>
  event({
    id,
    kind: "contact",
    note: c.note,
    by_user: c.by_user,
    by_name: c.by_name,
    at: c.at,
    meta: { method: c.method },
  });

describe("mergeTimeline", () => {
  it("empty cases: nothing, only contacts, only events", () => {
    expect(mergeTimeline([], [])).toEqual([]);
    const c = contact({ id: 1, at: "2026-10-20T14:00:00+00:00" });
    expect(mergeTimeline([c], []).map((e) => e.key)).toEqual(["contact:1"]);
    const e = event({ id: 7, at: "2026-10-20T14:00:00+00:00", kind: "stage", stage: "open" });
    expect(mergeTimeline([], [e]).map((e) => e.key)).toEqual(["event:7"]);
  });

  it("orders newest first across the two sources; at the same instant the contact-log row leads", () => {
    const c1 = contact({ id: 1, at: "2026-10-20T14:00:00+00:00", method: "texted" });
    const c2 = contact({ id: 2, at: "2026-10-22T09:30:00+00:00", method: "comment", note: "Hi" });
    const e1 = event({ id: 10, at: "2026-10-19T08:00:00+00:00", kind: "stage", stage: "open" });
    const e2 = event({
      id: 11,
      at: "2026-10-21T12:00:00+00:00",
      note: "Date moved from Oct 3, 2026 to Oct 10, 2026",
      meta: { date_from: "2026-10-03", date_to: "2026-10-10" },
    });
    const e3 = event({
      id: 12,
      at: "2026-10-22T09:30:00+00:00",
      kind: "stage",
      stage: "scheduled",
    });
    const keys = mergeTimeline([c2, c1], [e3, e2, e1]).map((e) => e.key);
    expect(keys).toEqual(["contact:2", "event:12", "event:11", "contact:1", "event:10"]);
    // The input order does not matter.
    expect(mergeTimeline([c1, c2], [e1, e2, e3]).map((e) => e.key)).toEqual(keys);
  });

  it("drops the database's copy of a logged contact (same instant, method and note), keeping the contact-log row", () => {
    const called = contact({
      id: 1,
      at: "2026-10-20T14:00:00.123456+00:00",
      note: "Left a voicemail",
    });
    const visited = contact({ id: 2, at: "2026-10-21T10:00:00+00:00", method: "visited" });
    const out = mergeTimeline([called, visited], [copyOf(called, 50), copyOf(visited, 51)]);
    expect(out.map((e) => e.key)).toEqual(["contact:2", "contact:1"]);
    expect(out[1]).toMatchObject({
      source: "contact",
      label: "Called",
      text: "Left a voicemail",
      byName: "Bob Tech",
      icon: "called",
      done: false,
    });
  });

  it("a contact event with no contact-log row behind it stays (worded by its method)", () => {
    const stray = event({
      id: 60,
      at: "2026-10-20T14:00:00+00:00",
      kind: "contact",
      note: "Spoke to Jim",
      meta: { method: "emailed" },
    });
    const out = mergeTimeline([], [stray]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: "Emailed", text: "Spoke to Jim", icon: "emailed" });
  });

  it("never dedupes genuine rows: a hand note or a stage row at a contact's instant, or a comment", () => {
    const at = "2026-10-20T14:00:00+00:00";
    const called = contact({ id: 1, at, note: "x" });
    const note = event({ id: 70, at, kind: "note", note: "x" }); // a hand note, same text, same instant
    const stage = event({ id: 71, at, kind: "stage", stage: "scheduled" });
    const comment = contact({ id: 2, at, method: "comment", note: "x" });
    const twoCalls = [called, contact({ id: 3, at: "2026-10-20T14:00:01+00:00", note: "x" })];
    expect(mergeTimeline([called, comment], [note, stage]).map((e) => e.key)).toEqual([
      "contact:2",
      "contact:1",
      "event:71",
      "event:70",
    ]);
    // Two calls a second apart each keep their own row (their copies each match their own).
    expect(
      mergeTimeline(twoCalls, [copyOf(twoCalls[0]!, 80), copyOf(twoCalls[1]!, 81)]).map(
        (e) => e.key,
      ),
    ).toEqual(["contact:3", "contact:1"]);
  });
});

describe("the rows' wording and icons (what the two lists showed until Oct 27)", () => {
  const at = "2026-10-20T14:00:00+00:00";
  it("contact-log rows: the method's label, a comment reads Note (owner, Oct 28), Service done (highlighted), Note", () => {
    expect(contactEntry(contact({ id: 1, at, method: "called" }))).toMatchObject({
      label: "Called",
      icon: "called",
      done: false,
      text: null,
    });
    expect(contactEntry(contact({ id: 1, at, method: "comment", note: "Hi" }))).toMatchObject({
      label: "Note",
      icon: "comment",
      text: "Hi",
    });
    expect(
      contactEntry(contact({ id: 1, at, method: "service", note: "Service completed by Bob" })),
    ).toMatchObject({ label: "Service done", icon: "service", done: true });
    expect(
      contactEntry(
        contact({ id: 1, at, method: "note", note: "On hold until Oct 24, 2026 by Bob: r" }),
      ),
    ).toMatchObject({ label: "Note", icon: "note" });
    expect(contactEntry(contact({ id: 1, at, note: "  " })).text).toBeNull();
  });
  it("events: Stage: Open, the date-move text, Note, field status, photos, signature, crew", () => {
    expect(eventEntry(event({ id: 1, at, kind: "stage", stage: "open" }))).toMatchObject({
      label: "Stage: Open",
      icon: "stage",
      text: null,
    });
    expect(eventEntry(event({ id: 1, at, kind: "stage", stage: "weird" }))).toMatchObject({
      label: "Stage: weird",
    });
    expect(
      eventEntry(
        event({
          id: 1,
          at,
          kind: "note",
          note: "Date moved from Oct 3, 2026 to Oct 10, 2026",
          meta: { date_from: "2026-10-03", date_to: "2026-10-10" },
        }),
      ),
    ).toMatchObject({
      label: "Date moved from Oct 3, 2026 to Oct 10, 2026",
      icon: "date",
      text: null,
    });
    expect(eventEntry(event({ id: 1, at, kind: "note", note: "Call Jim at 8" }))).toMatchObject({
      label: "Note",
      text: "Call Jim at 8",
      icon: "note",
    });
    expect(eventEntry(event({ id: 1, at, kind: "field", field_status: "en_route" }))).toMatchObject(
      { label: "En route", icon: "field" },
    );
    expect(eventEntry(event({ id: 1, at, kind: "field", note: "left site" }))).toMatchObject({
      label: "Left the site",
    });
    expect(eventEntry(event({ id: 1, at, kind: "field", note: "undo" }))).toMatchObject({
      label: "Undid the last step",
    });
    expect(eventEntry(event({ id: 1, at, kind: "photo", meta: { role: "before" } }))).toMatchObject(
      { label: "Before photo added", icon: "photo" },
    );
    expect(eventEntry(event({ id: 1, at, kind: "signature" }))).toMatchObject({
      label: "Customer signed",
      icon: "signature",
    });
    expect(
      eventEntry(event({ id: 1, at, kind: "edit", note: "Crew: alone on the job" })),
    ).toMatchObject({ label: "Crew: alone on the job", icon: "crew" });
    expect(eventEntry(event({ id: 1, at, kind: "edit", note: "Renamed" }))).toMatchObject({
      icon: "edit",
    });
    expect(eventEntry(event({ id: 1, at, kind: "assign", note: "to Bob" }))).toMatchObject({
      label: "assign: to Bob",
    });
  });
});

describe("the cap, the count line and the empty line", () => {
  it("about eight rows, then the list scrolls in its own bordered box, light and dark", () => {
    expect(TIMELINE_ROWS_SHOWN).toBe(8);
    expect(TIMELINE_LIST_CLASS).toContain("max-h-[10.75rem]");
    expect(TIMELINE_LIST_CLASS).toContain("overflow-y-auto");
    expect(TIMELINE_LIST_CLASS).toMatch(/\bborder\b/);
    expect(TIMELINE_LIST_CLASS).toMatch(/\brounded-md\b/);
    expect(TIMELINE_LIST_CLASS).toMatch(/dark:/);
  });
  it('"1 entry" / "12 entries"; "No activity yet"', () => {
    expect(entriesLine(1)).toBe("1 entry");
    expect(entriesLine(12)).toBe("12 entries");
    expect(ACTIVITY_EMPTY).toBe("No activity yet");
  });
});

describe("the migrations the dedupe is built on", () => {
  it("crm_contact_log_apply copies a contact's note, by_user, by_name, at and meta.method; a note / comment / service row is not copied", () => {
    const sql = readFileSync(
      "supabase/migrations/20261015090000_timeline_comments_service.sql",
      "utf8",
    );
    expect(sql).toContain("if new.method in ('note', 'comment', 'service') then");
    expect(sql).toContain(
      "insert into public.service_job_events (service_job_id, kind, note, by_user, by_name, at, meta)",
    );
    expect(sql).toContain(
      "values (new.item_id, 'contact', new.note, new.by_user, new.by_name, new.at,",
    );
    expect(sql).toContain("jsonb_build_object('method', new.method));");
  });
  it("both lists are readable by whoever can open the ticket: the events by any Service / Customers login, the contact log by anyone who can see the ticket row", () => {
    const events = readFileSync("supabase/migrations/20260927130000_service_field.sql", "utf8");
    expect(events).toContain(
      "create policy service_job_events_read on public.service_job_events for select to authenticated\n  using (public.has_access('service') or public.has_access('customers'));",
    );
    const log = readFileSync("supabase/migrations/20260928120000_untouched.sql", "utf8");
    expect(log).toContain(
      "create policy crm_contact_log_read on public.crm_contact_log for select to authenticated",
    );
    expect(log).toContain(
      "(kind = 'ticket' and exists (select 1 from public.service_jobs j where j.id = item_id))",
    );
  });
});
