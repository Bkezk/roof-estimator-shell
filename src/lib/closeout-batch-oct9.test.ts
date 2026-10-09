/**
 * The close-out batch the owner approved on Oct 9 (the crew gate stays as it is — "i like the
 * gate"). B1: Complete with a failed or still-loading read lists it instead of passing silently;
 * B2: a failed background re-read keeps cached rows on screen; B3: a save merges only the fields
 * it sent, so a slow notes save no longer blanks a signature; B4: a failed photo upload keeps the
 * file for Retry upload; B7: the Time copy after the Oct 8 button removal, and who the time is
 * billed for BEFORE the first line; B8: dead `askCrew`; S5: the repair picker shows matches under
 * the search box and hides the chips while typing; S6: a folded repair row has its own camera
 * buttons; S13: 30 s staleTime and My tickets seeding the ticket cache; tap targets. Each pin
 * fails on the Oct 8 screens.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { completeGaps, missingForComplete, type CompleteGapsInput } from "@/lib/closeout-check";
import { CLOSEOUT_TEXT_FIELDS, CREW_FIELDS, mergeSaved, seedJobFromToday } from "@/lib/job-cache";
import type { TodayJob } from "@/lib/service-field.functions";

const read = (p: string) => readFileSync(p, "utf8");
const closeout = read("src/components/service/closeout.tsx");
const shared = read("src/components/service/field-shared.tsx");
const materials = read("src/components/service/materials-section.tsx");
const crewBox = read("src/components/service/crew-box.tsx");
const today = read("src/components/service/today-page.tsx");

// ---------------------------------------------------------------------------------------------
// B1

const answered: CompleteGapsInput = {
  finished: false,
  service_type: "leak",
  signature_path: "job/sig.png",
  closing_notes: "Patched the seam",
  on_site_at: null,
  repairs: { data: [{ id: "r1", name: "Seam" }], error: null },
  photos: {
    data: [
      { repair_id: "r1", role: "before" },
      { repair_id: "r1", role: "after" },
    ],
    error: null,
  },
  time: { data: [{ hours: "1.5" }], error: null },
};

describe("B1 completeGaps: a read without rows is a line, never a silent pass", () => {
  it("nothing missing when every read answered and all is there", () => {
    expect(completeGaps(answered)).toEqual({ gaps: [], unread: false });
  });
  it("a failed repairs or photos read says so (with the message) and marks the dialog for Retry", () => {
    const out = completeGaps({
      ...answered,
      repairs: { data: undefined, error: new Error("Failed to fetch") },
    });
    expect(out.gaps).toEqual(["Could not check the repairs — no signal (Failed to fetch)"]);
    expect(out.unread).toBe(true);
    expect(completeGaps({ ...answered, photos: { data: undefined, error: "boom" } }).gaps).toEqual([
      "Could not check the photos — no signal (boom)",
    ]);
  });
  it("a read still loading is a line too (the dialog shows with Complete anyway, never blocks)", () => {
    const out = completeGaps({ ...answered, time: { data: undefined, error: null } });
    expect(out).toEqual({ gaps: ["Still loading the time"], unread: true });
  });
  it("the old code's hole: repairs AND photos unread used to be []; now both are listed, then the rest", () => {
    const out = completeGaps({
      ...answered,
      repairs: { data: undefined, error: null },
      photos: { data: undefined, error: new Error("offline") },
      time: { data: undefined, error: new Error("offline") },
      closing_notes: "",
      signature_path: null,
    });
    expect(out.gaps).toEqual([
      "Still loading the repairs",
      "Could not check the photos — no signal (offline)",
      "Could not check the time — no signal (offline)",
      "No closing notes",
      "No customer signature",
    ]);
    expect(out.unread).toBe(true);
  });
  it("answered reads give the same lines as missingForComplete, in its order", () => {
    const c = {
      ...answered,
      photos: { data: [{ repair_id: "r1", role: "before" }], error: null },
      time: { data: [], error: null },
      closing_notes: " ",
    };
    expect(completeGaps(c).gaps).toEqual(
      missingForComplete({
        service_type: c.service_type,
        repairs: c.repairs.data!,
        photos: c.photos.data,
        signature_path: c.signature_path,
        closing_notes: c.closing_notes,
        time_hours: 0,
      }),
    );
    expect(completeGaps(c).gaps).toEqual([
      "Seam has no After photo",
      "No time logged",
      "No closing notes",
    ]);
  });
  it("an older ticket's On site stamp: no time line even with the time read unanswered", () => {
    expect(
      completeGaps({
        ...answered,
        on_site_at: "2026-10-01T13:00:00Z",
        time: { data: undefined, error: new Error("x") },
      }),
    ).toEqual({ gaps: [], unread: false });
  });
  it("Finish (already done) checks nothing, whatever the reads say", () => {
    expect(
      completeGaps({
        ...answered,
        finished: true,
        repairs: { data: undefined, error: new Error("x") },
        closing_notes: "",
      }),
    ).toEqual({ gaps: [], unread: false });
  });
  it("the screen judges completeGaps from the three reads and offers Retry, which re-reads them", () => {
    expect(closeout).toMatch(
      /const pressComplete = \(\) =>\s*judge\(gapsOf\(\{ repairs: repairsQ, photos: photosQ, time: timeQ \}\)\);/,
    );
    expect(closeout).toContain("closing_notes: latest.current.closing_notes");
    expect(closeout).toMatch(
      /await Promise\.all\(\[\s*repairsQ\.refetch\(\),\s*photosQ\.refetch\(\),\s*timeQ\.refetch\(\),\s*\]\)/,
    );
    expect(closeout).toMatch(
      /\{unread && \(\s*<Button[\s\S]*?onClick=\{\(\) => retry\.mutate\(\)\}[\s\S]*?Retry\s*<\/Button>/,
    );
    expect(closeout).toContain("Complete anyway");
    expect(closeout).not.toContain("missingForComplete(");
  });
});

// ---------------------------------------------------------------------------------------------
// B2

describe("B2 a failed background refetch keeps the cached data on screen", () => {
  it("TimeEntries: the list and Add time stay, with a small Could not refresh line", () => {
    expect(shared).toMatch(
      /if \(q\.error && !q\.data\)\s*return <p className="text-sm text-destructive">Could not load time/,
    );
    expect(shared).toContain("Could not refresh: {errText(q.error)}");
    expect(shared).not.toMatch(/if \(q\.error\)\s*return/);
  });
  it("Repairs: the rows stay, the line says refresh when rows are cached", () => {
    expect(closeout).toContain(
      '{repairs.data ? "Could not refresh the repairs" : "Could not load the repairs"}',
    );
    expect(closeout).toContain(
      '{photos.data ? "Could not refresh the photos" : "Could not load the photos"}',
    );
  });
  it("Materials: the ticket list, the elsewhere panel and the truck fold keep their rows", () => {
    expect(materials).toContain(
      '{materials.data ? "Could not refresh" : "Could not load"} this ticket\'s materials:',
    );
    expect(materials).toMatch(
      /\{other\.error && other\.data && \([\s\S]*?Could not refresh \{locName\(fromLoc\)\}/,
    );
    expect(materials).toMatch(/\{other\.error && !other\.data \? \(/);
    expect(materials).toMatch(
      /\{truck\.error && truck\.data && \([\s\S]*?Could not refresh your truck/,
    );
    expect(materials).toMatch(/\{truck\.error && !truck\.data \? \(/);
    expect(materials).not.toMatch(/\{other\.error \? \(/);
    expect(materials).not.toMatch(/\{truck\.error \? \(/);
  });
});

// ---------------------------------------------------------------------------------------------
// B3

describe("B3 mergeSaved: a save merges only the fields it sent", () => {
  const cached = {
    id: "j1",
    closing_notes: null as string | null,
    signed_by: null as string | null,
    signature_path: "j1/signature-1.png" as string | null,
    signed_at: "2026-10-09T15:00:00Z" as string | null,
    helper_count: 0,
    crew_confirmed_at: null as string | null,
    updated_at: "t1",
    updated_by_name: "A",
  };
  it("a slow notes save landing after the signature save keeps the signature", () => {
    // The server's row was read before the signature landed: signature_path null on it.
    const row = {
      ...cached,
      closing_notes: "Patched",
      signature_path: null,
      signed_at: null,
      updated_at: "t2",
    };
    const out = mergeSaved(cached, row, [
      "closing_notes",
      "signed_by",
      "updated_at",
      "updated_by_name",
    ]);
    expect(out).toEqual({ ...cached, closing_notes: "Patched", updated_at: "t2" });
    // The old code's spread lost it.
    expect({ ...cached, ...row }.signature_path).toBeNull();
  });
  it("nothing cached stays nothing (a partial row never stands in for the ticket)", () => {
    expect(
      mergeSaved<typeof cached, "closing_notes">(undefined, cached, ["closing_notes"]),
    ).toBeUndefined();
  });
  it("the field lists are what saveCloseout and setJobCrew write", () => {
    expect(CLOSEOUT_TEXT_FIELDS).toEqual([
      "closing_notes",
      "checked_in_with",
      "checked_out_with",
      "recommend_new_roof",
      "signed_by",
      "updated_at",
      "updated_by_name",
    ]);
    expect(CREW_FIELDS).toEqual([
      "helper_count",
      "crew_confirmed_at",
      "updated_at",
      "updated_by_name",
    ]);
    // Neither list carries the signature: that is the column the late save used to blank.
    const sent: readonly string[] = [...CLOSEOUT_TEXT_FIELDS, ...CREW_FIELDS];
    expect(sent).not.toContain("signature_path");
    expect(sent).not.toContain("signed_at");
  });
  it("keepRow and CrewBox use it; the whole-row spread is gone from both saves", () => {
    expect(closeout).toMatch(
      /const keepRow = \(row: ServiceJobRow\) =>\s*qc\.setQueryData<ServiceJobWithTech>\(fieldKeys\.job\(job\.id\), \(old\) =>\s*mergeSaved\(old, row, CLOSEOUT_TEXT_FIELDS\),/,
    );
    expect(crewBox).toContain("mergeSaved(old, row, CREW_FIELDS),");
    expect(crewBox).toContain("...(mergeSaved(x, row, CREW_FIELDS) ?? x),");
    expect(crewBox).not.toContain("old ? { ...old, ...row } : old");
    // Only Complete's terminal save (stage, completed_at) takes the whole row, then re-reads.
    expect(closeout.match(/old \? \{ \.\.\.old, \.\.\.row \} : old/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// B4 + S6

describe("B4 a failed photo upload is kept for Retry upload; S6 the folded row has the camera", () => {
  const section = closeout.slice(
    closeout.indexOf("function RepairsSection({"),
    closeout.indexOf("const PICKER_CHIPS = 8;"),
  );
  const card = closeout.slice(
    closeout.indexOf("function RepairCard({"),
    closeout.indexOf("// (f) Signature"),
  );
  const row = closeout.slice(
    closeout.indexOf("function RepairRow({"),
    closeout.indexOf("function RepairCard({"),
  );
  it("one upload mutation and the two hidden inputs live in the section, not the card", () => {
    expect(section).toContain("const upload = useMutation({");
    expect(section).toContain("ref={beforeRef}");
    expect(section).toContain("ref={afterRef}");
    expect(section).toContain("repair_id: repairId,");
    expect(card).not.toContain("useMutation({\n    mutationFn: async ({ file, role }");
    expect(card).not.toContain('type="file"');
  });
  it("a failed upload keeps { file, role } per repair; success clears it; the toast no longer says take it again", () => {
    expect(section).toContain("const [failed, setFailed] = useState<Record<string, Shot>>({});");
    expect(section).toContain(
      "setFailed((f) => ({ ...f, [v.repairId]: { file: v.file, role: v.role } }));",
    );
    expect(section).toMatch(
      /onSuccess: \(row, v\) => \{[\s\S]*?const \{ \[v\.repairId\]: _landed, \.\.\.rest \} = f;/,
    );
    expect(closeout).not.toContain("take it again");
    expect(closeout).toContain("Retry upload");
  });
  it("Retry upload resends the kept file; Discard drops it", () => {
    expect(section).toMatch(
      /onRetry: \(\) => \{\s*const shot = failed\[r\.id\];\s*if \(shot\) upload\.mutate\(\{ \.\.\.shot, repairId: r\.id \}\);/,
    );
    expect(section).toMatch(
      /onDiscard: \(\) =>\s*setFailed\(\(f\) => \{\s*const \{ \[r\.id\]: _dropped, \.\.\.rest \} = f;/,
    );
    expect(closeout).toMatch(/\{failed && \([\s\S]*?Retry upload[\s\S]*?Discard\s*<\/Button>/);
  });
  it("the folded row has Before (n) / After (n) beside the amber needs hint, without opening the card", () => {
    expect(row).toContain("<PhotoButtons photos={photos} camera={camera} compact />");
    expect(row).toMatch(
      /<PhotoButtons[^\n]*compact \/>\s*\{s\.needs\.length > 0 && \(\s*<span className="text-xs text-amber-700 dark:text-amber-400">/,
    );
    // No button inside a button: the open control is its own <button>, closed before the camera.
    expect(row.indexOf("</button>")).toBeGreaterThan(-1);
    expect(row.indexOf("</button>")).toBeLessThan(row.indexOf("<PhotoButtons"));
    expect(row).toContain('aria-label={`Open ${repair.name || "repair"}`}');
    expect(section).toMatch(
      /const takePhoto = \(repairId: string, role: PhotoRole\) => \{\s*aim\.current = repairId;/,
    );
    expect(section).toContain("camera={photoControls(r)}");
    expect(card).toContain("<PhotoButtons photos={photos} camera={camera} />");
  });
});

// ---------------------------------------------------------------------------------------------
// B7 + B8

describe("B7 the Time copy after the Oct 8 button removal", () => {
  it("no 'From the buttons' / 'fix a forgotten button press' / 'by hand'; timed lines show their clock plainly", () => {
    for (const s of [shared, closeout]) {
      expect(s).not.toContain("From the buttons");
      expect(s).not.toContain("button press");
      expect(s).not.toContain("by hand");
      expect(s).not.toContain('source === "buttons"');
    }
    expect(shared).toMatch(
      /\{save\.isPending \? "Saving…" : `\$\{clock\(entry\.started_at\)\} to \$\{clock\(entry\.ended_at\)\}`\}/,
    );
  });
  it("who the time is billed for comes before the first line, saying one line covers everyone", () => {
    const list = shared.slice(
      shared.indexOf("export function TimeEntries("),
      shared.indexOf("function TimeFields("),
    );
    const billed = list.indexOf("{billedFor && (");
    const totals = list.indexOf("{rows.length > 0 && (");
    const lines = list.indexOf("<TimeRow key={r.id}");
    expect(billed).toBeGreaterThan(-1);
    expect(billed).toBeLessThan(totals);
    expect(totals).toBeLessThan(lines);
    expect(list).toContain('" — one time line covers everyone on the job"');
    expect(list).not.toContain(
      '{billedFor && <span className="block text-muted-foreground">{billedFor}</span>}',
    );
  });
});

describe("B8 the dead askCrew is gone from My tickets", () => {
  it("Change alone opens the crew box", () => {
    expect(today).not.toContain("askCrew");
    expect(today).toContain("{crewOpen && <CrewBox job={j} />}");
  });
});

// ---------------------------------------------------------------------------------------------
// S5

describe("S5 the repair picker: matches under the search box, chips hidden while typing", () => {
  const picker = closeout.slice(
    closeout.indexOf("{showPicker && ("),
    closeout.indexOf("Done adding"),
  );
  it("two characters typed → results right under the box, then Other; the Usual and top chips hide", () => {
    expect(closeout).toContain("const searching = q.length >= 2;");
    const box = picker.indexOf('placeholder="Search all repairs…"');
    const results = picker.indexOf("{searching && (");
    const tags = picker.indexOf('aria-label="Roof type"');
    const usual = picker.indexOf("{!searching && recentRows.length > 0 && (");
    const top = picker.indexOf("{!searching && (");
    expect(box).toBeGreaterThan(-1);
    expect(results).toBeGreaterThan(box);
    expect(results).toBeLessThan(tags);
    expect(tags).toBeLessThan(usual);
    expect(usual).toBeLessThan(top);
    expect(picker.slice(results, tags)).toContain(
      "No repair named like “{q}”. Use Other to type it.",
    );
    expect(picker.slice(results, tags)).toMatch(
      /<Chip tone="secondary" onClick=\{\(\) => setOtherOpen\(\(v\) => !v\)\}>\s*Other/,
    );
  });
  it("typing no longer expands the chip list to the full set", () => {
    expect(closeout).toContain(
      "const chipRows = allChips ? favRows : favRows.slice(0, PICKER_CHIPS);",
    );
    expect(closeout).not.toContain("q.length >= 2 ? favRows");
    expect(closeout).not.toMatch(/\{favRows\.length > PICKER_CHIPS && q\.length < 2 && \(/);
  });
});

// ---------------------------------------------------------------------------------------------
// S13

describe("S13 query hygiene: 30 s staleTime on the close-out's reads; My tickets seeds the ticket", () => {
  it("every fieldKeys.* read on the close-out is fresh for 30 s", () => {
    const stale = (s: string) => (s.match(/staleTime: 30_000,/g) ?? []).length;
    // closeout: repairsQ, photosQ, timeQ in the form + repairs, photos in the section.
    expect(stale(closeout)).toBe(5);
    // materials: the ticket's materials, the truck, the repairs.
    expect(stale(materials)).toBe(3);
    // field-shared: the time list and the crew it is billed for.
    expect(stale(shared)).toBe(2);
    // crew-box: the crew.
    expect(stale(crewBox)).toBe(1);
    for (const s of [closeout, materials, shared, crewBox])
      expect(s).not.toMatch(
        /queryKey: fieldKeys\.\w+\([^)]*\),\s*queryFn: [^\n]*\n\s*enabled: !!session,\s*\}\);/,
      );
  });
  it("Open ticket plants the row as the ticket (the loader's key and shape) before navigating", () => {
    // service-page.tsx's TicketLoader reads ["service-job", id] = fieldKeys.job(id) as ServiceJobWithTech.
    expect(read("src/components/service-page.tsx")).toMatch(
      /queryKey: \["service-job", id\],\s*queryFn: \(\) => getFn\(\{ data: \{ id \} \}\)/,
    );
    expect(read("src/components/service/field-utils.ts")).toContain(
      'job: (id: string) => ["service-job", id] as const,',
    );
    expect(today).toMatch(
      /qc\.setQueryData<ServiceJobWithTech>\(\s*fieldKeys\.job\(j\.id\),\s*\(old\) => old \?\? seedJobFromToday\(j, profile\),\s*\);\s*void navigate\(\{ to: "\/service", search: \{ id: j\.id, closeout: 1 \} \}\);/,
    );
  });
  it("seedJobFromToday: the ticket row plus the technician's name (me), without My tickets' extras", () => {
    const j = {
      id: "j1",
      number: 6012,
      technician_id: "me",
      stage: "scheduled",
      technician_instructions: "Gate code 1234",
      contact_name: "Pat",
      contact_phone: "555",
      account_phone: null,
      crew_names: ["Donnie"],
      warranty_badges: ["Duro-Last 15 NDL"],
    } as unknown as TodayJob;
    expect(seedJobFromToday(j, { full_name: "Trace Floyd", email: "t@x.com" })).toEqual({
      id: "j1",
      number: 6012,
      technician_id: "me",
      stage: "scheduled",
      technician_name: "Trace Floyd",
    });
    expect(seedJobFromToday(j, { full_name: "  ", email: "t@x.com" }).technician_name).toBe(
      "t@x.com",
    );
    expect(seedJobFromToday(j, null).technician_name).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Tap targets

describe("tap targets (owner, Oct 9)", () => {
  it("TagChip h-10; Remove and the fold chevron h-11; the photo delete 36 px; the From select text-base", () => {
    const tagChip = closeout.slice(
      closeout.indexOf("function TagChip("),
      closeout.indexOf("type PhotoRole"),
    );
    expect(tagChip).toContain('className="h-10 rounded-full px-3 text-sm"');
    expect(tagChip).not.toContain("h-8");
    expect(closeout).toContain(
      'className="h-11 px-2 text-xs text-destructive hover:text-destructive"',
    );
    expect(closeout).toMatch(/className="h-11 w-11"\s*aria-label=\{`Fold \$\{repair\.name/);
    expect(closeout).not.toContain('className="h-9 w-9"');
    expect(shared).toContain("flex h-9 w-9 items-center justify-center rounded-full bg-black/60");
    expect(shared).not.toContain("flex h-7 w-7 items-center");
    expect(materials).toMatch(
      /className="h-10 rounded-md border bg-background px-2 text-base"\s*aria-label="Take material from"/,
    );
  });
});
