import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TICKET_STAGE_HINT, autoSiteId, siteProblem, siteRequiredMessage } from "./ticket-form";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("siteProblem — a ticket names the site when the customer has several (owner, Oct 1)", () => {
  it("several sites and none picked: the message names the count", () => {
    expect(siteProblem({ siteCount: 3, site_id: null })).toBe(
      "Pick the property — this customer has 3",
    );
    expect(siteProblem({ siteCount: 2, site_id: undefined })).toBe(siteRequiredMessage(2));
    expect(siteProblem({ siteCount: 2, site_id: "" })).toBe(siteRequiredMessage(2));
  });
  it("a site picked, or zero / one site, is fine", () => {
    expect(siteProblem({ siteCount: 3, site_id: "s1" })).toBeNull();
    expect(siteProblem({ siteCount: 1, site_id: null })).toBeNull();
    expect(siteProblem({ siteCount: 0, site_id: null })).toBeNull();
  });
});

describe("autoSiteId — one site is picked without asking", () => {
  it("only when there is exactly one", () => {
    expect(autoSiteId([{ id: "s1" }])).toBe("s1");
    expect(autoSiteId([])).toBeNull();
    expect(autoSiteId([{ id: "s1" }, { id: "s2" }])).toBeNull();
  });
});

describe("the footer hint", () => {
  it("reads as the owner worded it", () => {
    expect(TICKET_STAGE_HINT).toBe("Scheduled once a technician is set, otherwise Open.");
  });
});

describe("saveServiceJob refuses a multi-site customer without a site", () => {
  const src = read("./service.functions.ts");
  it("counts the customer's live sites and applies siteProblem", () => {
    expect(src).toMatch(
      /import \{ siteProblem(, TICKET_DESCRIPTION_MAX)? \} from "@\/lib\/ticket-form"/,
    );
    expect(src).toMatch(
      /count: "exact", head: true \}\)\s*\.eq\("account_id", fields\.account_id\)\s*\.is\("deleted_at", null\)/,
    );
    expect(src).toContain("siteProblem({ siteCount: count ?? 0, site_id: null })");
  });
});

describe("the ticket form (service-page.tsx) after the Oct 1 clean-up", () => {
  const src = read("../components/service-page.tsx");
  it("B1: no week grid and no 'Change on the week grid' toggle", () => {
    expect(src).not.toContain("AssignGrid");
    expect(src).not.toContain("Change on the week grid");
  });
  it("B2/B3: one customer block with the site box and the site contact; no right-hand card", () => {
    expect(src).toContain("function CustomerBlock(");
    expect(src).not.toContain("function CustomerCard(");
    const block = src.slice(src.indexOf("function CustomerBlock("));
    expect(block.indexOf("<SiteSelect")).toBeGreaterThan(0);
    expect(block.indexOf("<ContactSelect")).toBeGreaterThan(block.indexOf("<SiteSelect"));
    expect(block).toContain('aria-label="Change the customer"');
  });
  it("A: the site rule disables Create / Save and shows under the site box", () => {
    expect(src).toContain("siteProblem({ siteCount, site_id: draft.customer.site_id })");
    expect(src).toMatch(/dateMissing \|\| !!siteMessage/);
    expect(src).toContain("{props.siteMessage}");
  });
  it("B4: the $ / hour box and '+' wait for a technician", () => {
    expect(src).toContain("const showRate = !!crew && !!draft.technician_id;");
    expect(src).toContain("{crew && showRate && (");
  });
  it("B5/B8: Type, Date and Labor rate sit together above the technician; the label is plain 'Date'", () => {
    const row = src.slice(src.indexOf('<Label htmlFor="ticket-type">'));
    const end = row.indexOf('<Label htmlFor="ticket-tech">');
    const between = row.slice(0, end);
    expect(between).toContain('<Label htmlFor="ticket-rate">Labor rate</Label>');
    expect(between).toContain('<Label htmlFor="ticket-date">Date</Label>');
    expect(src).not.toContain("(any day)");
  });
  it("B6: Notes start at two rows and grow", () => {
    expect(src).toMatch(/<AutoTextarea\s+id="ticket-notes"\s+rows=\{2\}/);
  });
  it("B7: the footer hint is the constant", () => {
    expect(src).toContain("{TICKET_STAGE_HINT}");
    expect(src).not.toContain("Saved as Scheduled when a technician and a date are set");
  });
  it("keeps the folded CenterPoint numbers", () => {
    expect(src).toContain("CenterPoint numbers");
  });
});

describe("the tighter layout (owner, Oct 1): two columns for the office, one for a technician", () => {
  const src = read("../components/service-page.tsx");
  const constBody = (name: string) => {
    const start = src.indexOf(`const ${name} = `);
    expect(start).toBeGreaterThan(0);
    return src.slice(start, src.indexOf("\n  );\n", start));
  };
  const form = src.slice(src.indexOf("<form"), src.indexOf("</form>"));

  it("the form widens to max-w-5xl for the office (the pane's width beside the sections) and stays max-w-3xl for a technician", () => {
    expect(form).toContain(
      'className={`${isTech ? "max-w-3xl" : twoPane ? "max-w-5xl xl:max-w-none" : "max-w-5xl"} space-y-5`}',
    );
  });

  it("an md:grid-cols-2 grid holds the customer (left) and type / date / labor / technician (right)", () => {
    const at = form.indexOf('<div className="grid gap-5 md:grid-cols-2');
    expect(at).toBeGreaterThan(0);
    const grid = form.slice(at, form.indexOf("{customerContact}", at));
    expect(grid.indexOf("{customerField}")).toBeGreaterThan(0);
    expect(grid.indexOf("{whatAndWhen}")).toBeGreaterThan(grid.indexOf("{customerField}"));
    // Description, PO / Job #, notes and CenterPoint are outside it.
    for (const piece of [
      "{descriptionAndNumbers}",
      "{notesField}",
      "{centerPointNumbers}",
      "ticket-description",
      "ticket-po",
      "ticket-notes",
    ]) {
      expect(grid).not.toContain(piece);
    }
  });

  it("the left column is the customer block only; the right is Type, Date, Labor rate, Technician", () => {
    const customer = constBody("customerField");
    expect(customer).toContain("<CustomerBlock");
    expect(customer).toContain('id="ticket-customer"');
    for (const id of [
      "ticket-type",
      "ticket-date",
      "ticket-tech",
      "ticket-description",
      "ticket-po",
    ]) {
      expect(customer).not.toContain(`"${id}"`);
    }
    const right = constBody("whatAndWhen");
    const order = [
      '<Label htmlFor="ticket-type">',
      '<Label htmlFor="ticket-date">',
      '<Label htmlFor="ticket-rate">',
      '<Label htmlFor="ticket-tech">',
    ].map((l) => right.indexOf(l));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The crew rows stay a manager's inside the dispatcher's box (owner, Oct 1 / Oct 9).
    expect(right).toContain("{manager && crewRows}");
    expect(right).not.toContain("ticket-description");
    expect(right).not.toContain("ticket-notes");
  });

  it("below the columns, full width: description and PO / Job #, notes, CenterPoint, then Create", () => {
    const office = form.slice(form.indexOf("md:grid-cols-2"));
    const seq = [
      "{descriptionAndNumbers}",
      "{notesField}",
      "{centerPointNumbers}",
      "{TICKET_STAGE_HINT}",
    ].map((p) => office.indexOf(p));
    expect(seq.every((i) => i > 0)).toBe(true);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
    const desc = constBody("descriptionAndNumbers");
    expect(desc.indexOf('id="ticket-po"')).toBeGreaterThan(desc.indexOf('id="ticket-description"'));
  });

  it("a technician keeps the single column in the old order", () => {
    const tech = form.slice(form.indexOf("{isTech ? ("), form.indexOf(") : ("));
    expect(tech).not.toContain("grid-cols");
    const seq = [
      "{customerField}",
      "{customerContact}",
      "{descriptionAndNumbers}",
      "{whatAndWhen}",
      "{centerPointNumbers}",
      "{notesField}",
    ].map((p) => tech.indexOf(p));
    expect(seq.every((i) => i > 0)).toBe(true);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
  });
});

describe("the folding sections on the right (owner, Oct 1: 'the menus that open … would go on the right')", () => {
  const src = read("../components/service-page.tsx");
  const fieldSrc = read("../components/service/ticket-field-sections.tsx");
  const at = src.indexOf("{twoPane && job ? (");
  const panes = src.slice(at, src.indexOf(") : (", at));

  it("only the office on a saved ticket gets two panes", () => {
    expect(src).toContain("const twoPane = officeOrAdmin && !!job;");
    expect(at).toBeGreaterThan(0);
  });

  it("an xl: two-pane grid: the form in the first pane, the sections column (≥ 380 px) in the second", () => {
    // Since Oct 6 the classes are constants, switched by the layout toggle (side by default).
    expect(panes).toContain("<div className={stacked ? STACKED_PANES : SIDE_PANES}>");
    const grid = src.match(/const SIDE_PANES =\s*"([^"]*xl:grid[^"]*)";/);
    expect(grid).not.toBeNull();
    expect(grid![1]).toContain("xl:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)]");
    expect(grid![1]).toContain("xl:items-start");
    const formAt = panes.indexOf("{ticketForm}");
    const asideAt = panes.indexOf("<aside");
    expect(formAt).toBeGreaterThan(0);
    expect(asideAt).toBeGreaterThan(formAt);
    const aside = panes.slice(asideAt, panes.indexOf("</aside>"));
    expect(aside).toContain("className={stacked ? STACKED_ASIDE : SIDE_ASIDE}");
    expect(src).toContain(
      'const SIDE_ASIDE = "min-w-0 space-y-4 xl:sticky xl:top-4 xl:min-w-[380px]";',
    );
    expect(aside).not.toContain("{ticketForm}");
  });

  it("the column's order: Aerial, Inspection, Repairs, Materials, the rest of the field sections, Invoice — the Done ticket's Needs authorization card first (Oct 9)", () => {
    const aside = panes.slice(panes.indexOf("<aside"), panes.indexOf("</aside>"));
    const seq = [
      "<AerialSection",
      "<InspectionSection",
      "<TicketRepairs",
      "{materials}",
      "<TicketFieldSections",
      '{jobStage !== "done" && <InvoiceBlock',
    ].map((p) => aside.indexOf(p));
    expect(aside.indexOf('{jobStage === "done" && <InvoiceBlock')).toBeLessThan(seq[0]!);
    expect(seq.every((i) => i > 0)).toBe(true);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
    // Repairs (with the photos) is not repeated by TicketFieldSections in the column.
    expect(aside).toContain("repairs={false}");
    expect(fieldSrc).toContain("{repairs && <RepairsReadOnly jobId={job.id}");
    expect(fieldSrc).toContain("export function TicketRepairs(");
    // Materials is the section the materials const renders.
    const materials = src.slice(
      src.indexOf("const materials ="),
      src.indexOf("return (", src.indexOf("const materials =")),
    );
    expect(materials).toContain("<MaterialsSection");
  });

  it("Close out stays a header button, not in the column", () => {
    expect(panes).not.toContain("closeout: 1");
    expect(src.indexOf("closeout: 1")).toBeLessThan(at);
  });

  it("a technician keeps the stack below the form", () => {
    const rest = src.slice(src.indexOf(") : (", at), src.indexOf("<AlertDialog", at));
    const seq = ["{ticketForm}", "<TicketExtras", "{materials}", "<TicketFieldSections"].map((p) =>
      rest.indexOf(p),
    );
    expect(seq.every((i) => i > 0)).toBe(true);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
  });
});

describe("the Aerial picture is capped at about half the screen (owner, Oct 1)", () => {
  const src = read("../components/service/aerial-markup.tsx");
  const stage = src.slice(src.indexOf("function Stage("), src.indexOf("function AreaDraft("));

  it("the picture's container has max-h-[min(60vh,560px)] on the dark ground", () => {
    // Since Oct 8 the picture's own box (relative, for the tag menu and text box overlays)
    // sits between the container and the SVG.
    const box = stage.match(
      /<div className="([^"]*)">\s*\{\/\*[\s\S]*?\*\/\}\s*<div\s+className="relative mx-auto"/,
    );
    expect(box).not.toBeNull();
    expect(box![1]).toContain("max-h-[min(60vh,560px)]");
    expect(box![1]).toContain("overflow-hidden");
    expect(box![1]).toContain("bg-neutral-800");
  });

  it("the SVG keeps the view's 4:3 shape, centred, its width capped to the cap height × 4 / 3", () => {
    // The cap × 4 / 3 width is on the picture's box; the SVG fills it (Oct 8).
    expect(stage).toContain('className="block h-auto w-full touch-none select-none"');
    expect(stage).toContain("aspectRatio: `${view.width} / ${view.height}`");
    expect(stage).toContain(
      "maxWidth: `min(100%, calc((min(60vh, 560px) - 2px) * ${view.width / view.height}))`",
    );
    expect(stage).toMatch(/className="relative mx-auto"/);
  });

  it("pointer math goes through screenToView / screenScale", () => {
    expect(stage).toContain("return screenToView(r, view, e.clientX, e.clientY);");
    expect(stage).toContain("const k = screenScale(r, view);");
    expect(stage).not.toContain("/ r.width");
  });
});
