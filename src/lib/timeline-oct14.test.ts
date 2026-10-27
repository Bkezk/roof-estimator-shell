/**
 * The Contact box is a timeline (owner, Oct 14: "I kind of want this box to be a timeline for
 * both opps and service, so I'd like a comment button, and I'd like it to log and show when
 * service is completed and a brief summary there as well"). Fails on the old code: no Comment,
 * no "service" rows, the boxes titled Contact / Customer contact, the ticket's one-line latest
 * contact instead of the list.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  COMMENT_METHOD,
  COMMENT_NEEDS_TEXT,
  contactMethodLabel,
  SERVICE_DONE_METHOD,
} from "@/lib/contact-log.functions";
import {
  SERVICE_DONE_NOTES_MAX,
  serviceDoneForOpportunity,
  serviceDoneSummary,
} from "@/lib/service-done-summary";

const read = (p: string) => readFileSync(p, "utf8");

describe("serviceDoneSummary: the brief line", () => {
  it("who, how many repairs (named), the hours, then the closing notes", () => {
    expect(
      serviceDoneSummary({
        by: "Braden Keck",
        closingNotes: "Resealed the drain and the seam over the office.",
        repairNames: ["Drain leak", "Seam"],
        hours: 3.25,
      }),
    ).toBe(
      "Service completed by Braden Keck · 2 repairs (Drain leak, Seam) · 3.25 h — Resealed the drain and the seam over the office.",
    );
  });
  it("each part is left out when there is nothing for it", () => {
    expect(serviceDoneSummary({ by: null, closingNotes: null, repairNames: [], hours: 0 })).toBe(
      "Service completed",
    );
    expect(serviceDoneSummary({ by: " ", closingNotes: "  ", repairNames: [" "], hours: 1 })).toBe(
      "Service completed · 1 h",
    );
    expect(
      serviceDoneSummary({ by: "Ann", closingNotes: null, repairNames: ["One"], hours: 0 }),
    ).toBe("Service completed by Ann · 1 repair (One)");
  });
  it("more than three repairs are counted and the first three named; long notes are cut", () => {
    const s = serviceDoneSummary({
      by: "Ann",
      closingNotes: "x".repeat(400),
      repairNames: ["A", "B", "C", "D", "E"],
      hours: 0,
    });
    expect(s).toContain("5 repairs (A, B, C, …)");
    expect(s.length).toBeLessThanOrEqual(
      "Service completed by Ann · 5 repairs (A, B, C, …) — ".length + SERVICE_DONE_NOTES_MAX,
    );
    expect(s.endsWith("…")).toBe(true);
    // Newlines in the notes become spaces on the one line.
    expect(
      serviceDoneSummary({ by: null, closingNotes: "a\n\nb", repairNames: [], hours: 0 }),
    ).toBe("Service completed — a b");
  });
  it("on the opportunity the line names the ticket", () => {
    expect(serviceDoneForOpportunity(6014, "Bell County ", "Service completed by Ann")).toBe(
      "Ticket #6014 Bell County: Service completed by Ann",
    );
  });
});

describe("the two timeline methods", () => {
  it("labels: Comment and Service done; the old ones unchanged", () => {
    expect(COMMENT_METHOD).toBe("comment");
    expect(SERVICE_DONE_METHOD).toBe("service");
    expect(contactMethodLabel("comment")).toBe("Comment");
    expect(contactMethodLabel("service")).toBe("Service done");
    expect(contactMethodLabel("note")).toBe("Note");
    expect(contactMethodLabel("called")).toBe("Called");
  });
  it("logContact takes a comment, and a comment needs its text; a comment is never a contact", () => {
    const fns = read("src/lib/contact-log.functions.ts");
    expect(fns).toContain("method: z.enum([...CONTACT_METHODS, COMMENT_METHOD]),");
    expect(fns).toContain(
      "if (data.method === COMMENT_METHOD && !data.note) throw new Error(COMMENT_NEEDS_TEXT);",
    );
    expect(COMMENT_NEEDS_TEXT).toBe("Write the comment first.");
  });
  it("migration 20261015090000: both methods allowed, and the trigger stamps nothing for them", () => {
    const sql = read("supabase/migrations/20261015090000_timeline_comments_service.sql");
    expect(sql).toContain(
      "check (method in ('called','texted','emailed','visited','other','note','comment','service'));",
    );
    expect(sql).toContain("if new.method in ('note', 'comment', 'service') then");
    expect(sql.indexOf("if new.method in ('note', 'comment', 'service') then")).toBeLessThan(
      sql.indexOf("update public.service_jobs set contacted_at"),
    );
  });
});

describe("the close-out writes Service done on the ticket and its opportunity", () => {
  const fns = read("src/lib/service-field.functions.ts");
  it("once, at the first close-out, after the ticket row is updated; a problem is logged, never fatal", () => {
    expect(fns).toContain('if (data.to === "done" && !job.completed_at && row.completed_at) {');
    expect(fns).toContain("await logServiceDone(sb, row, who, context.userId);");
    expect(fns).toContain("the Service done timeline row was not written");
    expect(fns.indexOf("await logServiceDone(")).toBeGreaterThan(
      fns.indexOf(".update({ ...patch, updated_by_name: who })"),
    );
  });
  it("the rows: the ticket's summary, and the opportunity's naming the ticket", () => {
    const body = fns.slice(
      fns.indexOf("async function logServiceDone("),
      fns.indexOf("export const listTimeEntries"),
    );
    expect(body).toContain('sb.from("service_job_repairs").select("name, sort")');
    expect(body).toContain('sb.from("service_time_entries").select("hours")');
    expect(body).toContain(
      "const base = { method: SERVICE_DONE_METHOD, by_user: userId, by_name: by };",
    );
    expect(body).toContain('{ ...base, kind: "ticket", item_id: job.id, note: summary },');
    expect(body).toContain("...(job.from_opportunity_id");
    expect(body).toContain(
      "note: serviceDoneForOpportunity(job.number, job.customer_name, summary),",
    );
    expect(body).toContain('sb.from("crm_contact_log").insert(rows)');
  });
});

describe("the boxes", () => {
  const log = read("src/components/crm/contact-log.tsx");
  it("a Comment button beside Called / Texted / Emailed / Visited; its note is required; no hold for a comment", () => {
    expect(log).toContain('aria-label={isComment ? "Comment (picked)" : "Comment"}');
    expect(log).toContain("onClick={() => setPicked(isComment ? null : COMMENT_METHOD)}");
    expect(log).toContain("if (isComment && !note.trim()) return;");
    expect(log).toContain("disabled={log.isPending || !holdReady || (isComment && !note.trim())}");
    expect(log).toContain("{!isComment && (");
    expect(log).toContain('? "Comment added"');
  });
  it("the list is the timeline: a Service done row stands out; the empty text says timeline", () => {
    expect(log).toContain('data-list="timeline"');
    expect(log).toContain("const done = r.method === SERVICE_DONE_METHOD;");
    expect(log).toContain("Nothing on the timeline yet");
    expect(log).not.toContain("No contact logged yet");
  });
  it("Timeline on the opportunity and on the ticket (the ticket shows the whole list, not one line); the events box is the Activity log", () => {
    const opp = read("src/components/opportunities-page.tsx");
    expect(opp).toContain('aria-label="Timeline"');
    expect(opp).toContain('<History className="h-3.5 w-3.5 text-muted-foreground" /> Timeline');
    expect(opp).not.toContain('aria-label="Contact"');
    const svc = read("src/components/service-page.tsx");
    expect(svc).toContain('aria-label="Timeline"');
    expect(svc).toContain('<ContactLogList kind="ticket" itemId={job.id} />');
    expect(svc).not.toContain("<LatestContact");
    expect(svc).not.toContain("Customer contact");
    const sections = read("src/components/service/ticket-field-sections.tsx");
    // Oct 27: the Activity log is a tab of the Work fold.
    expect(sections).toMatch(/<TabsTrigger value="timeline"[^>]*>[\s\S]*?Activity log/);
  });
});
