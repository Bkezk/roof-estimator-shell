/**
 * The printed leave-behind on Setup › QR pages (owner, Nov 25, 2026: "plz put the design in the
 * setup qr pages"; "dont show pricing on it"; of a "Priced to your roof" line, "its
 * unnecessary"; "the repair amounts are fine to keep").
 *
 * Before this the Print button gave two plain sheets: a title, one line and a code each. None of
 * these can pass on that code: the sheet's words and its drawing did not exist.
 *
 * Every number here is made up and matches no plan's price or allowance.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  LEAVE_BEHIND_CSS,
  LEAVE_BEHIND_PRINT_ID,
  LeaveBehindPages,
} from "@/components/leave-behind-sheet";
import {
  SHEET_BACK_FOOT,
  SHEET_BACK_LEAD,
  SHEET_BACK_TITLE,
  SHEET_FIT_MAX,
  SHEET_FRONT_FOOT,
  SHEET_FRONT_LEAD,
  SHEET_FRONT_NOTE,
  SHEET_FRONT_TITLE,
  SHEET_NO_PRICE_NOTE,
  SHEET_PRINT_BUTTON,
  SHEET_PRINT_NOTE,
  SHEET_SERVICES_MAX,
  SHEET_STEPS,
  SHEET_TOO_FULL,
  sheetLine,
  sheetLineText,
  sheetPlans,
  sheetServices,
  sheetServicesLeftOut,
} from "@/lib/leave-behind";
import { PUBLIC_COMPANY } from "@/lib/public-pages";
import { qrSheets } from "@/lib/public-requests";
import { qrSvg } from "@/lib/qr";
import { planIncludes, type BenefitNumbers } from "@/lib/roof-care-benefits";
import { PLAN_KEYS } from "@/lib/roof-care-price";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** The eight starter services of the Request service form, as the database was given them. */
const DEFAULT_SERVICES = [
  "Roof leak or repair",
  "Roof inspection",
  "Roof replacement or new roof quote",
  "Roof Care maintenance plan",
  "Gutters and downspouts",
  "Sheet metal and flashing",
  "Storm damage",
  "Something else",
] as const;

/** Made-up numbers: no plan has these. */
const NUMBERS = {
  watch: null,
  care: { allowance: 321, leak_calls: 0, storm: 0 },
  guard: { allowance: 777, leak_calls: 3, storm: 2 },
} as unknown as BenefitNumbers;

const BASE = "https://portal.example.com";
const urls = () => {
  const sheets = qrSheets(BASE);
  return {
    careUrl: sheets.find((s) => s.key === "care")!.url,
    requestUrl: sheets.find((s) => s.key === "request")!.url,
  };
};
const draw = (services: readonly string[], numbers: BenefitNumbers | null = NUMBERS) =>
  renderToStaticMarkup(createElement(LeaveBehindPages, { ...urls(), numbers, services }));
/** The text a reader sees: the tags off, the codes' pictures off. */
const words = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("the plans' lines on the sheet are the public page's own", () => {
  it("a line is the public page's line, a little shorter, and no number changes", () => {
    expect(sheetLineText("2 inspections a year, spring and fall")).toBe("2 inspections a year");
    expect(sheetLineText("A photo report with a condition grade after each one")).toBe(
      "Photo report with a condition grade",
    );
    expect(
      sheetLineText("Next-business-day leak response, with no trip charge on 3 calls a year"),
    ).toBe("Next-business-day leak response, no trip charge on 3 calls a year");
    // A line it has no rule for is printed as it is.
    expect(sheetLineText("Yearly roof budget forecast")).toBe("Yearly roof budget forecast");
    expect(sheetLineText("Anything the plans say next year")).toBe(
      "Anything the plans say next year",
    );
  });
  it("the first words are bold, as on the flyer, and nothing is lost in the split", () => {
    expect(sheetLine("2 inspections a year, spring and fall")).toEqual({
      bold: "2 inspections",
      rest: " a year",
    });
    expect(sheetLine("$321 of minor repairs included each year")).toEqual({
      bold: "$321 of minor repairs",
      rest: " included each year",
    });
    expect(sheetLine("Everything in Roof Watch")).toEqual({
      bold: "",
      rest: "Everything in Roof Watch",
    });
    for (const numbers of [NUMBERS, null]) {
      for (const key of PLAN_KEYS) {
        const own = planIncludes(key, numbers ? numbers[key] : null);
        const plan = sheetPlans(numbers).find((p) => p.key === key)!;
        expect(plan.lines.map((l) => l.bold + l.rest)).toEqual(own.map(sheetLineText));
      }
    }
  });
  it("three plans, left to right, one of them recommended", () => {
    const plans = sheetPlans(NUMBERS);
    expect(plans.map((p) => p.key)).toEqual([...PLAN_KEYS]);
    expect(plans.filter((p) => p.recommended)).toHaveLength(1);
    for (const p of plans) {
      expect(p.name).not.toBe("");
      expect(p.pitch).not.toBe("");
      expect(p.lines.length).toBeGreaterThan(2);
    }
  });
  it("what a plan includes follows the numbers the database holds", () => {
    const text = (n: BenefitNumbers | null) =>
      sheetPlans(n)
        .flatMap((p) => p.lines.map((l) => l.bold + l.rest))
        .join(" | ");
    expect(text(NUMBERS)).toContain("$321 of minor repairs included each year");
    expect(text(NUMBERS)).toContain("$777 of minor repairs included each year");
    expect(text(NUMBERS)).toContain("no trip charge on 3 calls a year");
    expect(text(NUMBERS)).toContain("2 storm inspections");
    // Not read yet: said without a number, never with a made-up one.
    expect(text(null)).not.toContain("$");
    expect(text(null)).toContain("Minor repairs included each year");
  });
});

describe("no price is printed", () => {
  it("the only dollar amounts on the paper are the minor repairs a plan includes", () => {
    const text = words(draw(DEFAULT_SERVICES));
    expect(text.match(/\$[\d,]+/g)).toEqual(["$321", "$777"]);
    expect(text).not.toMatch(/priced to your roof/i);
    expect(text).not.toMatch(/per year|a month|per month|per sq|sq\.? ?ft|starting at|from \$/i);
  });
  it("with the numbers not read, there is no dollar sign on the paper at all", () => {
    expect(words(draw(DEFAULT_SERVICES, null))).not.toContain("$");
  });
  it("the sheet's own words hold no amount and no roof size", () => {
    const own = [
      SHEET_FRONT_TITLE,
      ...SHEET_FRONT_LEAD,
      ...Object.values(SHEET_FRONT_NOTE),
      ...Object.values(SHEET_FRONT_FOOT),
      SHEET_BACK_TITLE,
      ...SHEET_BACK_LEAD,
      ...Object.values(SHEET_BACK_FOOT),
      ...SHEET_STEPS.flatMap((s) => [s.bold, s.rest]),
      ...sheetServices(DEFAULT_SERVICES).flatMap((s) => [s.title, s.line]),
    ].join(" ");
    expect(own).not.toMatch(/\$|\d/);
    // What the office reads beside the sheet says why.
    expect(SHEET_NO_PRICE_NOTE).toBe(
      "No price is printed: the price shows on the customer's phone once they type their address.",
    );
  });
});

describe("the services on the back are the saved list", () => {
  it("every starter service has a headline and one line, in the saved order", () => {
    const starter = read("supabase/migrations/20261121100000_public_forms.sql");
    for (const name of DEFAULT_SERVICES) expect(starter).toContain(`'${name}'`);
    const list = sheetServices(DEFAULT_SERVICES);
    expect(list).toHaveLength(DEFAULT_SERVICES.length);
    for (const s of list) {
      expect(s.title).not.toBe("");
      expect(s.line).not.toBe("");
    }
    const turned = sheetServices([...DEFAULT_SERVICES].reverse());
    expect(turned.map((s) => s.title)).toEqual(list.map((s) => s.title).reverse());
  });
  it("a service the office adds prints under its own name, with nothing written for it", () => {
    expect(sheetServices(["  Skylight Replacement ", "roof inspection"])).toEqual([
      { title: "Skylight Replacement", line: "" },
      sheetServices(["Roof inspection"])[0],
    ]);
    const html = draw(["Skylight Replacement"]);
    expect(words(html)).toContain("Skylight Replacement");
    expect(html.match(/data-sheet-service/g)).toHaveLength(1);
  });
  it("blanks and repeats are left out", () => {
    expect(sheetServices(["", "  ", "Storm damage", "storm DAMAGE"])).toHaveLength(1);
  });
  it("more than the paper holds: the first ten print and the page says so", () => {
    const many = Array.from({ length: 13 }, (_, i) => `Service ${i + 1}`);
    expect(sheetServices(many)).toHaveLength(SHEET_SERVICES_MAX);
    expect(sheetServices(many)[9]!.title).toBe("Service 10");
    expect(sheetServicesLeftOut(many)).toBe(
      "The back of the sheet has room for 10 services. The last 3 on the list are not printed.",
    );
    expect(sheetServicesLeftOut(DEFAULT_SERVICES)).toBeNull();
    expect(sheetServicesLeftOut(many.slice(0, 10))).toBeNull();
  });
});

describe("the two sides as they are drawn", () => {
  it("a front and a back, each with its own code for the saved address", () => {
    const html = draw(DEFAULT_SERVICES);
    expect(html.match(/data-sheet-side="front"/g)).toHaveLength(1);
    expect(html.match(/data-sheet-side="back"/g)).toHaveLength(1);
    const { careUrl, requestUrl } = urls();
    expect(careUrl).toBe(`${BASE}/care`);
    expect(requestUrl).toBe(`${BASE}/request`);
    expect(html).toContain(`data-sheet-qr="care" data-qr-url="${careUrl}"`);
    expect(html).toContain(`data-sheet-qr="request" data-qr-url="${requestUrl}"`);
    // The pictures are the site's own codes for those two addresses, nobody else's.
    const paths = (svg: string) => svg.match(/ d="[^"]+"/g) ?? [];
    expect(paths(qrSvg(careUrl, "x")).length).toBeGreaterThan(0);
    for (const d of [...paths(qrSvg(careUrl, "x")), ...paths(qrSvg(requestUrl, "x"))]) {
      expect(html).toContain(d);
    }
    expect(qrSvg(careUrl, "x")).not.toBe(qrSvg(requestUrl, "x"));
  });
  it("the front is the plans, the back is the services, and both say how to reach us", () => {
    const html = draw(DEFAULT_SERVICES);
    const [front, back] = html.split('data-sheet-side="back"').map(words) as [string, string];
    expect(front).toContain(SHEET_FRONT_TITLE);
    expect(front).toContain("Roof Watch");
    expect(front).toContain("Roof Care");
    expect(front).toContain("Roof Guard");
    expect(front).toContain(SHEET_FRONT_FOOT.cap);
    expect(html.match(/data-sheet-plan=/g)).toHaveLength(3);
    expect(back).toContain(SHEET_BACK_TITLE);
    expect(back).toContain(SHEET_BACK_FOOT.cap);
    expect(html.match(/data-sheet-service/g)).toHaveLength(DEFAULT_SERVICES.length);
    for (const side of [front, back]) {
      expect(side).toContain(PUBLIC_COMPANY.phone);
      expect(side).toContain(PUBLIC_COMPANY.email);
      expect(side).toContain(PUBLIC_COMPANY.web);
    }
    // The star and the dagger on the plans' lines are explained on the same side.
    expect(front).toContain(`* ${SHEET_FRONT_NOTE.star}`);
    expect(front).toContain(`† ${SHEET_FRONT_NOTE.dagger}`);
  });
  it("nothing on the paper names the old address", () => {
    expect(draw(DEFAULT_SERVICES)).not.toContain("lovable.app");
    expect(read("src/lib/leave-behind.ts")).not.toContain("lovable.app");
  });
});

describe("how it prints", () => {
  it("letter paper with no margin, one side to a page", () => {
    expect(LEAVE_BEHIND_CSS).toContain("@page { size: 8.5in 11in; margin: 0; }");
    expect(LEAVE_BEHIND_CSS).toContain("width: 8.5in; height: 11in;");
    expect(LEAVE_BEHIND_CSS).toContain(
      `#${LEAVE_BEHIND_PRINT_ID} .lb-page { break-after: page; page-break-after: always; }`,
    );
    expect(LEAVE_BEHIND_CSS).toContain(
      `#${LEAVE_BEHIND_PRINT_ID} .lb-page:last-child { break-after: auto; page-break-after: auto; }`,
    );
  });
  it("only the sheet reaches the printer: everything else on the page is taken away", () => {
    const print = LEAVE_BEHIND_CSS.slice(LEAVE_BEHIND_CSS.indexOf("@media print"));
    expect(print).toContain(
      `body > *:not(#${LEAVE_BEHIND_PRINT_ID}) { display: none !important; }`,
    );
    expect(print).toContain(`#${LEAVE_BEHIND_PRINT_ID} { display: block !important; }`);
    // And on the screen the full-size copy is never seen.
    const screen = LEAVE_BEHIND_CSS.slice(0, LEAVE_BEHIND_CSS.indexOf("@media print"));
    expect(screen).toContain(`#${LEAVE_BEHIND_PRINT_ID} { display: none; }`);
  });
  it("the site's text size and the dark theme do not reach the paper", () => {
    // Inches and points only: a rem or an em would follow the Larger text setting.
    const rules = LEAVE_BEHIND_CSS.replace(/@font-face[^}]+}/g, "").replace(
      /@media \(max-width: 480px\)/,
      "",
    );
    expect(rules).not.toMatch(/\d(rem|vw|vh)\b/);
    expect(rules).not.toMatch(/\d(?<!0\.\d{1,3})em\b(?!;? *letter)/);
    // Its colours are its own: none of the site's theme colours.
    expect(LEAVE_BEHIND_CSS).not.toMatch(/var\(--(?!lb-)/);
    expect(LEAVE_BEHIND_CSS).toContain("background: #fff; color: var(--lb-ink);");
    expect(LEAVE_BEHIND_CSS).toContain("print-color-adjust: exact;");
  });
  it("the faces are the flyer's, and nothing is fetched from another site to print", () => {
    expect(LEAVE_BEHIND_CSS).toContain('"Barlow Condensed"');
    expect(LEAVE_BEHIND_CSS.match(/@font-face/g)).toHaveLength(3);
    expect(LEAVE_BEHIND_CSS).not.toMatch(/https?:\/\//);
    const src = read("src/components/leave-behind-sheet.tsx");
    expect(src).not.toMatch(/https?:\/\//);
    expect(src).toContain('src="/jbk-logo.webp"');
  });
});

describe("a fuller side is set smaller until it fits", () => {
  const src = read("src/components/leave-behind-sheet.tsx").replace(/\s+/g, " ");
  it("three smaller steps, each one tighter than the last", () => {
    expect(SHEET_FIT_MAX).toBe(3);
    const size = (rule: string, name: string) => {
      const m = new RegExp(`${rule} \\{[^}]*--lb-${name}: ([\\d.]+)(pt|in)`).exec(
        LEAVE_BEHIND_CSS.replace(/\s+/g, " "),
      );
      expect(m, `${rule} ${name}`).not.toBeNull();
      return Number(m![1]);
    };
    for (const name of ["li", "li-gap", "pitch", "svc-pad", "svc-name", "svc-p"]) {
      const steps = [
        size("\\.lb-page", name),
        size("\\.lb-fit-1", name),
        size("\\.lb-fit-2", name),
        size("\\.lb-fit-3", name),
      ];
      for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
      // Still readable on paper at the smallest step.
      if (name === "li" || name === "svc-p") expect(steps[3]!).toBeGreaterThanOrEqual(8);
    }
  });
  it("a side drawn a step smaller carries the step, and the other side does not", () => {
    const html = renderToStaticMarkup(
      createElement(LeaveBehindPages, {
        ...urls(),
        numbers: NUMBERS,
        services: DEFAULT_SERVICES,
        fit: { front: 0, back: 2 },
      }),
    );
    expect(html).toContain('<section class="lb-page" data-sheet-side="front">');
    expect(html).toContain('<section class="lb-page lb-fit-2" data-sheet-side="back">');
    // With no step asked for, both sides are at full size.
    expect(draw(DEFAULT_SERVICES)).not.toContain("lb-fit-");
  });
  it("the screen copy is measured and both copies take the step", () => {
    expect(src).toContain('const front = tooFull(el, "front");');
    expect(src).toContain('const back = tooFull(el, "back");');
    expect(src).toContain("front ? Math.min(fit.front + 1, SHEET_FIT_MAX) : fit.front");
    expect(src).toContain("back ? Math.min(fit.back + 1, SHEET_FIT_MAX) : fit.back");
    expect(src.match(/<LeaveBehindPages \{\.\.\.props\} fit=\{fit\} \/>/g)).toHaveLength(2);
    // It starts again from full size when what is printed changes, or the faces arrive.
    expect(src).toContain("const what = JSON.stringify([props.numbers, props.services, faces]);");
    expect(src).toContain(
      "const fit = fitted.what === what ? fitted : { what, front: 0, back: 0, full: false };",
    );
  });
  it("still too full at the smallest step: the page says so, in plain words", () => {
    expect(src).toContain(
      "full: (front && fit.front >= SHEET_FIT_MAX) || (back && fit.back >= SHEET_FIT_MAX),",
    );
    expect(src).toContain("{fit.full && (");
    expect(src).toContain("{SHEET_TOO_FULL}");
    expect(SHEET_TOO_FULL).toBe(
      "The sheet is too full to print whole: the last lines run off the paper. Shorten the services list or its names.",
    );
  });
});

describe("Setup › QR pages prints this sheet", () => {
  const page = read("src/components/public-forms-setup.tsx").replace(/\s+/g, " ");
  it("the card shows the sheet with the saved plans, services and codes", () => {
    expect(page).toContain("<LeaveBehind");
    expect(page).toContain("numbers={benefits.data ?? null}");
    expect(page).toContain("services={s.services}");
    expect(page).toContain('careUrl={sheets.find((x) => x.key === "care")?.url ?? ""}');
    expect(page).toContain('requestUrl={sheets.find((x) => x.key === "request")?.url ?? ""}');
    expect(page).toContain("{SHEET_NO_PRICE_NOTE}");
  });
  it("one Print button, and the plain sheets are gone", () => {
    expect(page.match(/data-action="qr-print"/g)).toHaveLength(1);
    expect(page).toContain("{SHEET_PRINT_BUTTON}");
    expect(SHEET_PRINT_BUTTON).toBe("Print the sheet, front and back");
    expect(page).toContain("{SHEET_PRINT_NOTE}");
    expect(SHEET_PRINT_NOTE).toContain("printed on both sides");
    expect(page).not.toContain("data-qr-sheet");
    expect(page).not.toContain("PRINT_CSS");
    expect(page).not.toContain("Print the two sheets");
  });
  it("each code can still be saved as a picture by itself", () => {
    expect(page).toContain('data-action="qr-download"');
    expect(page).toContain("onClick={() => downloadPng(sheet)}");
  });
  it("a list too long for the paper is said beside the sheet", () => {
    expect(page).toContain("sheetServicesLeftOut(");
    expect(page).toContain("data-sheet-left-out");
  });
});
