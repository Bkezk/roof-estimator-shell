/**
 * History at this property, as the owner settled it on Nov 17, in three steps.
 *
 * "when the tech clicks history at this property i just want them to see this and then they can
 * click the ticket and itll pop up its photos and notes from the tickets and on the activity log
 * have a check box that says viewable to technicians and anything with that check box should
 * also show". Then, of a pop-up that showed the earlier ticket whole: "again i dont really want
 * them to see the whole ticket just the history at this property and the activities that are
 * check viewable to the techs in a timeline like setup". And, asked: "i like the timeline but id
 * like to be able to click the ticket to see the photos", with the inspection's findings and the
 * repairs and closing notes shown too.
 *
 * So: one timeline; each earlier ticket carries what was found, the repairs, the closing notes
 * and the Activity entries ticked "Viewable to technicians"; a tap on the ticket opens its
 * photos and nothing else; the earlier ticket's Special instructions are not shown.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { ContactLogRow } from "@/lib/contact-log.functions";
import {
  HISTORY_NO_PHOTOS,
  flaggedHistoryItems,
  historyNoteLabel,
  historyPhotosHint,
  historyTicketSchema,
  siteHistorySchema,
  type HistoryPhoto,
  type SiteHistoryTicket,
} from "@/lib/service-history";
import {
  TECH_VISIBLE_LABEL,
  canBeTechVisible,
  choosesTechVisible,
  techVisibleOnSave,
} from "@/lib/tech-visible";
import { contactEntry, groupTimeline } from "@/lib/ticket-timeline";

const read = (p: string) => readFileSync(p, "utf8");
const TODAY = new Date(2026, 10, 17);

const OFFICE = { role: "user", access: ["service", "customers"], technician: false };
const MANAGER_TECH = { role: "manager", access: [], technician: true };
const TECH_ONLY = { role: "user", access: ["service"], technician: true };

const fromDb = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  number: 6069,
  service_type: "inspection",
  description: "Roof check",
  scheduled_date: "2026-11-10",
  completed_at: "2026-11-10T16:00:00.000Z",
  created_at: "2026-11-09T12:00:00.000Z",
  stage: "done",
  location_id: null,
  location_name: null,
  closing_notes: null,
  inspection_outcome: "repair_ticket",
  technician_name: "Ted Tech",
  ...over,
});
const photo = (id: string): HistoryPhoto => ({
  id,
  storage_path: `jobs/t1/${id}.jpg`,
  file_name: null,
  role: "before",
  repair_id: null,
  item_key: null,
  taken_at: null,
  created_at: "2026-11-10T15:00:00.000Z",
  annotations: null,
  url: null,
});
const ticket = (
  over: Record<string, unknown> = {},
  photos: HistoryPhoto[] = [],
): SiteHistoryTicket => ({
  ...historyTicketSchema.parse(fromDb(over)),
  photos,
});
const note = (over: Record<string, unknown> = {}) => ({
  id: 41,
  method: "comment",
  note: "Ladder access is on the east wall.",
  by_name: "Dana Office",
  at: "2026-11-10T15:00:00.000Z",
  ...over,
});

describe("the checkbox on an Activity entry", () => {
  it("is called what the owner called it", () => {
    expect(TECH_VISIBLE_LABEL).toBe("Viewable to technicians");
  });

  it("sits on the entries a person makes, not on the site's own lines", () => {
    for (const m of ["called", "texted", "emailed", "visited", "other", "comment"])
      expect(canBeTechVisible(m)).toBe(true);
    expect(canBeTechVisible("note")).toBe(false);
    expect(canBeTechVisible("service")).toBe(false);
  });

  it("the office is shown it; a technician-only login is not", () => {
    expect(choosesTechVisible(OFFICE)).toBe(true);
    expect(choosesTechVisible(MANAGER_TECH)).toBe(true);
    expect(choosesTechVisible(TECH_ONLY)).toBe(false);
    expect(choosesTechVisible(null)).toBe(false);
  });

  it("the office's entry is saved as its checkbox stood: off unless ticked", () => {
    const save = (ticked: boolean | undefined) =>
      techVisibleOnSave({ profile: OFFICE, kind: "ticket", method: "comment", ticked });
    expect(save(undefined)).toBe(false);
    expect(save(false)).toBe(false);
    expect(save(true)).toBe(true);
  });

  it("what a technician writes is for technicians, whatever is sent", () => {
    for (const ticked of [undefined, false, true])
      expect(
        techVisibleOnSave({ profile: TECH_ONLY, kind: "ticket", method: "comment", ticked }),
      ).toBe(true);
  });

  it("never on an opportunity, never on the close-out's summary", () => {
    expect(
      techVisibleOnSave({ profile: OFFICE, kind: "opportunity", method: "comment", ticked: true }),
    ).toBe(false);
    expect(
      techVisibleOnSave({ profile: TECH_ONLY, kind: "ticket", method: "service", ticked: true }),
    ).toBe(false);
  });

  it("the server saves it by that rule and offers the tick on an entry already written", () => {
    const fn = read("src/lib/contact-log.functions.ts");
    expect(fn).toContain("tech_visible: z.boolean().optional(),");
    expect(fn).toContain("tech_visible: techVisibleOnSave({");
    expect(fn).toContain("export const setContactTechVisible = createServerFn");
    expect(fn).toContain('.rpc("contact_log_set_tech_visible", {');
    // The writer's Technician tick is read with the rest of their profile.
    expect(fn).toContain('.select("role, access, technician, full_name, email")');
  });

  it("the composer shows it on a ticket, to the office, and clears it after a save", () => {
    const ui = read("src/components/crm/contact-log.tsx");
    expect(ui).toContain(
      'const asksTechVisible = kind === "ticket" && choosesTechVisible(profile);',
    );
    expect(ui).toContain('data-field="tech-visible"');
    expect(ui).toContain("{TECH_VISIBLE_LABEL}");
    expect(ui).toContain("...(asksTechVisible && techVisible ? { tech_visible: true } : {}),");
    expect(ui).toContain("setTechVisible(false);");
  });

  it("an Activity row carries its tick; a ticked row and an unticked one are not grouped", () => {
    const row = (over: Partial<ContactLogRow>): ContactLogRow => ({
      id: 1,
      kind: "ticket",
      item_id: "job",
      method: "called",
      note: null,
      by_user: "u1",
      by_name: "Dana Office",
      at: "2026-11-10T15:00:00.000Z",
      tech_visible: false,
      ...over,
    });
    expect(contactEntry(row({ id: 7, tech_visible: true })).share).toEqual({ id: 7, on: true });
    expect(contactEntry(row({ id: 8 })).share).toEqual({ id: 8, on: false });
    expect(contactEntry(row({ method: "service" })).share).toBeUndefined();
    expect(contactEntry(row({ method: "note" })).share).toBeUndefined();
    // Two bare "Called" rows by one person look alike and group; not when one is ticked.
    const a = contactEntry(row({ id: 1 }));
    const b = contactEntry(row({ id: 2, at: "2026-11-10T14:00:00.000Z" }));
    expect(groupTimeline([a, b])).toHaveLength(1);
    const c = contactEntry(row({ id: 3, at: "2026-11-10T14:00:00.000Z", tech_visible: true }));
    expect(groupTimeline([a, c])).toHaveLength(2);
  });

  it("the Activity list shows the office a checkbox per entry, and a technician none", () => {
    const ui = read("src/components/service/ticket-activity.tsx");
    expect(ui).toContain(
      "onShare={choosesTechVisible(profile) ? (id, on) => share.mutate({ id, on }) : undefined}",
    );
    expect(ui).toContain("{onShare && r.share && r.count === 1 && (");
    expect(ui).toContain("data-share={r.share.id}");
    expect(ui).toContain("{TECH_VISIBLE_LABEL}");
  });

  it("the database: off by default, the office's to change, one column and no other", () => {
    const sql = read("supabase/migrations/20261117190000_history_popup_tech_visible.sql");
    expect(sql).toContain("add column if not exists tech_visible boolean not null default false;");
    expect(sql).toContain(
      "create or replace function public.contact_log_set_tech_visible(p_id bigint, p_on boolean)",
    );
    expect(sql).toContain("if not (public.is_admin() or public.is_manager()");
    expect(sql).toContain("or (public.has_access('service') and not public.is_technician())) then");
    expect(sql).toContain("set tech_visible = p_on");
    expect(sql).toContain("and l.kind = 'ticket'");
    expect(sql).toContain("and l.method not in ('note', 'service')");
    expect(sql).toContain(
      "revoke all on function public.contact_log_set_tech_visible(bigint, boolean) from public, anon;",
    );
    // The history hands over the ticked entries only.
    expect(sql).toContain("where l.kind = 'ticket' and l.item_id = j.id and l.tech_visible");
    expect(sql).toContain("'inspection_notes', nullif(trim(j.inspection->>'notes'), ''),");
    // Who may ask is as it was, and nothing about money is handed over.
    expect(sql).toContain("if not public.site_history_allowed(p_job_id) then");
    const fn = sql.slice(sql.indexOf("create or replace function public.site_history"));
    expect(fn).not.toMatch(/bill_rate|amount|invoice|price|cost/i);
  });
});

describe("what the database hands the history", () => {
  it("a history made before this change still reads", () => {
    const [t] = siteHistorySchema.parse([fromDb()]);
    expect(t!.shared_notes).toEqual([]);
    expect(t!.inspection_notes).toBeNull();
  });

  it("the ticked entries and the inspection's notes come through", () => {
    const [t] = siteHistorySchema.parse([
      fromDb({
        inspection_notes: "Ponding by the north drain.",
        shared_notes: [note(), note({ id: 42, method: "called", note: null })],
      }),
    ]);
    expect(t!.inspection_notes).toBe("Ponding by the north drain.");
    expect(t!.shared_notes.map((n) => n.id)).toEqual([41, 42]);
  });

  it("the earlier ticket's Special instructions are not handed over, nor read if they were", () => {
    const sql = read(
      "supabase/migrations/20261117210000_history_timeline_no_special_instructions.sql",
    );
    const fn = sql.slice(sql.indexOf("create or replace function public.site_history"));
    expect(fn).not.toContain("special_instructions");
    expect(fn).not.toContain("j.notes");
    // The rest stands: the ticked entries, who may ask, every photo but the signature, no money.
    expect(fn).toContain("where l.kind = 'ticket' and l.item_id = j.id and l.tech_visible");
    expect(fn).toContain("if not public.site_history_allowed(p_job_id) then");
    expect(fn).toContain(
      "where ph.service_job_id = j.id and ph.role <> 'signature'), '[]'::jsonb)",
    );
    expect(fn).not.toMatch(/bill_rate|amount|invoice|price|cost/i);
    // A JSON that still carried the key (an older database) loses it at the door.
    const [t] = siteHistorySchema.parse([fromDb({ special_instructions: "Park in back." })]);
    expect(Object.keys(t!)).not.toContain("special_instructions");
  });
});

describe("the timeline", () => {
  it("lists what the inspection flagged, each with its note", () => {
    const t = ticket({
      inspection_items: [
        { id: "a", label: "Membrane condition", status: "issue", note: " Blisters near the curb " },
        { id: "b", label: "Drains", status: "ok", note: null },
        { id: "c", label: "Perimeter flashings", status: "issue", note: null },
      ],
    });
    expect(flaggedHistoryItems(t)).toEqual([
      { key: "a", label: "Membrane condition", note: "Blisters near the curb" },
      { key: "c", label: "Perimeter flashings", note: "" },
    ]);
  });

  it("a shared Activity entry is worded as the ticket's own Activity words it", () => {
    expect(historyNoteLabel("comment")).toBe("Note");
    expect(historyNoteLabel("called")).toBe("Called");
    expect(historyNoteLabel("texted")).toBe("Texted");
    expect(historyNoteLabel("emailed")).toBe("Emailed");
    expect(historyNoteLabel("visited")).toBe("Visited");
    expect(historyNoteLabel("other")).toBe("Contact");
  });

  it("is one list with a line down its side and a dot per earlier ticket", () => {
    const src = read("src/components/service/site-history.tsx");
    expect(src).toContain('data-history="timeline"');
    expect(src).toMatch(/className="ml-1\.5 space-y-4 border-l"/);
    expect(src).toContain("rounded-full border-2 border-background bg-primary");
  });

  it("each ticket shows what was found, the repairs, the closing notes and its ticked entries", () => {
    const src = read("src/components/service/site-history.tsx");
    const row = src.slice(
      src.indexOf("function HistoryRow({"),
      src.indexOf("function HistoryPhotos({"),
    );
    for (const part of ["found", "inspection-notes", "repairs", "closing-notes"])
      expect(row).toContain(`data-history="${part}"`);
    // Nov 18: the ticked entries are drawn by SharedNotesList (ticket-shared-notes.tsx), which
    // this ticket's own entries use too. The words and the marks are as they were.
    expect(row).toContain('<SharedNotesList notes={ticket.shared_notes} where="shared-notes" />');
    const list = read("src/components/service/ticket-shared-notes.tsx");
    expect(list).toContain("data-history={where}");
    expect(row).toContain("Found on the inspection");
    expect(row).toContain("What was wrong: ");
    expect(row).toContain("What was done: ");
    expect(row).toContain("Closing notes: ");
    expect(list).toContain("{historyNoteLabel(n.method)}");
    expect(list).toContain("· {whenShort(n.at)}");
    // Not the photos (they are behind the tap), and never the Special instructions.
    expect(row).not.toContain("<PhotoGrid");
    expect(src).not.toContain("special_instructions");
    expect(src).not.toContain("Special instructions</p>");
  });

  it("the ticket's line is the button, and says how many photos are behind it", () => {
    expect(historyPhotosHint(ticket())).toBe("no photos");
    expect(historyPhotosHint(ticket({}, [photo("p1")]))).toBe("1 photo");
    expect(historyPhotosHint(ticket({}, [photo("p1"), photo("p2")]))).toBe("2 photos");
    const src = read("src/components/service/site-history.tsx");
    const row = src.slice(
      src.indexOf("function HistoryRow({"),
      src.indexOf("function HistoryPhotos({"),
    );
    expect(row).toContain('data-history="row"');
    expect(row).toContain('aria-haspopup="dialog"');
    expect(row).toContain("setOpen(true);");
    expect(row).toContain("{historyPhotosHint(ticket)}");
  });
});

describe("the ticket's photos", () => {
  it("the pop-up shows the photos and nothing else of the ticket", () => {
    const src = read("src/components/service/site-history.tsx");
    const pop = src.slice(src.indexOf("function HistoryPhotos({"), src.indexOf("// ── The photos"));
    expect(pop).toContain("data-history-photos={ticket.id}");
    expect(pop).toContain("<PhotoGrid ticket={ticket} photos={ticket.photos} refresh={refresh} />");
    for (const gone of [
      "closing_notes",
      "ticket.repairs",
      "shared_notes",
      "inspection_notes",
      "description",
    ])
      expect(pop).not.toContain(gone);
    expect(pop).toContain("data-history-close");
  });

  it("says so when there is no photo", () => {
    expect(HISTORY_NO_PHOTOS).toBe("No photos were taken on this ticket.");
    const src = read("src/components/service/site-history.tsx");
    expect(src).toContain("{HISTORY_NO_PHOTOS}");
  });

  it("Open the ticket is offered only to someone who can open it", () => {
    const src = read("src/components/service/site-history.tsx");
    const pop = src.slice(src.indexOf("function HistoryPhotos({"), src.indexOf("// ── The photos"));
    expect(pop).toMatch(/\{canOpen && \(\s*<Button asChild/);
    expect(pop).toContain("Open the ticket");
    expect(src).toContain("const canOpen = !!profile && !isFieldOnly(profile);");
  });
});

/**
 * Owner, Nov 17, with a picture of the whole ticket page a technician landed on after tapping
 * the history line: "this is what the tech sees when they click the previous tickets at this
 * location button id really just like them to see the 'history at this property' part not the
 * aerial, materials, etc. since theyre already seeing that in the ticket workflow".
 */
describe("the History here line opens the history on its own", () => {
  const src = read("src/components/service/site-history.tsx");
  const link = src.slice(
    src.indexOf("export function HistoryLink({"),
    src.indexOf("function HistoryTimeline({"),
  );

  it("is a button, not a link to the ticket page", () => {
    // (Nov 18: the workflow draws it as a short row, PeekRow, which is a button too.)
    expect(link).toContain('<button\n          type="button"');
    expect(link).toContain("<PeekRow");
    expect(link).toContain('aria-haspopup="dialog"');
    expect(link).toContain("onClick={() => setOpen(true)}");
    expect(link).not.toContain("<Link");
    expect(link).not.toContain("HISTORY_OPEN_PARAM");
    expect(link).not.toContain('to="/service"');
  });

  it("the pop-up holds the timeline and Close, and nothing else of the ticket", () => {
    expect(link).toContain("data-history-dialog={jobId}");
    // Nov 18: the pop-up also asks for THIS ticket's ticked Activity entries (withActivity;
    // ticket-shared-notes.test.tsx). The whole Activity block, with its buttons, stays out.
    expect(link).toContain(
      "<HistoryTimeline jobId={jobId} locationId={locationId} enabled withActivity />",
    );
    expect(link).toContain("data-history-dialog-close");
    expect(link).toContain("{historyFoldTitle(count)}");
    for (const gone of [
      "Aerial",
      "Materials",
      "TicketActivity",
      "Special instructions",
      "Photos & repairs",
    ])
      expect(link).not.toContain(gone);
  });

  it("the ticket page's fold and the pop-up draw the same timeline", () => {
    expect(src).toContain(
      "<HistoryTimeline jobId={job.id} locationId={job.location_id} enabled={open} />",
    );
    expect(src.split("function HistoryTimeline(").length - 1).toBe(1);
    expect(src.split('data-history="timeline"').length - 1).toBe(1);
  });

  it("My tickets and the close-out both use it", () => {
    expect(read("src/components/service/today-page.tsx")).toContain(
      '<HistoryLink jobId={j.id} whenNone="hide" summary={j.history} />',
    );
    expect(read("src/components/service/closeout.tsx")).toContain(
      // (Nov 18: as one short row there, `compact`; closeout-top-nov18.test.tsx.)
      '<HistoryLink jobId={job.id} whenNone="say" compact />',
    );
  });
});
