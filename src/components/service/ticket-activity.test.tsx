/**
 * The ticket's Activity block (owner, Oct 27): the contact buttons at the top, ONE note box, the
 * "N entries" line and the merged list in a capped, scrolling box — rendered to a string
 * (react-dom/server) with the two queries' data seeded in the cache, so the markup is the real
 * thing. The fifth button is Note on a ticket, Comment on an opportunity (both kinds rendered). The server side
 * is pinned: the note saves as a contact-log comment, whose @mentions go through sendMentions.
 */
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({
    session: { user: { id: "u1" } },
    profile: { id: "u1", role: "admin", access: [], full_name: "Dana Office", email: "d@x" },
    can: () => true,
  }),
}));

import type { ContactLogRow } from "@/lib/contact-log.functions";
import type { JobEventRow } from "@/lib/service-field.functions";
import { LogContactButtons } from "@/components/crm/contact-log";
import { ActivityList, TicketActivity } from "./ticket-activity";

const JOB = "11111111-1111-4111-8111-111111111111";
const read = (p: string) => readFileSync(p, "utf8");
const buttons = (html: string) => html.match(/<button\b[^>]*>/g) ?? [];
const labels = (html: string) =>
  buttons(html).map((b) => /aria-label="([^"]*)"/.exec(b)?.[1] ?? "");

const contacts: ContactLogRow[] = [
  {
    id: 2,
    kind: "ticket",
    item_id: JOB,
    method: "comment",
    note: "Gate code is 4411",
    by_user: "u2",
    by_name: "Bob Tech",
    at: "2026-10-22T09:30:00+00:00",
  },
  {
    id: 1,
    kind: "ticket",
    item_id: JOB,
    method: "called",
    note: "Left a voicemail",
    by_user: "u1",
    by_name: "Dana Office",
    at: "2026-10-20T14:00:00+00:00",
  },
];
const events: JobEventRow[] = [
  // The database's copy of the call: dropped by the merge.
  {
    id: 12,
    service_job_id: JOB,
    kind: "contact",
    stage: null,
    field_status: null,
    note: "Left a voicemail",
    by_user: "u1",
    by_name: "Dana Office",
    at: "2026-10-20T14:00:00+00:00",
    meta: { method: "called" },
  },
  {
    id: 11,
    service_job_id: JOB,
    kind: "note",
    stage: null,
    field_status: null,
    note: "Date moved from Oct 3, 2026 to Oct 10, 2026",
    by_user: "u1",
    by_name: "Dana Office",
    at: "2026-10-21T12:00:00+00:00",
    meta: { date_from: "2026-10-03", date_to: "2026-10-10" },
  },
  {
    id: 10,
    service_job_id: JOB,
    kind: "stage",
    stage: "open",
    field_status: null,
    note: null,
    by_user: "u1",
    by_name: "Dana Office",
    at: "2026-10-19T08:00:00+00:00",
    meta: null,
  },
];

function render(node: React.ReactElement, seed = true) {
  const qc = new QueryClient();
  if (seed) {
    qc.setQueryData(["contact-log", "ticket", JOB], contacts);
    qc.setQueryData(["service-job-events", JOB], events);
  }
  return renderToString(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("TicketActivity", () => {
  const html = render(<TicketActivity jobId={JOB} />);
  it('is the "Activity" block: heading and aria-label, the five buttons at the top (Note is the fifth), no separate box', () => {
    expect(html).toContain('aria-label="Activity"');
    expect(html).toMatch(
      /<p class="[^"]*font-medium[^"]*"><svg[^>]*lucide-history[^]*?<\/svg> Activity<\/p>/,
    );
    const names = labels(html);
    expect(names.slice(0, 5)).toEqual(["Called", "Texted", "Emailed", "Visited", "Note"]);
    expect(names).not.toContain("Comment");
    expect(html).not.toContain("Timeline");
  });
  it("owner, Oct 28: no separate note box — the note field opens from a button, like a contact", () => {
    // Nothing picked yet: no textarea on the page (the old block always rendered one).
    expect(html.match(/<textarea\b/g)).toBeNull();
    expect(html).not.toContain("Add note");
    expect(html).not.toContain('data-box="activity-note"');
    // The Note button carries the @ hint, as the contact buttons' shared note field does.
    expect(html).toContain('title="Note: write a note on the activity (type @ to tell someone)"');
  });
  it("lists the merged stream newest first, the copied contact dropped, with a count line", () => {
    expect(html).toContain('data-line="activity-count"');
    expect(html).toContain(">4 entries<");
    const order = [
      "Note",
      "Date moved from Oct 3, 2026 to Oct 10, 2026",
      "Called",
      "Stage: Open",
    ].map((s) => {
      const i = html.indexOf(`<span class="font-medium">${s}</span>`);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    });
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]!);
    expect(html.match(/<li\b/g)).toHaveLength(4);
    expect(html).toContain("Gate code is 4411");
    expect(html).toContain("Bob Tech");
  });
  it("caps the list at about eight rows and scrolls inside its own bordered box (dark too)", () => {
    const list = /<ol class="([^"]*)" data-list="activity">/.exec(html)?.[1] ?? "";
    expect(list).toContain("max-h-[10.75rem]");
    expect(list).toContain("overflow-y-auto");
    expect(list).toMatch(/\brounded-md\b/);
    expect(list).toMatch(/\bborder\b/);
    expect(list).toMatch(/dark:/);
    // The count line sits above the box, so it reads without scrolling.
    expect(html.indexOf('data-line="activity-count"')).toBeLessThan(
      html.indexOf('data-list="activity"'),
    );
  });
  it("says 'No activity yet' for nothing, and loads quietly", () => {
    expect(renderToString(<ActivityList entries={[]} />)).toContain("No activity yet");
    expect(renderToString(<ActivityList entries={null} loading />)).toContain(
      "Loading the activity…",
    );
    expect(renderToString(<ActivityList entries={null} error={new Error("boom")} />)).toContain(
      "Could not load the activity: <!-- -->boom",
    );
  });
});

describe("LogContactButtons: the fifth button reads Note on a ticket, Comment elsewhere (kind decides)", () => {
  it("a ticket: Called / Texted / Emailed / Visited / Note", () => {
    const html = render(<LogContactButtons kind="ticket" itemId={JOB} />, false);
    expect(labels(html)).toEqual(["Called", "Texted", "Emailed", "Visited", "Note"]);
  });
  it("an opportunity: … and Comment", () => {
    const html = render(<LogContactButtons kind="opportunity" itemId={JOB} />, false);
    expect(labels(html)).toEqual(["Called", "Texted", "Emailed", "Visited", "Comment"]);
  });
});

describe("the page and the server side", () => {
  it("the ticket form renders the block (for the office, a technician and the field page alike)", () => {
    const page = read("src/components/service-page.tsx");
    expect(page).toContain("const customerContact = job && <TicketActivity jobId={job.id} />;");
    expect(page.match(/\{customerContact\}/g)).toHaveLength(3);
    expect(page).not.toContain('aria-label="Timeline"');
    expect(page).not.toContain("<ContactLogList");
    expect(page).not.toContain("<LogContactButtons");
  });
  it("the note saves as a contact-log comment (logContact), the path every viewer of the block already had; its mentions go through sendMentions", () => {
    // Owner, Oct 28: the note is the Note button of the contact buttons (crm/contact-log.tsx),
    // which saves through logContact with method "comment" — no box of its own here.
    const src = read("src/components/service/ticket-activity.tsx");
    expect(src).not.toContain("useServerFn(addJobNote)");
    expect(src).not.toContain("MentionTextarea");
    expect(src).toContain('<LogContactButtons kind="ticket" itemId={jobId} />');
    const log = read("src/components/crm/contact-log.tsx");
    expect(log).toContain("const logFn = useServerFn(logContact);");
    expect(log).toContain("onClick={() => setPicked(isComment ? null : COMMENT_METHOD)}");
    const fns = read("src/lib/contact-log.functions.ts");
    const handler = fns.slice(
      fns.indexOf("export const logContact"),
      fns.indexOf("export const listContactLog"),
    );
    expect(handler).toContain(
      "if (data.method === COMMENT_METHOD && !data.note) throw new Error(COMMENT_NEEDS_TEXT);",
    );
    expect(handler).toContain('if (data.note?.includes("@")) {');
    expect(handler).toContain("mentions = await sendMentions(context, {");
    expect(handler).toContain("return { ...row, ...mentions, hold: null };");
  });
});
