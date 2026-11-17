/**
 * Owner, Nov 17, with a picture of the history a technician-only login sees: a date, a
 * description and "Outcome: Repair ticket". "its honestly not very useful. what would be useful
 * for the techs would be something that shows history as far as the previous tickets tech notes
 * and photos".
 *
 * The photos were already there, every one, when the earlier ticket had any. What was missing:
 * what the inspection flagged (handed over, never shown), the inspection's notes, and what a
 * technician typed in that ticket's Activity (never handed over). And a row with nothing in it
 * said nothing, so it read as a page that had not loaded.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  HISTORY_ROW_EMPTY,
  flaggedHistoryItems,
  historyNoteHead,
  historyRowIsEmpty,
  historyTicketSchema,
  siteHistorySchema,
  type SiteHistoryTicket,
} from "@/lib/service-history";

const read = (p: string) => readFileSync(p, "utf8");
const TODAY = new Date(2026, 10, 17);

/** An earlier ticket as the database hands it over. */
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
const ticket = (over: Record<string, unknown> = {}): SiteHistoryTicket => ({
  ...historyTicketSchema.parse(fromDb(over)),
  photos: [],
});

describe("what the database hands over", () => {
  it("a history made before this change still reads: no notes, no inspection notes", () => {
    const [t] = siteHistorySchema.parse([fromDb()]);
    expect(t!.tech_notes).toEqual([]);
    expect(t!.inspection_notes).toBeNull();
  });

  it("the technician's notes and the inspection's notes come through", () => {
    const [t] = siteHistorySchema.parse([
      fromDb({
        inspection_notes: "Ponding by the north drain.",
        tech_notes: [
          {
            id: 41,
            method: "comment",
            note: "Ladder access is on the east wall.",
            by_name: "Ted Tech",
            at: "2026-11-10T15:00:00.000Z",
          },
          {
            id: 42,
            method: "called",
            note: "Manager has the roof key.",
            by_name: null,
            at: "2026-11-10T15:30:00.000Z",
          },
        ],
      }),
    ]);
    expect(t!.inspection_notes).toBe("Ponding by the north drain.");
    expect(t!.tech_notes.map((n) => n.note)).toEqual([
      "Ladder access is on the east wall.",
      "Manager has the roof key.",
    ]);
  });

  it("the function hands over technicians' notes only, and neither the site's own lines nor the office's", () => {
    const sql = read("supabase/migrations/20261117170000_site_history_tech_notes.sql");
    expect(sql).toContain("'inspection_notes', nullif(trim(j.inspection->>'notes'), ''),");
    expect(sql).toContain("'tech_notes', coalesce((");
    expect(sql).toContain("where l.kind = 'ticket' and l.item_id = j.id");
    // Not the lines the site writes itself, nor the close-out's own summary.
    expect(sql).toContain("and l.method not in ('note', 'service')");
    expect(sql).toContain("and nullif(trim(l.note), '') is not null");
    // Written by a technician: ticked Technician, the ticket's technician, or on its crew.
    expect(sql).toContain("and (coalesce(w.technician, false)");
    expect(sql).toContain("or l.by_user = j.technician_id");
    expect(sql).toContain("where c.service_job_id = j.id and c.technician_id = l.by_user))");
    // Who may ask is as it was, and no price or invoice column is handed over.
    expect(sql).toContain("if not public.site_history_allowed(p_job_id) then");
    expect(sql).not.toMatch(/bill_rate|amount|invoice|price|cost/i);
    // Still every photo but the signature.
    expect(sql).toContain(
      "where ph.service_job_id = j.id and ph.role <> 'signature'), '[]'::jsonb)",
    );
  });
});

describe("what the row shows", () => {
  it("what the inspection flagged, each with its note; rows not flagged are left out", () => {
    const t = ticket({
      inspection_items: [
        { id: "a", label: "Membrane condition", status: "issue", note: " Blisters near the curb " },
        { id: "b", label: "Drains", status: "ok", note: null },
        { id: "c", label: "Perimeter flashings", status: "issue", note: null },
        { id: "d", label: "Skylights", status: null, note: "fine" },
      ],
    });
    expect(flaggedHistoryItems(t)).toEqual([
      { key: "a", label: "Membrane condition", note: "Blisters near the curb" },
      { key: "c", label: "Perimeter flashings", note: "" },
    ]);
  });

  it("a note says who wrote it and when, and Called and the like when it was one", () => {
    const n = { id: 1, note: "x", by_name: "Ted Tech", at: "2026-11-10T15:00:00.000Z" };
    expect(historyNoteHead({ ...n, method: "comment" }, TODAY)).toBe("Nov 10 · Ted Tech");
    expect(historyNoteHead({ ...n, method: "called" }, TODAY)).toBe("Nov 10 · Ted Tech · Called");
    expect(historyNoteHead({ ...n, method: "visited", by_name: null }, TODAY)).toBe(
      "Nov 10 · Visited",
    );
    // Another year says the year.
    expect(
      historyNoteHead({ ...n, method: "comment", at: "2025-06-12T15:00:00.000Z" }, TODAY),
    ).toBe("Jun 12, 2025 · Ted Tech");
  });

  it("a ticket with nothing written and no photo says so; anything written and it does not", () => {
    expect(HISTORY_ROW_EMPTY).toBe(
      "No notes were written and no photos were taken on this ticket.",
    );
    expect(historyRowIsEmpty(ticket())).toBe(true);
    expect(historyRowIsEmpty(ticket({ closing_notes: "   " }))).toBe(true);
    expect(historyRowIsEmpty(ticket({ closing_notes: "Patched" }))).toBe(false);
    expect(historyRowIsEmpty(ticket({ inspection_notes: "Ponding" }))).toBe(false);
    expect(
      historyRowIsEmpty(
        ticket({ inspection_items: [{ id: "a", label: "Drains", status: "issue", note: null }] }),
      ),
    ).toBe(false);
    expect(
      historyRowIsEmpty(
        ticket({
          tech_notes: [
            { id: 1, method: "comment", note: "x", by_name: null, at: "2026-11-10T15:00:00.000Z" },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      historyRowIsEmpty(
        ticket({
          repairs: [
            {
              id: "r",
              name: "Curb",
              problem_text: null,
              resolution_text: null,
              completed_on: null,
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("the screen shows them, in the row a technician reads", () => {
    const src = read("src/components/service/site-history.tsx");
    expect(src).toContain('data-history="found"');
    expect(src).toContain("Found on the inspection");
    expect(src).toContain('data-history="inspection-notes"');
    expect(src).toContain('data-history="tech-notes"');
    expect(src).toContain("Technician notes");
    expect(src).toContain("{historyNoteHead(n)}");
    expect(src).toContain('data-history="empty"');
    expect(src).toContain("{HISTORY_ROW_EMPTY}");
    // The close-out's notes say which notes they are.
    expect(src).toContain("Closing notes: ");
    // The photos are still every photo, with no cap.
    expect(src).toContain("<PhotoGrid ticket={ticket} photos={ticket.photos} refresh={refresh} />");
  });
});
