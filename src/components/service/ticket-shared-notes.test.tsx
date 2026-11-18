// @vitest-environment node
/**
 * This ticket's own ticked Activity entries, where a technician works the ticket (owner, Nov 18:
 * "but the activity list and timeline are on the history when you click it no?").
 *
 * They were not. History at this property lists EARLIER tickets, each with the entries the office
 * ticked "Viewable to technicians". The ticket being worked showed its own entries only on the
 * ticket page, and since Nov 18 a technician-only login works a ticket in the workflow and does
 * not open that page. A ticked note on the ticket in hand was on no screen of theirs.
 *
 *  rules    lib/tech-visible.ts: techVisibleEntries (ticked, a person's, newest first).
 *  screens  ticket-shared-notes.tsx: the box at the top of the workflow and of the pop-up.
 */
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const who = vi.hoisted(() => ({
  profile: { id: "u1", role: "admin", access: [] as string[], technician: false } as {
    id: string;
    role: string;
    access: string[];
    technician: boolean;
  },
}));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({ session: { user: { id: who.profile.id } }, profile: who.profile }),
}));

import type { ContactLogRow } from "@/lib/contact-log.functions";
import {
  TECH_VISIBLE_HELP,
  techVisibleEntries,
  THIS_TICKET_ACTIVITY_OFFICE,
  THIS_TICKET_ACTIVITY_TITLE,
} from "@/lib/tech-visible";
import { SharedNotesList, TicketSharedNotes } from "./ticket-shared-notes";

const JOB = "11111111-1111-4111-8111-111111111111";
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const row = (over: Partial<ContactLogRow>): ContactLogRow => ({
  id: 1,
  kind: "ticket",
  item_id: JOB,
  method: "comment",
  note: null,
  by_user: "u2",
  by_name: "Mark Office",
  at: "2026-11-18T14:00:00+00:00",
  tech_visible: false,
  ...over,
});
const rows: ContactLogRow[] = [
  row({ id: 1, method: "called", note: "Left a voicemail", tech_visible: false }),
  row({
    id: 2,
    method: "comment",
    note: "Gate code is 4471",
    tech_visible: true,
    at: "2026-11-17T09:00:00+00:00",
  }),
  row({
    id: 3,
    method: "called",
    note: "Ask for Dana at the desk",
    tech_visible: true,
    at: "2026-11-18T16:30:00+00:00",
  }),
  // The site's own line and the close-out's summary carry no tick, whatever the column says.
  row({ id: 4, method: "note", note: "Date moved", tech_visible: true }),
  row({ id: 5, method: "service", note: "Service done", tech_visible: true }),
];

function render(node: React.ReactElement, seed: ContactLogRow[] | null = rows) {
  const qc = new QueryClient();
  if (seed) qc.setQueryData(["contact-log", "ticket", JOB], seed);
  return renderToString(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("which of a ticket's entries a technician is shown", () => {
  it("the ticked ones a person made, newest first", () => {
    expect(techVisibleEntries(rows).map((r) => r.id)).toEqual([3, 2]);
  });
  it("an unticked entry is left out; so are the site's own lines and the close-out's summary", () => {
    const ids = techVisibleEntries(rows).map((r) => r.id);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(4);
    expect(ids).not.toContain(5);
  });
  it("nothing read yet, or nothing ticked, is an empty list", () => {
    expect(techVisibleEntries(undefined)).toEqual([]);
    expect(techVisibleEntries(null)).toEqual([]);
    expect(techVisibleEntries([row({ id: 9, tech_visible: false })])).toEqual([]);
  });
  it("the list handed in is not reordered", () => {
    const before = rows.map((r) => r.id);
    techVisibleEntries(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("the box of this ticket's entries", () => {
  it("lists the ticked entries with who and what, newest first, and no unticked one", () => {
    who.profile = { id: "t1", role: "user", access: ["service"], technician: true };
    const html = render(<TicketSharedNotes jobId={JOB} where="closeout" />);
    expect(html).toContain('data-this-ticket-activity="closeout"');
    expect(html).toContain(`aria-label="${THIS_TICKET_ACTIVITY_TITLE}"`);
    expect(html).toContain('data-history="this-ticket-notes"');
    expect(html).toContain("Gate code is 4471");
    expect(html).toContain("Ask for Dana at the desk");
    expect(html).toContain("Mark Office");
    expect(html.indexOf("Ask for Dana at the desk")).toBeLessThan(
      html.indexOf("Gate code is 4471"),
    );
    expect(html).not.toContain("Left a voicemail");
    expect(html).not.toContain("Date moved");
    expect(html).not.toContain("Service done");
  });
  it("a technician is not shown the office's line about the tick; the office is", () => {
    who.profile = { id: "t1", role: "user", access: ["service"], technician: true };
    expect(render(<TicketSharedNotes jobId={JOB} where="closeout" />)).not.toContain(
      "data-this-ticket-activity-office",
    );
    who.profile = { id: "u1", role: "admin", access: [], technician: false };
    const office = render(<TicketSharedNotes jobId={JOB} where="history" />);
    expect(office).toContain("data-this-ticket-activity-office");
    expect(office).toContain('data-this-ticket-activity="history"');
    expect(THIS_TICKET_ACTIVITY_OFFICE).toContain("Viewable to technicians");
  });
  it("draws nothing when the ticket has no ticked entry, and nothing before the read", () => {
    who.profile = { id: "t1", role: "user", access: ["service"], technician: true };
    expect(
      render(<TicketSharedNotes jobId={JOB} where="closeout" />, [row({ tech_visible: false })]),
    ).toBe("");
    expect(render(<TicketSharedNotes jobId={JOB} where="closeout" />, null)).toBe("");
  });
  it("an earlier ticket's entries and this ticket's are drawn by the same list", () => {
    const html = renderToString(
      <SharedNotesList
        where="shared-notes"
        notes={[{ id: "a", method: "texted", note: "On the way", by_name: null, at: rows[0]!.at }]}
      />,
    );
    expect(html).toContain('data-history="shared-notes"');
    expect(html).toContain("Texted");
    expect(html).toContain("On the way");
  });
});

describe("where the box is", () => {
  const closeout = flat(read("src/components/service/closeout.tsx"));
  const history = read("src/components/service/site-history.tsx");
  const box = read("src/components/service/ticket-shared-notes.tsx");

  it("at the top of the workflow, under the Special instructions", () => {
    const at = closeout.indexOf('<TicketSharedNotes jobId={job.id} where="closeout" />');
    expect(at).toBeGreaterThan(closeout.indexOf('<SpecialInstructionsBox where="closeout"'));
    expect(at).toBeLessThan(closeout.indexOf("<CloseoutForm key={job.id} job={job} />"));
  });
  it("at the top of the history's pop-up, under the Special instructions and above the earlier tickets", () => {
    const pop = history.slice(
      history.indexOf("function HistoryDialog({"),
      history.indexOf("function HistoryTimeline({"),
    );
    expect(pop).toContain(
      "<HistoryTimeline jobId={jobId} locationId={locationId} enabled withActivity />",
    );
    const body = flat(history.slice(history.indexOf("function HistoryTimeline({")));
    const at = body.indexOf(
      '{withActivity && ( <TicketSharedNotes jobId={jobId} where="history" enabled={enabled} className="mb-4" /> )}',
    );
    expect(at).toBeGreaterThan(body.indexOf("<InstructionsBox jobId={jobId} enabled={enabled} />"));
    expect(at).toBeLessThan(body.indexOf("{timeline} </>"));
  });
  it("not in the ticket page's fold: the whole Activity is on that page", () => {
    expect(history).toContain(
      "<HistoryTimeline jobId={job.id} locationId={job.location_id} enabled={open} />",
    );
    expect(history).toContain("withActivity = false,");
  });
  it("reads the Activity's own list, so a new entry refreshes both, and says so when it fails", () => {
    expect(box).toContain('queryKey: ["contact-log", "ticket", jobId],');
    expect(box).toContain('fn({ data: { kind: "ticket", item_id: jobId } })');
    expect(box).toContain("Could not load this ticket’s activity: {errText(q.error)}");
    expect(read("src/components/service/ticket-activity.tsx")).toContain(
      'const contactsKey = ["contact-log", "ticket", jobId];',
    );
  });
  it("the tick's own words say the technician on this ticket reads it too", () => {
    expect(TECH_VISIBLE_HELP).toBe(
      "Shows to the technician working this ticket, and under History at this property for technicians on later tickets here.",
    );
  });
});
