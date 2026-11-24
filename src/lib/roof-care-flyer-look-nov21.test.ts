/**
 * Owner, Nov 20: "id like the roof care popup after you click the roof care button on the ticket
 * workflow to have a bit more color similar to the one sheeter i sent you". The flyer's look is
 * one set of parts (components/roof-care/flyer-look.tsx) with its colours and its headline face
 * in styles.css, and the sign-up pop-up wears it. The LOOK only: every step, box, rule, test
 * mark and word of the sign-up is pinned here as it was.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ROOF_CARE_TERMS, ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const css = read("src/styles.css");
const look = read("src/components/roof-care/flyer-look.tsx");
const card = flat(read("src/components/roof-care/plan-card.tsx"));

/** One block of the stylesheet: ".dark {" … its closing brace. */
function block(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no ${selector} block`);
  return css.slice(at, css.indexOf("\n}", at));
}

describe("the flyer's colours and its headline face", () => {
  it("the green is the sheet's green, with dark print on it, in both themes", () => {
    for (const sel of [":root", ".dark"]) {
      expect(block(sel)).toContain("--jbk-green: #7eaf28;");
      expect(block(sel)).toContain("--jbk-green-ink: #15171b;");
    }
  });
  it("the plan names are the logo's blue on white, and a lighter blue on the dark cards", () => {
    expect(block(":root")).toContain("--flyer-name: #014b96;");
    expect(block(".dark")).toContain("--flyer-name: #8ec1ff;");
    for (const v of ["--flyer-ink", "--flyer-rule", "--flyer-soft", "--flyer-tint"]) {
      expect(block(":root")).toContain(`${v}:`);
      expect(block(".dark")).toContain(`${v}:`);
    }
  });
  it("the heavy condensed face is kept in the site's own files: nothing loads from another site", () => {
    expect(css).toContain('@import "@fontsource/barlow-condensed/latin-800.css";');
    expect(read("package.json")).toContain('"@fontsource/barlow-condensed"');
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic|https?:\/\//);
    const head = flat(block(".flyer-head"));
    expect(head).toContain('font-family: "Barlow Condensed", "Arial Narrow"');
    expect(head).toContain("font-weight: 800;");
    expect(head).toContain("text-transform: uppercase;");
  });
  it("the headline sizes grow with the site's text size like every other size", () => {
    for (const h of [".flyer-h1", ".flyer-h2", ".flyer-h3"])
      expect(block(h)).toMatch(/font-size: calc\([\d.]+rem \* var\(--jbk-text-scale, 1\)\);/);
  });
});

describe("the parts of the look", () => {
  it("are drawn from the named colours, so they read on white, in the light app and the dark app", () => {
    for (const piece of [
      "bg-[var(--jbk-green)]",
      "text-[var(--jbk-green-ink)]",
      "bg-[var(--jbk-blue)]",
      "text-[var(--flyer-name)]",
      "border-[var(--flyer-rule)]",
    ])
      expect(look).toContain(piece);
    // No colour of its own that one theme would lose, and no theme switch inside the parts.
    expect(look).not.toMatch(/dark:/);
    expect(look).not.toMatch(/(?<![\w:-])(?:bg|text)-\[#/);
  });
  it("a plan is a button a thumb can press, with the marks a page or a test finds it by", () => {
    for (const mark of [
      "data-plan-card={planKey}",
      "data-plan-price",
      "data-plan-includes={planKey}",
      "data-plan-recommended",
      "aria-pressed={picked}",
      "min-h-[44px]",
    ])
      expect(look).toContain(mark);
  });
  it("knows no price: every number is handed in", () => {
    expect(look).not.toMatch(/\$\d/);
    expect(look).toContain("price: string | null;");
  });
  it("the three plans sit under each other on a phone and side by side from a tablet up", () => {
    expect(look).toContain("sm:border-l sm:border-t-0");
    expect(card).toContain("grid gap-y-5 sm:grid-cols-3");
  });
});

describe("the sign-up pop-up wears the look, and nothing else about it changed", () => {
  it("the green band with the heavy headline, the flyer's plans, the blue band at the foot", () => {
    expect(card).toContain("<DialogHeader className={`${FLYER_BAND} space-y-0 pr-12`}");
    expect(card).toContain(
      "<DialogTitle className={FLYER_BAND_TITLE}>{SIGN_UP_TITLE}.</DialogTitle>",
    );
    expect(card).toContain(
      "<DialogDescription className={FLYER_BAND_LEAD}>{SIGN_UP_LEAD}</DialogDescription>",
    );
    expect(card).toContain("<FlyerStepHead n={n} title={title} />");
    expect(card).toContain("<FlyerPlan key={k} planKey={k}");
    expect(card).toContain('<div className={`${FLYER_FOOT} space-y-3`} data-flyer="foot">');
    // The plain blue header is gone.
    expect(card).not.toContain("rounded-xl bg-[var(--jbk-blue)] px-4 py-4 text-left text-white");
  });
  it("the five steps, in order, with their words", () => {
    const steps = [
      '<SignStep n={1} title="Your roof">',
      '<SignStep n={2} title="Pick your plan">',
      '<SignStep n={3} title="Your first inspection">',
      "<SignStep n={4} title={PAY_QUESTION}>",
      '<SignStep n={5} title="Your agreement">',
    ];
    let at = -1;
    for (const s of steps) {
      const next = card.indexOf(s);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });
  it("every rule of the form is where it was", () => {
    for (const kept of [
      "data-roof-care-sign-up",
      'data-action="roof-care-price"',
      "disabled={size == null || size <= 0 || price.isPending}",
      "disabled={!o || stale}",
      "onClick={() => setPlan(k)}",
      "data-plan-offer={o ? k : undefined}",
      'data-sign-line="days-too-far"',
      'data-sign-line="size-smaller"',
      'data-sign-line="size-unchecked"',
      "data-sign-pay",
      "data-sign-email",
      "data-sign-staff",
      "<span>{AGREE_WORDS}</span>",
      'data-action="roof-care-confirm"',
      "disabled={!ready || sign.isPending}",
      "onClick={() => press(() => sign.mutateAsync())}",
      "{SIGN_UP_BUTTON}",
      'data-sign-line="missing"',
      "{signUpMissingLine(missing)}",
    ])
      expect(card).toContain(kept);
  });
  it("the plans show the same things: the lines, the price for this roof, the tag", () => {
    expect(card).toContain("price={o ? money0(o.price) : null}");
    expect(card).toContain("waiting={PRICE_AFTER_SIZE}");
    expect(card).toContain("lines={planIncludes(k, benefits?.[k] ?? null)}");
    expect(card).toContain("recommended={k === PLAN_RECOMMENDED ? RECOMMENDED_WORDS : null}");
    expect(card).toContain('action={o ? (picked ? "Selected" : `Choose ${PLAN_NAMES[k]}`) : null}');
  });
  it("the blue band says again only what is already shown: the plan picked and its price", () => {
    expect(card).toContain("{plan && offerOf(plan) && !stale ? (");
    expect(card).toContain("{money0(offerOf(plan)!.price)} per year");
  });
  it("not a word of the terms moved", () => {
    // (Nov 23: version 2026-11-23.1. Term 3 adds that what the plan includes applies to work
    // done in its twelve months, and that work done before the plan starts is not covered.)
    // (Nov 24: version 2026-11-24.1. The last term says what an inspection is and that we are
    // not responsible for a leak or for a condition we did not find; owner: "the shorter
    // version looks fine".)
    expect(ROOF_CARE_TERMS_VERSION).toBe("2026-11-24.1");
    expect(ROOF_CARE_TERMS.length).toBe(11);
  });
});
