// @vitest-environment node
/**
 * The cleaning a Roof Care plan includes, asked on its inspection (owner, Nov 19: "go" on "a
 * tick on the inspection"; the report's item: "The site does not record that drains or gutters
 * were cleaned").
 *
 * Before: a plan's inspection was the same four steps as any other, nothing asked whether the
 * drains, scuppers or gutters the plan promises were cleaned, and Complete never waited for it.
 * Each test here fails on that code.
 *
 *  rules    service/cleaning-gate.ts (and lib/roof-care-cleaning.ts, the main session's)
 *  screen   service/cleaning.tsx, service/closeout.tsx (the Checklist step)
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
    session: { user: { id: "t1" } },
    profile: { id: "t1", role: "user", access: ["service"], technician: true },
  }),
}));

import {
  CLEANING_NEEDS_WHY,
  CLEANING_UNANSWERED,
  cleaningAsked,
  type VisitCleaning,
} from "@/lib/roof-care-cleaning";
import type { PlanKey } from "@/lib/roof-care-price";
import type { VisitKind } from "@/lib/roof-care-plan";
import { CleaningQuestions } from "./cleaning";
import {
  checklistStepSaved,
  CLEANING_LOADING,
  CLEANING_UNREAD,
  cleaningGaps,
  cleaningGate,
  cleaningHolds,
  cleaningNos,
  cleaningReason,
  cleaningShown,
  cleaningStepMissing,
  cleaningTap,
} from "./cleaning-gate";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const visit = (
  plan: PlanKey,
  over: Partial<VisitCleaning> = {},
  kind: VisitKind = "visit1",
): VisitCleaning => ({
  visit_id: "v1",
  plan,
  kind,
  asked: cleaningAsked(plan, kind),
  drains: null,
  gutters: null,
  note: null,
  by_name: null,
  at: null,
  ...over,
});
const gate = (data: VisitCleaning | null | undefined, error: unknown = null, loading = false) =>
  cleaningGate({ visitId: "v1", data, error, loading });

describe("which tickets are asked", () => {
  it("a ticket that is not a plan's inspection has no gate, whatever was read", () => {
    const g = cleaningGate({ visitId: null, data: visit("guard"), error: null, loading: true });
    expect(g).toEqual({ kind: "none" });
    expect(cleaningHolds(g, false)).toBe(true);
    expect(cleaningGaps(g, false)).toEqual({ gaps: [], unread: false });
  });
  it("Roof Watch asks nothing, and neither does a storm inspection", () => {
    expect(gate(visit("watch"))).toEqual({ kind: "none" });
    expect(gate(visit("guard", {}, "storm"))).toEqual({ kind: "none" });
  });
  it("Roof Care is asked the drains; Roof Guard the drains and the gutters", () => {
    const care = gate(visit("care"));
    expect(care.kind === "asked" && care.open).toEqual(["drains"]);
    const guard = gate(visit("guard"));
    expect(guard.kind === "asked" && guard.open).toEqual(["drains", "gutters"]);
    // One carried from last plan year is asked as the year's own are.
    const carried = gate(visit("guard", {}, "carried"));
    expect(carried.kind === "asked" && carried.open).toEqual(["drains", "gutters"]);
  });
  it("a No is an answer: only what is not answered stays open", () => {
    const g = gate(visit("guard", { drains: true, gutters: false, note: "needs a lift" }));
    expect(g.kind === "asked" && g.open).toEqual([]);
    expect(cleaningHolds(g, false)).toBe(true);
  });
  it("a read still on its way, or one that failed, is not an answer", () => {
    expect(gate(undefined, null, true)).toEqual({ kind: "loading" });
    expect(gate(undefined, new Error("offline"))).toEqual({ kind: "unread", message: "offline" });
    expect(cleaningHolds(gate(undefined, null, true), false)).toBe(false);
    expect(cleaningHolds(gate(undefined, new Error("offline")), false)).toBe(false);
    // Read, and the reader cannot see such an inspection: nothing to wait for.
    expect(gate(null)).toEqual({ kind: "none" });
  });
});

describe("the Checklist step and Complete wait for the answers", () => {
  const open = gate(visit("guard", { drains: true }));
  const answered = gate(visit("guard", { drains: true, gutters: true }));
  it("the step is done only when the checklist is saved and every question is answered", () => {
    expect(checklistStepSaved(true, open, false)).toBe(false);
    expect(checklistStepSaved(true, answered, false)).toBe(true);
    expect(checklistStepSaved(false, answered, false)).toBe(false);
    expect(checklistStepSaved(true, { kind: "none" }, false)).toBe(true);
    // A ticket already finished waits for nothing.
    expect(checklistStepSaved(true, open, true)).toBe(true);
  });
  it("the line under Next says the checklist first, then the plan's questions", () => {
    const base = "Save the checklist (flag only what has a problem)";
    expect(cleaningStepMissing("checklist", base, false, open, false)).toBe(base);
    expect(cleaningStepMissing("checklist", base, true, open, false)).toBe(CLEANING_UNANSWERED);
    expect(cleaningStepMissing("checklist", null, true, answered, false)).toBeNull();
    // No other step's line is touched.
    expect(cleaningStepMissing("time", "Add the time", true, open, false)).toBe("Add the time");
    expect(
      cleaningStepMissing("checklist", base, true, gate(undefined, new Error("x")), false),
    ).toBe(CLEANING_UNREAD);
    expect(cleaningStepMissing("checklist", base, true, gate(undefined, null, true), false)).toBe(
      CLEANING_LOADING,
    );
  });
  it("Complete lists each question that is not answered, in plain words", () => {
    expect(cleaningGaps(open, false)).toEqual({
      gaps: ["Not answered: Were the gutters cleaned?"],
      unread: false,
    });
    expect(cleaningGaps(gate(visit("guard")), false).gaps).toEqual([
      "Not answered: Were the drains and scuppers cleaned?",
      "Not answered: Were the gutters cleaned?",
    ]);
    expect(cleaningGaps(answered, false)).toEqual({ gaps: [], unread: false });
    // A read that failed can be tried again from the list.
    expect(cleaningGaps(gate(undefined, new Error("x")), false)).toEqual({
      gaps: [CLEANING_UNREAD],
      unread: true,
    });
    expect(cleaningGaps(open, true)).toEqual({ gaps: [], unread: false });
  });
  it("the workflow uses them: the step's rule, its line, Complete's list, and the first card", () => {
    const src = read("src/components/service/closeout.tsx");
    const form = flat(src.slice(src.indexOf("function CloseoutForm(")));
    expect(form).toContain("const planVisitId = inspection ? job.roof_care_visit_id : null;");
    expect(form).toContain("const cleaningQ = useVisitCleaning(planVisitId);");
    expect(form).toContain(
      "checklistSaved: checklistStepSaved(checklistSaved, cleaning, finished),",
    );
    // (Nov 23: the same call, now inside the line for a plan inspection's checklist rows that
    // still need an answer, which comes first; inspection-answers-nov23.test.ts.)
    expect(form).toContain(
      "missing: planRowsStepMissing( id, cleaningStepMissing(id, stepMissing(id, stepState), checklistSaved, cleaning, finished), planRowsOpen, ),",
    );
    expect(form).toContain("const plan = cleaningGaps(gate, finished);");
    // (Nov 23: with the checklist rows a plan's inspection still waits for between them.)
    expect(form).toContain(
      "return { gaps: [...base.gaps, ...planRowsGaps(planRowsOpen), ...plan.gaps], unread: base.unread || plan.unread, };",
    );
    // Retry reads the plan's questions again with the rest, and judges that answer.
    expect(form).toContain("planVisitId ? cleaningQ.refetch() : Promise.resolve(cleaningQ),");
    expect(form).toContain("return gapsOf({ repairs, photos, time }, gateOf(plan));");
    // The first card waits for the read, so it never opens past the questions.
    expect(form).toContain("!(planVisitId && cleaningQ.isLoading);");
  });
  it("the questions sit in the Checklist card, under the checklist, not in a pop-up", () => {
    const form = flat(read("src/components/service/closeout.tsx"));
    const card = form.slice(
      form.indexOf('{...card("checklist")}'),
      form.indexOf('{...card("findings")}'),
    );
    expect(card).toContain("<InspectionChecklistStep");
    expect(card.indexOf("<CleaningQuestions")).toBeGreaterThan(
      card.indexOf("<InspectionChecklistStep"),
    );
    expect(card).toContain(
      "<CleaningQuestions gate={cleaning} locked={!extrasEditable} office={isOffice(profile)} onRetryRead={() => void cleaningQ.refetch()} />",
    );
    expect(flat(read("src/components/service/cleaning.tsx"))).not.toContain("<Dialog");
  });
});

describe("answering", () => {
  const guard = visit("guard");
  it("Yes saves at once", () => {
    expect(cleaningTap(guard, [], "drains", true, "")).toEqual({
      send: { drains: true },
      pendingNo: [],
    });
  });
  it("No with no reason yet waits for the reason, and shows as picked", () => {
    const r = cleaningTap(guard, [], "gutters", false, "");
    expect(r).toEqual({ send: null, pendingNo: ["gutters"] });
    expect(cleaningShown(guard, r.pendingNo, "gutters")).toBe("pending");
    expect(cleaningShown(guard, r.pendingNo, "drains")).toBe("none");
    expect(cleaningNos(guard, r.pendingNo)).toEqual(["gutters"]);
    // The reason box saves the waiting No with the reason.
    expect(cleaningReason(guard, r.pendingNo, "  cannot be reached without a lift ")).toEqual({
      send: { gutters: false, note: "cannot be reached without a lift" },
      problem: null,
    });
    // Left blank: the plain line, and nothing is sent.
    expect(cleaningReason(guard, r.pendingNo, "  ")).toEqual({
      send: null,
      problem: CLEANING_NEEDS_WHY,
    });
  });
  it("No saves at once when the reason is already typed or already saved", () => {
    expect(cleaningTap(guard, [], "gutters", false, "frozen")).toEqual({
      send: { gutters: false, note: "frozen" },
      pendingNo: [],
    });
    const hasNote = visit("guard", { drains: false, note: "roof iced over" });
    expect(cleaningTap(hasNote, [], "gutters", false, "")).toEqual({
      send: { gutters: false, note: "roof iced over" },
      pendingNo: [],
    });
  });
  it("turning the last No into a Yes takes the reason off; with another No standing it stays", () => {
    const one = visit("guard", { drains: true, gutters: false, note: "needs a lift" });
    expect(cleaningTap(one, [], "gutters", true, "needs a lift").send).toEqual({
      gutters: true,
      note: "",
    });
    const two = visit("guard", { drains: false, gutters: false, note: "iced over" });
    expect(cleaningTap(two, [], "gutters", true, "iced over").send).toEqual({ gutters: true });
  });
  it("a reason that was not changed is not sent again, and one that was is", () => {
    const saved = visit("guard", { drains: true, gutters: false, note: "needs a lift" });
    expect(cleaningReason(saved, [], "needs a lift")).toEqual({ send: null, problem: null });
    expect(cleaningReason(saved, [], "needs a 40 ft lift")).toEqual({
      send: { note: "needs a 40 ft lift" },
      problem: null,
    });
    // Emptied while the No stands: refused, never saved blank.
    expect(cleaningReason(saved, [], "")).toEqual({ send: null, problem: CLEANING_NEEDS_WHY });
  });
});

describe("on the screen", () => {
  const draw = (data: VisitCleaning, over: { locked?: boolean; office?: boolean } = {}): string =>
    renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <CleaningQuestions
          gate={gate(data)}
          locked={over.locked ?? false}
          office={over.office ?? false}
          onRetryRead={() => {}}
        />
      </QueryClientProvider>,
      // React marks where text meets a value; the words are what is read.
    ).replaceAll("<!-- -->", "");
  it("a ticket with nothing to ask shows nothing new", () => {
    expect(
      renderToString(
        <QueryClientProvider client={new QueryClient()}>
          <CleaningQuestions gate={{ kind: "none" }} locked={false} office onRetryRead={() => {}} />
        </QueryClientProvider>,
      ),
    ).toBe("");
    expect(draw(visit("watch"))).toBe("");
  });
  it("Roof Guard: both questions, each with a Yes and a No a thumb can hit", () => {
    const html = draw(visit("guard"));
    expect(html).toContain("Included in the Roof Guard plan at this inspection");
    expect(html).toContain("Were the drains and scuppers cleaned?");
    expect(html).toContain("Were the gutters cleaned?");
    expect(html.match(/data-cleaning-yes/g)).toHaveLength(2);
    expect(html.match(/data-cleaning-no/g)).toHaveLength(2);
    // Buttons as tall as Complete, side by side.
    expect(html.match(/h-14 text-base font-semibold/g)).toHaveLength(4);
    expect(html).toContain('data-cleaning-open="2"');
    // No reason box until something is No.
    expect(html).not.toContain("data-cleaning-why");
  });
  it("Roof Care: the drains only", () => {
    const html = draw(visit("care"));
    expect(html).toContain("Were the drains and scuppers cleaned?");
    expect(html).not.toContain("Were the gutters cleaned?");
  });
  it("a saved No shows its reason box with the reason, and the answers show as picked", () => {
    const html = draw(visit("guard", { drains: true, gutters: false, note: "needs a lift" }));
    expect(html).toContain('data-cleaning-q="drains" data-cleaning-answer="yes"');
    expect(html).toContain('data-cleaning-q="gutters" data-cleaning-answer="no"');
    expect(html).toContain("data-cleaning-why");
    expect(html).toContain("Why it was not cleaned");
    expect(html).toContain("needs a lift</textarea>");
    expect(html).toContain('data-cleaning-open="0"');
  });
  it("the office sees who answered and when; a technician does not", () => {
    const answered = visit("care", {
      drains: true,
      by_name: "Tyler M",
      at: "2027-04-02T15:30:00Z",
    });
    expect(draw(answered, { office: true })).toMatch(/data-cleaning-by[^>]*>Answered by.*Tyler M/);
    expect(draw(answered)).not.toContain("data-cleaning-by");
  });
  it("past the edit lock the answers still show, and the buttons do not act", () => {
    const html = draw(visit("care", { drains: true }), { locked: true });
    expect(html).toContain('data-cleaning-answer="yes"');
    expect(html.match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it("a read that failed says so with Try again; one on its way says it is reading", () => {
    const wrap = (g: ReturnType<typeof gate>) =>
      renderToString(
        <QueryClientProvider client={new QueryClient()}>
          <CleaningQuestions gate={g} locked={false} office={false} onRetryRead={() => {}} />
        </QueryClientProvider>,
      );
    const failed = wrap(gate(undefined, new Error("offline")));
    expect(failed).toContain("Could not read what the plan includes at this inspection");
    expect(failed).toContain("offline");
    expect(failed).toContain("Try again");
    expect(wrap(gate(undefined, null, true))).toContain('data-cleaning="loading"');
  });
  it("a save that fails is said plainly and can be tried again; a good one updates the screen", () => {
    const c = flat(read("src/components/service/cleaning.tsx"));
    expect(c).toContain("loudError(CLEANING_NOT_SAVED, e, () => save.mutate(send));");
    expect(c).toContain("{failed && !busy && (");
    expect(c).toContain("onClick={() => save.mutate(failed)}");
    expect(c).toContain("qc.setQueryData(roofCareCleaningKey(c.visit_id), now);");
    // Each tap is its own save: nothing waits for a Save button but a No's reason.
    expect(c).toContain("if (r.send) save.mutate(r.send);");
  });
});
