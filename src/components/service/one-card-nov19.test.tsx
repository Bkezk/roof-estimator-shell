// @vitest-environment node
/**
 * One card on the screen in the ticket workflow (owner, Nov 19, with a picture of his phone:
 * "let's keep the numbers and the dropdown that shows you each step but let's only show the card
 * we are currently on rather than all steps minimized in the list except for the one your on").
 *
 * Before: every step was in the page at once (locked ones as one muted line, done ones folded
 * to a summary with Edit), so the page was a long list to scroll down. Each test here fails on
 * that code.
 *
 *  rules    service/one-card.ts
 *  screen   service/closeout.tsx (StepStrip, StepCard, CloseoutForm)
 */
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { Wrench } from "lucide-react";
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

import { closeoutSteps, type StepId, type StepStatus } from "@/lib/closeout-steps";
import { StepCard, StepStrip } from "./closeout";
import { backToStep, cardInPage, pickStep, shownCardStep } from "./one-card";

const src = readFileSync("src/components/service/closeout.tsx", "utf8");
const form = src.slice(src.indexOf("function CloseoutForm("));

/** A repair ticket on step 3 (The work): crew and Before done, the rest locked. */
const onWork: Partial<Record<StepId, StepStatus>> = {
  crew: "done",
  before: "done",
  work: "current",
};
const statusOf = (id: StepId): StepStatus => onWork[id] ?? "locked";
const statuses = closeoutSteps("Repair").map((step) => ({ step, status: statusOf(step.id) }));
const allDone = (): StepStatus => "done";

describe("which card is on the screen", () => {
  it("the step being worked, with nothing picked", () => {
    expect(shownCardStep(null, statusOf, "work", "signature")).toBe("work");
  });
  it("a done step picked from the numbers", () => {
    expect(shownCardStep("before", statusOf, "work", "signature")).toBe("before");
  });
  it("never a locked step: a picked step that locked again gives way to the step being worked", () => {
    expect(shownCardStep("materials", statusOf, "work", "signature")).toBe("work");
  });
  it("with every step done, the last one, so a finished ticket still shows a card", () => {
    expect(shownCardStep(null, allDone, null, "signature")).toBe("signature");
    expect(shownCardStep("crew", allDone, null, "signature")).toBe("crew");
  });
});

describe("a tap on a number", () => {
  it("a done step is picked; the step being worked drops the pick; a locked one changes nothing", () => {
    expect(pickStep("before", statusOf, "work", null)).toBe("before");
    expect(pickStep("work", statusOf, "work", "before")).toBeNull();
    expect(pickStep("materials", statusOf, "work", "before")).toBe("before");
    expect(pickStep("materials", statusOf, "work", null)).toBeNull();
  });
});

describe("what is in the page", () => {
  it("the card on the screen, and the step being worked (hidden) while a done step is looked at", () => {
    expect(cardInPage(true, "done")).toBe(true);
    expect(cardInPage(true, "current")).toBe(true);
    // Hours half typed on the step being worked are still there on the way back.
    expect(cardInPage(false, "current")).toBe(true);
    // Every other step draws nothing: this is what turns the long list into one card.
    expect(cardInPage(false, "done")).toBe(false);
    expect(cardInPage(false, "locked")).toBe(false);
  });
  it("Back to step N: on a done step, to the step being worked; not on that step, not once all are done", () => {
    expect(backToStep("before", "done", "work")).toBe("work");
    expect(backToStep("work", "current", "work")).toBeNull();
    expect(backToStep("before", "done", null)).toBeNull();
  });
});

const cardProps = (id: StepId, shown: boolean) => ({
  id,
  shown,
  status: statusOf(id),
  open: "work" as StepId,
  serviceType: "Repair",
  icon: Wrench,
  onBack: () => {},
  missing: null,
  onNext: () => {},
});

describe("the card as drawn", () => {
  it("a step off the screen draws nothing (a done one drew its folded summary, a locked one its muted line)", () => {
    expect(renderToString(<StepCard {...cardProps("before", false)}>BODY</StepCard>)).toBe("");
    expect(renderToString(<StepCard {...cardProps("materials", false)}>BODY</StepCard>)).toBe("");
  });
  it("a done step on the screen shows whole, with Back to step 3 and no Edit / Done toggle", () => {
    const html = renderToString(<StepCard {...cardProps("before", true)}>BODY</StepCard>);
    expect(html).toContain("BODY");
    expect(html).toContain('data-action="step-back"');
    expect(html.replace(/<!-- -->/g, "")).toContain("Back to step 3");
    expect(html).not.toContain("Edit");
    expect(html).not.toMatch(/<section[^>]*\shidden/);
  });
  it("the step being worked: on the screen with its Next button; off the screen still in the page, hidden", () => {
    const on = renderToString(<StepCard {...cardProps("work", true)}>BODY</StepCard>);
    expect(on).toContain("BODY");
    expect(on).toContain("Next step: Materials");
    expect(on).not.toContain("step-back");
    expect(on).not.toMatch(/<section[^>]*\shidden/);
    const off = renderToString(<StepCard {...cardProps("work", false)}>BODY</StepCard>);
    expect(off).toContain("BODY");
    expect(off).toMatch(/<section[^>]*\shidden/);
  });
});

describe("the numbers and the step list stay", () => {
  const strip = (shown: StepId) =>
    renderToString(
      <StepStrip
        statuses={statuses}
        open="work"
        serviceType="Repair"
        shown={shown}
        onPick={() => {}}
        summary={(id) => `summary of ${id}`}
      />,
    );
  it("seven numbers, the one on the screen marked", () => {
    const html = strip("before");
    expect(html.match(/data-step-dot=/g)).toHaveLength(7);
    expect(html).toMatch(/data-step-dot="before" data-step-shown="true"/);
    expect(html.match(/data-step-shown=/g)).toHaveLength(1);
    // A done step on the screen that is not the one being worked wears a ring.
    expect(html).toMatch(/data-step-dot="before"[^>]*ring-2 ring-primary/);
    expect(strip("work")).not.toContain("ring-2 ring-primary");
    // The chevron that opens the step list.
    expect(html).toContain('aria-label="Show all steps"');
  });
  it("a tap on a number or a line of the list shows that card; the list closes after a pick", () => {
    const s = src.slice(src.indexOf("function StepStrip({"), src.indexOf("function StepCard({"));
    expect(s).toContain('onClick={() => status !== "locked" && onPick(step.id)}');
    expect(s).toMatch(/onClick=\{\(\) => \{\s*onPick\(step\.id\);\s*setListOpen\(false\);\s*\}\}/);
    expect(s).toContain('disabled={status === "locked"}');
    // The folded card's one-line summary lives in the list now, on the done steps.
    expect(s).toMatch(/\{status === "done" && summary\(step\.id\) && \(/);
    expect(s).not.toContain("jumpTo(");
  });
});

describe("the form", () => {
  it("draws exactly one card: each step is told whether it is the one on the screen", () => {
    expect(form).toContain("const shownCard = shownCardStep(picked, status, shownOpen, lastStep);");
    expect(form).toContain("shown: id === shownCard,");
    expect(form).toContain("const [picked, setPicked] = useState<StepId | null>(null);");
    // Nothing remembered; the pick is dropped when the step being worked moves.
    expect(form).toContain("useEffect(() => setPicked(null), [shownOpen]);");
    expect(form).not.toMatch(/localStorage[^\n]*picked/);
  });
  it("a pick never moves the step being worked, and a locked step is never picked", () => {
    const pick = form.slice(
      form.indexOf("const pick = (id: StepId)"),
      form.indexOf("const card = "),
    );
    expect(pick).toContain('if (status(id) === "locked") return;');
    expect(pick).toContain("setPicked(pickStep(id, status, shownOpen, picked))");
    expect(pick).not.toContain("setOnStep");
  });
  it("Next step and the bar's Finish step N go to the step being worked and drop the pick", () => {
    expect(form).toMatch(
      /const goTo = \(id: StepId\) => \{\s*flushSync\(\(\) => \{\s*setOnStep\(id\);\s*setPicked\(null\);\s*\}\);\s*jumpTo\(id\);/,
    );
    expect(form).toContain("onClick={stepToFinish ? () => goTo(stepToFinish) : pressComplete}");
  });
  it("the pinned bar and the Care Plan buttons are outside the cards, so they show on every step", () => {
    const bar = form.slice(form.indexOf("<div className={PINNED_BAR} data-pinned-bar>"));
    expect(bar).toContain("<RoofCareButtons");
    expect(bar).not.toContain("<StepCard");
  });
});

describe("reopening an inspection (found while checking one card on the screen)", () => {
  it("the opening step is picked only after the checklist's saved state is known", () => {
    // The read answered one drawing before the draft learned the server holds a record. The
    // workflow chose its opening step in that drawing, so an inspection that had reached Time
    // reopened on step 1, the only card on the screen.
    const draft = readFileSync("src/components/service/inspection-draft.ts", "utf8").replace(
      /\s+/g,
      " ",
    );
    expect(draft).toContain(
      "loading: opts.enabled && (q.isLoading || (q.data !== undefined && draft === null)),",
    );
    expect(form.replace(/\s+/g, " ")).toContain(
      "const ready = ![repairsQ, photosQ, timeQ, materialsQ].some((q) => q.isLoading) && !insp.loading;",
    );
  });
});
