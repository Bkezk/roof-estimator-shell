/**
 * The close-out screen as seven steps (owner, Oct 9; the rules are in closeout-steps.test.ts):
 * the strip under the header, the sections in step order (Time above Notes now), locked steps
 * as one muted line, the Complete bar gated to step 7, the "Nothing used" mark, the toast when
 * a step unlocks, and the crew box still the gate. Each pin fails on the one-scroll screen.
 * Later that day the step became the card (StepCard, the strip one line of dots, done steps
 * folded — closeout-layout-oct9.test.ts); the pins here describe that shape.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/service/closeout.tsx", "utf8");
const form = src.slice(src.indexOf("function CloseoutForm("), src.indexOf("// (b) Repairs"));
const at = (needle: string) => {
  const i = form.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
};

describe("the step strip", () => {
  it("sits first in the form: the headline, then the seven titles ticked / highlighted / locked", () => {
    expect(src).toContain('from "@/lib/closeout-steps"');
    expect(src).toContain("function StepStrip({");
    expect(form).toMatch(
      /<div className="space-y-5">\s*<StepStrip statuses=\{statuses\} open=\{open\} \/>/,
    );
    const strip = src.slice(
      src.indexOf("function StepStrip({"),
      src.indexOf("function StepCard({"),
    );
    expect(strip).toContain("{stepHeadline(open)}");
    expect(strip).toContain('aria-label="Close-out steps"');
    expect(strip).toContain('aria-current={status === "current" ? "step" : undefined}');
    expect(strip).toContain('disabled={status === "locked"}');
    // Done: a tick. Locked: a lock and the "what unlocks it" line. Current: the number (the full
    // list behind the chevron; the one-line dots are pinned in closeout-layout-oct9.test.ts).
    expect(strip).toMatch(/status === "done" \? \(\s*<CheckCircle2/);
    expect(strip).toMatch(/status === "locked" \? \(\s*<Lock/);
    expect(strip).toContain('{status === "locked" && (');
    expect(strip).toContain("{step.unlocks}");
    // Phone width: titles truncate, except the current one.
    expect(strip).toContain('className={status === "current" ? "block" : "block truncate"}');
  });
  it("the state is derived from the ticket, the reads, the materials and the Nothing used mark", () => {
    expect(form).toContain("const stepState: StepState = {");
    expect(form).toContain("crewAnswered: !waiting,");
    expect(form).toContain("serviceType: job.service_type,");
    expect(form).toContain("repairs: repairsQ.data ?? [],");
    expect(form).toContain("photos: photosQ.data ?? [],");
    expect(form).toContain("materialsTouched: (materialsQ.data ?? []).length > 0 || nothingUsed,");
    expect(form).toContain(
      "timeHours: (timeQ.data ?? []).reduce((sum, r) => sum + Number(r.hours), 0),",
    );
    expect(form).toContain("onSiteAt: job.on_site_at,");
    expect(form).toContain("closingNotes: draft.closing_notes,");
    expect(form).toContain("signaturePath: job.signature_path,");
    expect(form).toContain("const open = firstOpenStep(stepState);");
    expect(form).toMatch(/queryKey: fieldKeys\.materials\(job\.id\),[\s\S]*?staleTime: 30_000,/);
  });
});

describe("the sections in step order", () => {
  it("1 crew, 2 extras + repairs (before), 3 repairs (work), 4 materials + POs + Nothing used, 5 time, 6 notes, 7 signature, then Complete", () => {
    const order = [
      '{...card("crew")}',
      "<CrewBox job={job} embedded />",
      '{...card("before")}',
      "<TicketExtras job={job} canEdit />",
      'phase="before"',
      '{...card("work")}',
      'phase="work"',
      '{...card("materials")}',
      "<MaterialsSection jobId={job.id} />",
      "<PurchaseOrdersSection jobId={job.id} field />",
      "Nothing used on this ticket",
      '{...card("time")}',
      '<Section title="Time">',
      "<TimeEntries jobId={job.id} editable defaultHelpers={job.helper_count} />",
      '{...card("notes")}',
      '<Section title="Notes">',
      '{...card("signature")}',
      '<Section title="Signature">',
      "<SignatureSection job={job} />",
      'className="sticky bottom-0 z-10',
      "<AlertDialogTitle>Before you finish</AlertDialogTitle>",
    ];
    const positions = order.map(at);
    for (let i = 1; i < positions.length; i++)
      expect(positions[i], `${order[i - 1]} before ${order[i]}`).toBeGreaterThan(positions[i - 1]!);
    // Time is above Notes now (it used to follow it).
    expect(at('<Section title="Time">')).toBeLessThan(at('<Section title="Notes">'));
    // Every step is one card (StepCard; the per-step props come from card(id)).
    for (const id of ["crew", "before", "work", "materials", "time", "notes", "signature"])
      expect(form.match(new RegExp(`\\{\\.\\.\\.card\\("${id}"\\)\\}`, "g"))).toHaveLength(1);
    expect(form.match(/<StepCard/g)).toHaveLength(7);
  });
  it("a locked step is one muted line naming the step to finish; open ones are the card, the current one with the accent bar", () => {
    const slot = src.slice(
      src.indexOf("function StepCard({"),
      src.indexOf("function CloseoutForm("),
    );
    expect(slot).toMatch(/if \(status === "locked"\)\s*return \(\s*<p/);
    expect(slot).toContain("{lockedLine(open)}");
    expect(slot).toContain('<Lock className="h-4 w-4 shrink-0" />');
    expect(slot).toContain("{children}");
    // Owner, Oct 9 (later): the ring-offset frame around a Section card read as a box in a box;
    // the step is the card now, with a left accent bar while current.
    expect(slot).not.toContain("ring-offset-4");
    expect(slot).toMatch(/status === "current" \? "border-l-4 border-primary" : ""/);
    expect(slot).toMatch(/\{step\.n\} · \{step\.title\}/);
    expect(slot).toContain("id={stepAnchor(id)}");
  });
  it("the repairs section knows its step: the picker, Remove and quantity in Before; What was wrong, What you did in The work", () => {
    expect(src).toContain('const before = phase === "before";');
    expect(src).toContain('title={before ? "Repairs" : "The work"}');
    // The "N added" / "N of N done" aside sits on the step card's header (the form).
    expect(form).toContain("<span>{repairRows.length} added</span>");
    expect(form).toMatch(/\{workDone\} of \{repairRows\.length\} done/);
    expect(src).toContain("No repairs on the ticket — add them in step 2.");
    expect(src).toContain("{before && !confirmRemove && (");
    expect(src).toMatch(
      /\{before && \(\s*<div className="flex items-center gap-2">\s*<Label className="text-sm text-muted-foreground">Quantity<\/Label>/,
    );
    expect(src).toMatch(
      /\{!before && \(\s*<>\s*<div className="space-y-1">\s*<Label className="text-sm" htmlFor=\{`\$\{repair\.id\}-problem`\}>\s*What was wrong\s*<\/Label>/,
    );
    // The picker's reads are step 2's only.
    expect(src.match(/enabled: !!session && before,/g)).toHaveLength(2);
    expect(src).toContain("enabled: !!session && before && q.length >= 2,");
  });
});

describe("the Complete bar", () => {
  it("completes only from step 7; before that it says Finish step N and scrolls there", () => {
    expect(form).toContain(
      'const stepToFinish = open === null || open === "signature" ? null : open;',
    );
    expect(form).toContain("onClick={stepToFinish ? () => jumpTo(stepToFinish) : pressComplete}");
    expect(form).toContain('variant={stepToFinish ? "secondary" : "default"}');
    expect(form).toMatch(
      /\{stepToFinish\s*\?\s*finishStepLabel\(stepToFinish\)\s*:\s*finished\s*\?\s*"Finish"\s*:\s*"Complete"\}/,
    );
    // The Before-you-finish dialog, Retry and Complete anyway stay.
    expect(form).toContain("Complete anyway");
    expect(form).toMatch(/\{unread && \(\s*<Button/);
  });
});

describe("the Nothing used mark (step 4)", () => {
  it("is a button under the materials and POs while nothing is logged; pressed, a ticked line with Undo", () => {
    expect(form).toMatch(/\{\(materialsQ\.data \?\? \[\]\)\.length === 0 &&\s*\(nothingUsed \? \(/);
    expect(form).toContain("onClick={() => markNothingUsed(true)}");
    expect(form).toContain("onClick={() => markNothingUsed(false)}");
    expect(form.match(/Nothing used on this ticket/g)).toHaveLength(2);
  });
  it("lives in localStorage per ticket (no column), read like the text draft, cleared on Complete", () => {
    expect(src).toContain(
      "const [nothingUsed, setNothingUsed] = useState(() => readNothingUsed(job.id));",
    );
    expect(src).toContain('window.localStorage.getItem(nothingUsedKey(id)) === "1"');
    expect(src).toContain('window.localStorage.setItem(nothingUsedKey(id), "1")');
    expect(src).toContain("window.localStorage.removeItem(nothingUsedKey(id))");
    expect(form).toMatch(/clearDraft\(job\.id\);\s*clearNothingUsed\(job\.id\);/);
    expect(src).toMatch(/no column holds it, so the mark lives in\s*\/\/ localStorage per ticket/);
  });
});

describe("the toast when a step unlocks", () => {
  it("fires once the reads settled, forward only, and scrolls the next heading into view unless the tech is typing", () => {
    expect(form).toContain(
      "const ready = ![repairsQ, photosQ, timeQ, materialsQ].some((q) => q.isLoading);",
    );
    expect(form).toContain("const prevOpen = useRef<StepId | null | undefined>(undefined);");
    expect(form).toMatch(
      /if \(!ready\) return;\s*const prev = prevOpen\.current;\s*prevOpen\.current = open;\s*if \(prev === undefined\) return;\s*const msg = unlockToast\(prev, open\);\s*if \(!msg\) return;\s*toast\.success\(msg\);\s*if \(open && !isTyping\(\)\) jumpTo\(open\);/,
    );
    expect(src).toMatch(
      /function jumpTo\(id: StepId\) \{\s*document\s*\.getElementById\(stepAnchor\(id\)\)\s*\?\.scrollIntoView\?\.\(\{ block: "start", behavior: "smooth" \}\);/,
    );
    expect(src).toContain("el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement");
  });
});

describe("the crew box is still the gate (step 1)", () => {
  it("nothing after it renders until the question is answered; the reads then settle before the steps show", () => {
    expect(form).toContain("const waiting = crewQuestionPending(job);");
    expect(form).toMatch(
      /<StepCard \{\.\.\.card\("crew"\)\} icon=\{Users\}>\s*<CrewBox job=\{job\} embedded \/>\s*<\/StepCard>\s*\{waiting \? null : !ready \? \(/,
    );
    // Owner, Oct 9 (later): the paragraph under step 1 repeated the strip and the crew card's
    // own line; while waiting, nothing renders below the card.
    expect(form).not.toContain("Check-in details, photos, repairs and the rest open");
    expect(form).toMatch(
      /\{waiting \? null : !ready \? \(\s*<p[^>]*>\s*<Loader2 className="h-4 w-4 animate-spin" \/> Loading the ticket…/,
    );
    // The crew answer is step 1's rule, nothing more.
    expect(form).toContain("crewAnswered: !waiting,");
  });
});
