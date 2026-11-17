/**
 * Save stays in reach (owner, Nov 17): "can we have this be a button to the left of the save
 * button that you can click and it pops up those forms. also would it be too much trouble to
 * have this on the bids when you scroll down to where it goes off screen it stays at the top so
 * wherever you are editing you can also navigate the bid and save it? can you also make the save
 * button on service behave the same way it does on the trade bids when you scrolled. I like how
 * you did that on trade bids and want to implement that broadly."
 *
 * Three things, pinned to their source here (what the bars look like in a window is the browser
 * run's, docs/qa/trade-bids-2026-11-16.md):
 *  1. One bar for every screen that has a Save (save-bar.tsx): the trade bid, the trade setup
 *     and the service ticket use it.
 *  2. A trade bid's rates and lines are a popup behind a button in that bar, left of Save.
 *  3. A project bid's steps, Save and Update stay at the top of the window.
 */
import { readFileSync } from "node:fs";

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SAVE_BAR_ACTIONS, SAVE_BAR_CLASS, SAVE_BAR_VAR, SaveBar } from "@/components/save-bar";
import { listOpenAt } from "@/lib/trade-bid-form";

const read = (path: string) => readFileSync(path, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const BAR = read("src/components/save-bar.tsx");
const BID = read("src/components/trade/trade-bid-screen.tsx");
const SETUP = read("src/components/trade/trade-setup-screen.tsx");
const TICKET = read("src/components/service-page.tsx");
const PHOTOS = read("src/components/service/photo-select-bar.tsx");
const ESTIMATE = read("src/routes/estimate.tsx");
const OPP = read("src/components/opportunities-page.tsx");

describe("the bar that keeps Save in reach", () => {
  it("stays at the bottom of the window, over the page, clear of the iPhone's home indicator", () => {
    const cls = SAVE_BAR_CLASS.split(" ");
    for (const c of ["sticky", "bottom-0", "z-10", "flex", "flex-wrap", "justify-between"])
      expect(cls).toContain(c);
    expect(cls).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
    // Nothing of the page shows through it where it lies over the form.
    expect(cls).toContain("bg-background/95");
    expect(cls).toContain("backdrop-blur");
    // The buttons are one group: on a phone they wrap together under the words.
    expect(SAVE_BAR_ACTIONS.split(" ")).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "justify-end"]),
    );
  });

  it("draws what it is given inside one marked box", () => {
    const html = renderToString(
      React.createElement(SaveBar, null, React.createElement("p", null, "All changes are saved.")),
    );
    expect(html).toBe(
      `<div class="${SAVE_BAR_CLASS}" data-save-bar="true"><p>All changes are saved.</p></div>`,
    );
  });

  it("keeps its height on the page while it is shown, and takes it away when it goes", () => {
    expect(SAVE_BAR_VAR).toBe("--jbk-save-bar");
    expect(flat(BAR)).toContain(
      "page.style.setProperty(SAVE_BAR_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`)",
    );
    // It follows the bar as the words wrap, and leaves nothing behind on the next screen.
    expect(BAR).toContain("new ResizeObserver(keep)");
    expect(flat(BAR)).toContain(
      "return () => { watch?.disconnect(); page.style.removeProperty(SAVE_BAR_VAR); };",
    );
  });

  it("the selected-photos bar of a ticket sits above it, never under it", () => {
    expect(PHOTOS).toContain("bottom-[calc(0.5rem+var(--jbk-save-bar,0px))]");
    expect(PHOTOS).not.toContain("sticky bottom-2 ");
  });

  it("no screen writes the bar's classes by hand any more", () => {
    for (const src of [BID, SETUP, TICKET, OPP]) {
      expect(src).toContain('from "@/components/save-bar"');
      expect(src).toContain("<SaveBar>");
      expect(src).not.toContain("sticky bottom-0");
    }
  });
});

describe("a trade bid: Rates and lines is a button beside Save", () => {
  const bar = BID.slice(BID.indexOf("<SaveBar>"), BID.indexOf("</SaveBar>"));
  const dialog = BID.slice(
    BID.indexOf("<Dialog open={ratesOpen}"),
    BID.indexOf("</Dialog>", BID.indexOf("<Dialog open={ratesOpen}")),
  );

  it("the button is in the bar, before Save, and opens the popup", () => {
    const rates = bar.indexOf("data-open-rates");
    const save = bar.indexOf("data-save\n");
    expect(rates).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(rates);
    expect(flat(bar)).toContain("data-open-rates onClick={() => setRatesOpen(true)}");
    expect(bar).toContain("Rates and lines");
    // Both sit in the one group on the right.
    expect(bar).toContain("<div className={SAVE_BAR_ACTIONS}>");
  });

  it("the folding section at the foot of the page is gone", () => {
    expect(BID).not.toContain("Collapsible");
    expect(BID.match(/<TradeLinesEditor/g)).toHaveLength(1);
    expect(dialog).toContain("<TradeLinesEditor");
  });

  it("the popup edits the bid on screen: the same setup, the same Save, the same mistakes counted", () => {
    expect(dialog.length).toBeGreaterThan(300);
    expect(dialog).toContain("value={draft.data.setup}");
    expect(dialog).toContain("onChange={setSetup}");
    expect(dialog).toContain("disabled={locked}");
    expect(dialog).toContain("onInvalidChange={setBadRates}");
    // It has no Save of its own: Done closes it and the bid's Save saves.
    expect(dialog).not.toContain("trySave");
    expect(flat(dialog)).toContain("data-rates-done onClick={() => setRatesOpen(false)}");
    expect(dialog).toContain("Change this bid&apos;s rates and lines");
    expect(dialog).toContain("Only this bid changes. The ${tradeName} setup stays as it is.");
  });

  it("the popup fits a phone and a wide screen, and scrolls inside itself", () => {
    expect(dialog).toContain(
      'className="flex max-h-[92svh] w-[calc(100vw-1rem)] max-w-6xl flex-col gap-0 p-0"',
    );
    expect(dialog).toContain('className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"');
    // The price is in sight while the rates are changed.
    expect(flat(dialog)).toContain("{fmtMoney(result.price)}");
  });
});

describe("the popup and the keyboard", () => {
  const el = (attrs: Record<string, string>) => ({
    getAttribute: (name: string) => attrs[name] ?? null,
  });

  it("Escape in an open list closes the list, not the popup (found in the browser run)", () => {
    expect(listOpenAt(el({ role: "combobox", "aria-expanded": "true" }))).toBe(true);
    // A closed list, a plain box, nothing in focus: Escape closes the popup as usual.
    expect(listOpenAt(el({ role: "combobox", "aria-expanded": "false" }))).toBe(false);
    expect(listOpenAt(el({ role: "combobox" }))).toBe(false);
    expect(listOpenAt(el({}))).toBe(false);
    expect(listOpenAt(null)).toBe(false);
    expect(flat(BID)).toContain(
      "onEscapeKeyDown={(e) => { if (listOpenAt(document.activeElement)) e.preventDefault(); }}",
    );
  });

  it("opening it does not select the first box (a key pressed next would wipe a name)", () => {
    expect(flat(BID)).toContain(
      "onOpenAutoFocus={(e) => { e.preventDefault(); if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus(); }}",
    );
  });
});

describe("a service ticket: Save is in the bar, not at the foot of the form", () => {
  const form = TICKET.slice(TICKET.indexOf("const ticketForm ="), TICKET.indexOf("</form>"));
  const bar = TICKET.slice(TICKET.indexOf("const saveBar ="), TICKET.indexOf("const ticketForm ="));

  it("the form has a name and no button of its own", () => {
    expect(TICKET).toContain("const formId = useId();");
    expect(flat(form)).toContain("<form id={formId} className=");
    expect(form).not.toContain("<Button");
    expect(form).not.toContain('type="submit"');
  });

  it("the bar's button submits that form, so Enter in a box and the button are one and the same", () => {
    expect(flat(bar)).toContain(
      '<Button type="submit" form={formId} className="h-10 min-w-24" data-save',
    );
    expect(bar).toContain('{job ? "Save" : "Create ticket"}');
    expect(TICKET.match(/submit\(\);/g)).toHaveLength(1);
  });

  it("Save is off exactly when it was", () => {
    expect(flat(bar)).toContain(
      "fieldPage ? save.isPending || !dirty : save.isPending || (!!job && !dirty && !crewDirty) || dateMissing || !!siteMessage",
    );
  });

  it("the words say where the ticket stands, as a trade bid's do", () => {
    expect(TICKET).toContain("const unsaved = fieldPage ? dirty : dirty || crewDirty;");
    expect(bar).toContain("<p>You have changes that are not saved.</p>");
    expect(bar).toContain('<p className="text-muted-foreground">All changes are saved.</p>');
    expect(bar).toContain("{TICKET_STAGE_HINT}");
  });

  it("someone who may only read the ticket has no bar", () => {
    expect(bar).toContain("const saveBar = !ro && (");
  });

  it("the bar is the last thing on the page, after the form and the sections, in every layout", () => {
    const page = TICKET.slice(TICKET.indexOf("<FoldAllContext.Provider"));
    const end = page.indexOf("</FoldAllContext.Provider>");
    const at = page.indexOf("{saveBar}");
    expect(at).toBeGreaterThan(end);
    expect(TICKET.match(/\{saveBar\}/g)).toHaveLength(1);
    expect(page.indexOf("<AlertDialog")).toBeGreaterThan(at);
  });
});

describe("an opportunity: Save is in the bar, as on a ticket", () => {
  const form = OPP.slice(OPP.indexOf("const oppForm ="), OPP.indexOf("</form>"));
  const bar = OPP.slice(OPP.indexOf("const saveBar ="), OPP.indexOf("const oppForm ="));

  it("the form has a name and no button of its own; the bar's button submits it", () => {
    expect(OPP).toContain("const formId = useId();");
    expect(flat(form)).toContain('<form id={formId} className="space-y-5"');
    expect(form).not.toContain('type="submit"');
    expect(flat(bar)).toContain(
      '<Button type="submit" form={formId} className="h-10 min-w-24" data-save',
    );
    expect(bar).toContain('{opp ? "Save" : "Create opportunity"}');
  });

  it("Save is off exactly when it was", () => {
    expect(flat(bar)).toContain(
      "save.isPending || (!!opp && !dirty) || (!!opp && !draft.expected_close) || !!assigneeMessage || !!customerMessage || !!siteMessage",
    );
  });

  it("the words: the reminder hint on a new one, then where the opportunity stands", () => {
    expect(bar).toContain('data-hint="create-reminders"');
    expect(bar).toContain("<p>You have changes that are not saved.</p>");
    expect(bar).toContain('<p className="text-muted-foreground">All changes are saved.</p>');
  });

  it("the bar comes after the form and the timeline, and before the phone's Delete", () => {
    const page = OPP.slice(OPP.indexOf('aria-label="Follow-up and contact"'));
    const at = page.indexOf("{saveBar}");
    expect(at).toBeGreaterThan(-1);
    expect(page.indexOf('data-delete="phone"')).toBeGreaterThan(at);
  });
});

describe("a project bid: the steps, Save and Update stay at the top of the window", () => {
  const at = ESTIMATE.indexOf("data-bid-bar");
  const bar = ESTIMATE.slice(
    ESTIMATE.lastIndexOf("<div", at),
    ESTIMATE.indexOf('data-bid-step="setup"'),
  );

  it("the bar sticks to the top, over the page, below the iPhone's status bar", () => {
    expect(at).toBeGreaterThan(-1);
    expect(flat(bar)).toContain(
      '<div className="sticky top-[var(--jbk-top-gap,0px)] z-20 rounded-md bg-background" data-bid-bar >',
    );
  });

  it("it holds every step, the checks, Save and Update pricing & labor", () => {
    expect(bar).toContain("{STEPS.map((st, i) => {");
    expect(bar).toContain("onClick={() => goStep(i)}");
    expect(bar).toContain("{sanityWarnings.length} check");
    expect(bar).toContain("onClick={() => void handleSave()}");
    expect(bar).toContain("Update pricing &amp; labor");
  });

  it("on a phone the steps are one row that slides sideways, so the bar stays short", () => {
    expect(bar).toContain(
      'className="flex items-center gap-1.5 max-md:w-0 max-md:min-w-full max-md:overflow-x-auto md:contents"',
    );
    expect(bar).toContain("shrink-0 whitespace-nowrap rounded-md px-4 py-2");
  });

  it("the step shown is marked for a screen reader", () => {
    expect(bar).toContain('aria-current={step === i ? "step" : undefined}');
  });

  it("on a phone the step shown is slid into sight", () => {
    expect(flat(ESTIMATE)).toContain(
      "const tab = strip?.querySelector<HTMLElement>('[aria-current=\"step\"]');",
    );
    expect(flat(ESTIMATE)).toContain(
      "strip.scrollTo({ left: Math.max(0, left - (strip.clientWidth - tab.offsetWidth) / 2) }); }, [step]);",
    );
    // Only the row slides (its own scrollTo): the page itself is never scrolled by it.
    expect(flat(ESTIMATE)).toContain(
      "if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return;",
    );
  });

  it("it is above the page and below every popup and menu", () => {
    // Popups, menus and the pickers are z-50; the phone's Bid total strip is z-20 at the bottom.
    expect(bar).toContain(" z-20 ");
    expect(bar).not.toMatch(/z-(?:30|40|50)\b/);
  });
});
