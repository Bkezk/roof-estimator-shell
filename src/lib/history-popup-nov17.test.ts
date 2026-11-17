/**
 * Owner, Nov 17, with a picture of a short history row: "when the tech clicks history at this
 * property i just want them to see this and then they can click the ticket and itll pop up its
 * photos and notes from the tickets and on the activity log have a check box that says viewable
 * to technicians and anything with that check box should also show".
 *
 * So: the list is short rows; a tap on a row opens that ticket's pop-up with every photo and the
 * ticket's notes; an Activity entry carries a "Viewable to technicians" tick, and a ticked one
 * shows in the pop-up.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { ContactLogRow } from "@/lib/contact-log.functions";
import {
  HISTORY_DETAIL_EMPTY,
  flaggedHistoryItems,
  historyDetailIsEmpty,
  historyHasNotes,
  historyNoteHead,
  historyRowHint,
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
    expect(sql).toContain("'special_instructions', nullif(trim(j.notes), ''),");
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
    expect(t!.special_instructions).toBeNull();
    expect(t!.inspection_notes).toBeNull();
  });

  it("the ticked entries, the special instructions and the inspection's notes come through", () => {
    const [t] = siteHistorySchema.parse([
      fromDb({
        special_instructions: "Park in back.",
        inspection_notes: "Ponding by the north drain.",
        shared_notes: [note(), note({ id: 42, method: "called", note: null })],
      }),
    ]);
    expect(t!.special_instructions).toBe("Park in back.");
    expect(t!.inspection_notes).toBe("Ponding by the north drain.");
    expect(t!.shared_notes.map((n) => n.id)).toEqual([41, 42]);
  });
});

describe("the short row", () => {
  it("lists what the inspection flagged, by name", () => {
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

  it("says what waits behind it", () => {
    expect(historyRowHint(ticket())).toBe("no photos or notes");
    expect(historyRowHint(ticket({}, [photo("p1")]))).toBe("1 photo");
    expect(historyRowHint(ticket({ closing_notes: "Patched" }, [photo("p1"), photo("p2")]))).toBe(
      "2 photos · notes",
    );
    expect(historyRowHint(ticket({ shared_notes: [note()] }))).toBe("notes");
    expect(historyRowHint(ticket({ special_instructions: "Park in back." }))).toBe("notes");
  });

  it("is short: no photos, repairs or notes in the row itself; the whole row opens the pop-up", () => {
    const src = read("src/components/service/site-history.tsx");
    const row = src.slice(
      src.indexOf("function HistoryRow({"),
      src.indexOf("function HistoryDetail({"),
    );
    expect(row).toContain('data-history="row"');
    expect(row).toContain('aria-haspopup="dialog"');
    expect(row).toContain("setOpen(true);");
    expect(row).toContain("Found on the inspection");
    expect(row).toContain("{historyRowHint(ticket)}");
    expect(row).not.toContain("<PhotoGrid");
    expect(row).not.toContain("closing_notes");
    expect(row).not.toContain("ticket.repairs");
    expect(row).not.toContain("shared_notes");
  });
});

describe("the ticket's pop-up", () => {
  it("knows a note when it sees one", () => {
    expect(historyHasNotes(ticket())).toBe(false);
    expect(historyHasNotes(ticket({ closing_notes: "  " }))).toBe(false);
    expect(historyHasNotes(ticket({ closing_notes: "Patched" }))).toBe(true);
    expect(historyHasNotes(ticket({ inspection_notes: "Ponding" }))).toBe(true);
    expect(
      historyHasNotes(
        ticket({
          repairs: [
            {
              id: "r",
              name: "Curb",
              problem_text: "Split seam",
              resolution_text: null,
              completed_on: null,
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      historyHasNotes(
        ticket({
          inspection_items: [{ id: "a", label: "Drains", status: "issue", note: "Clogged" }],
        }),
      ),
    ).toBe(true);
  });

  it("an entry from the Activity says who and when, and Called when it was one", () => {
    expect(historyNoteHead(note(), TODAY)).toBe("Nov 10 · Dana Office");
    expect(historyNoteHead(note({ method: "called" }), TODAY)).toBe(
      "Nov 10 · Dana Office · Called",
    );
    expect(historyNoteHead(note({ at: "2025-06-12T15:00:00.000Z" }), TODAY)).toBe(
      "Jun 12, 2025 · Dana Office",
    );
  });

  it("says so when the ticket has no photo and nothing written", () => {
    expect(HISTORY_DETAIL_EMPTY).toBe(
      "No photos were taken and no notes were written on this ticket.",
    );
    expect(historyDetailIsEmpty(ticket())).toBe(true);
    expect(historyDetailIsEmpty(ticket({}, [photo("p1")]))).toBe(false);
    expect(historyDetailIsEmpty(ticket({ shared_notes: [note()] }))).toBe(false);
    expect(
      historyDetailIsEmpty(
        ticket({ inspection_items: [{ id: "a", label: "Drains", status: "issue", note: null }] }),
      ),
    ).toBe(false);
  });

  it("shows every photo and every kind of note, and Open the ticket only to who may open it", () => {
    const src = read("src/components/service/site-history.tsx");
    const detail = src.slice(
      src.indexOf("function HistoryDetail({"),
      src.indexOf("// ── The photos"),
    );
    expect(detail).toContain(
      "<PhotoGrid ticket={ticket} photos={ticket.photos} refresh={refresh} />",
    );
    for (const part of [
      "special-instructions",
      "found",
      "inspection-notes",
      "repairs",
      "closing-notes",
      "shared-notes",
      "empty",
    ])
      expect(detail).toContain(`data-history="${part}"`);
    expect(detail).toContain("What was wrong: ");
    expect(detail).toContain("What was done: ");
    expect(detail).toContain("{historyNoteHead(n)}");
    expect(detail).toMatch(/\{canOpen && \(\s*<Button asChild/);
    expect(detail).toContain("Open the ticket");
    expect(detail).toContain("data-history-close");
  });
});
