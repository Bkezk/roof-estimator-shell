/**
 * The folds on a customer's page (owner, Oct 15: "on the customers page lets make these
 * collapsible so if there's 100 tickets it won't take up the whole page"). The rules
 * (lib/customer-folds.ts) are checked directly; the page and the header (customers-page.tsx,
 * section-fold.tsx, property-page.tsx) from their source. Fails on the old code: every section
 * always open, nothing remembered.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CUSTOMER_FOLDS_STORAGE_KEY,
  FOLD_OPEN_MAX,
  FOLD_SECTIONS,
  PROPERTY_FOLDS_STORAGE_KEY,
  defaultOpen,
  foldsKey,
  isFoldOpen,
  normalizeFolds,
  readFolds,
  toggleFold,
  writeFolds,
} from "@/lib/customer-folds";

const read = (p: string) => readFileSync(p, "utf8");
const src = (p: string) => read(p).replace(/\s+/g, " ");

/** An in-memory Storage. */
function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}
const U = "user-1";

describe("the default fold", () => {
  it("Properties always start open, whatever the count", () => {
    expect(defaultOpen("properties", 0)).toBe(true);
    expect(defaultOpen("properties", 100)).toBe(true);
  });
  it("every other section opens while it has ten rows or fewer, and folds past that", () => {
    expect(FOLD_OPEN_MAX).toBe(10);
    for (const s of FOLD_SECTIONS.filter((x) => x !== "properties")) {
      expect(defaultOpen(s, 0)).toBe(true);
      expect(defaultOpen(s, 3)).toBe(true);
      expect(defaultOpen(s, 10)).toBe(true);
      expect(defaultOpen(s, 11)).toBe(false);
      expect(defaultOpen(s, 100)).toBe(false);
    }
  });
  it("a count not known yet (still loading) leaves it open", () => {
    expect(defaultOpen("takeoffs", null)).toBe(true);
    expect(defaultOpen("contacts", undefined)).toBe(true);
  });
});

describe("what the user set wins", () => {
  it("isFoldOpen: the stored value, else the default", () => {
    expect(isFoldOpen({}, "tickets", 100)).toBe(false);
    expect(isFoldOpen({ tickets: true }, "tickets", 100)).toBe(true);
    expect(isFoldOpen({ tickets: false }, "tickets", 3)).toBe(false);
    expect(isFoldOpen({ properties: false }, "properties", 1)).toBe(false);
    expect(isFoldOpen({ bids: true }, "tickets", 100)).toBe(false);
  });
  it("toggleFold sets one section and keeps the rest", () => {
    expect(toggleFold({ tickets: false }, "bids", true)).toEqual({ tickets: false, bids: true });
    expect(toggleFold({ tickets: false }, "tickets", true)).toEqual({ tickets: true });
  });
});

describe("the browser's copy", () => {
  it("is per user and per page", () => {
    expect(foldsKey("customer", U)).toBe(`${CUSTOMER_FOLDS_STORAGE_KEY}:${U}`);
    expect(foldsKey("property", U)).toBe(`${PROPERTY_FOLDS_STORAGE_KEY}:${U}`);
    expect(CUSTOMER_FOLDS_STORAGE_KEY).toBe("jbk-portal:customer-folds");
    expect(PROPERTY_FOLDS_STORAGE_KEY).toBe("jbk-portal:property-folds");
    const st = memStorage();
    writeFolds(st, "customer", U, { tickets: false });
    writeFolds(st, "customer", "user-2", { tickets: true });
    writeFolds(st, "property", U, { bids: false });
    expect(readFolds(st, "customer", U)).toEqual({ tickets: false });
    expect(readFolds(st, "customer", "user-2")).toEqual({ tickets: true });
    expect(readFolds(st, "property", U)).toEqual({ bids: false });
  });
  it("reads junk as nothing set: bad JSON, an array, wrong types, unknown sections, no storage", () => {
    const k = foldsKey("customer", U);
    expect(readFolds(memStorage({ [k]: "{not json" }), "customer", U)).toEqual({});
    expect(readFolds(memStorage({ [k]: "[true]" }), "customer", U)).toEqual({});
    expect(readFolds(memStorage({ [k]: "null" }), "customer", U)).toEqual({});
    expect(
      readFolds(
        memStorage({ [k]: JSON.stringify({ tickets: "no", bids: 1, old: true, tasks: false }) }),
        "customer",
        U,
      ),
    ).toEqual({ tasks: false });
    expect(readFolds(null, "customer", U)).toEqual({});
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readFolds(throwing, "customer", U)).toEqual({});
    expect(() => writeFolds(throwing, "customer", U, { tickets: false })).not.toThrow();
    expect(normalizeFolds(42)).toEqual({});
  });
  it("writes only clean values and clears the entry when nothing is set", () => {
    const st = memStorage();
    writeFolds(st, "customer", U, { tickets: false, junk: true } as never);
    expect(JSON.parse(st.map.get(foldsKey("customer", U))!)).toEqual({ tickets: false });
    writeFolds(st, "customer", U, {});
    expect(st.map.has(foldsKey("customer", U))).toBe(false);
  });
});

describe("the customer's page (source)", () => {
  const page = read("src/components/customers-page.tsx");
  const fn = (name: string, next: string) =>
    page.slice(page.indexOf(`function ${name}(`), page.indexOf(`function ${next}(`));
  const sections: Array<[string, string, string]> = [
    ["ContactsSection", "ContactForm", "contacts"],
    ["SitesSection", "TicketsSection", "properties"],
    ["TicketsSection", "OpportunitiesSection", "tickets"],
    ["OpportunitiesSection", "TasksSection", "opportunities"],
    ["TasksSection", "TakeoffsSection", "tasks"],
    ["TakeoffsSection", "BidsSection", "takeoffs"],
    ["BidsSection", "\u0000", "bids"],
  ];
  it("every section folds through the shared helper and header, count in the header", () => {
    for (const [name, next, section] of sections) {
      const body =
        next === "\u0000" ? page.slice(page.indexOf(`function ${name}(`)) : fn(name, next);
      expect(body, name).toMatch(new RegExp(`useSectionFold\\([^)]*"${section}"`));
      expect(body, name).toContain("<FoldHeader");
      expect(body, name).toContain("open={fold.open}");
      expect(body, name).toContain("onToggle={fold.toggle}");
      // The old always-open heading is gone.
      expect(body, name).not.toContain('<h2 className="flex items-center gap-2 font-semibold">');
    }
    // The section cards keep their frame; since Oct 21 each stands on its own tint (section-tints.ts).
    expect(page).toContain('<section className={sectionClass("tickets")} aria-label="Tickets">');
    expect(page).toContain(
      '<section className={sectionClass("properties")} aria-label="Properties">',
    );
  });
  it("the sections' buttons sit beside the toggle (the header's children), and open the fold they add into", () => {
    const flat = (s: string) => s.replace(/\s+/g, " ");
    const sites = fn("SitesSection", "TicketsSection");
    expect(sites).toContain('{!readOnly && editing !== "new" && (');
    expect(sites.indexOf('{!readOnly && editing !== "new" && (')).toBeGreaterThan(
      sites.indexOf("<FoldHeader"),
    );
    expect(sites.indexOf('{!readOnly && editing !== "new" && (')).toBeLessThan(
      sites.indexOf("</FoldHeader>"),
    );
    expect(flat(sites)).toContain(
      'onClick={() => { setEditing("new"); if (!fold.open) fold.toggle(); }}',
    );
    expect(flat(fn("TasksSection", "TakeoffsSection"))).toContain(
      '> {!readOnly && ( <Button size="sm" variant="outline" onClick={() => setDialog({})}>',
    );
    expect(flat(page.slice(page.indexOf("function BidsSection(")))).toContain(
      "onClick={() => { setLinking(true); if (!fold.open) fold.toggle(); }}",
    );
  });
  it("the folded body is not rendered (or hidden) while the header stays", () => {
    expect(fn("TicketsSection", "OpportunitiesSection")).toContain(
      "{!fold.open ? null : jobs.length === 0 ? (",
    );
    expect(fn("SitesSection", "TicketsSection")).toContain(
      '<div className="space-y-2" hidden={!fold.open}>',
    );
    expect(fn("ContactsSection", "ContactForm")).toContain(
      '<div className="space-y-2" hidden={!fold.open}>',
    );
  });
});

describe("the fold header (source)", () => {
  const hdr = read("src/components/section-fold.tsx");
  it("the whole title row is one button with aria-expanded; the action is a sibling, never inside it", () => {
    expect(hdr).toContain('type="button"');
    expect(hdr).toContain("aria-expanded={props.open}");
    expect(hdr).toContain("onClick={props.onToggle}");
    expect(hdr.indexOf("{props.children}")).toBeGreaterThan(hdr.indexOf("</h2>"));
    expect(hdr).toContain("<ChevronDown");
    expect(hdr).toContain(`props.open ? "" : "-rotate-90"`);
    // The count stays in the header either way.
    expect(hdr).toContain('typeof props.count === "number" && (');
  });
  it("useSectionFold reads the user's remembered fold and writes a toggle back", () => {
    const hook = read("src/lib/use-section-fold.ts");
    expect(hook).toContain("readFolds(storage, page, userId)");
    expect(hook).toContain("writeFolds(storage, page, userId, next)");
    expect(hook).toContain("const open = isFoldOpen(folds, section, count);");
    expect(hook).toContain('const userId = profile?.id ?? session?.user.id ?? "";');
  });
  it("the property's page folds the same way, under its own key", () => {
    const prop = read("src/components/property-page.tsx");
    expect(prop).toContain('useSectionFold("property", "tickets", jobs.length)');
    expect(prop).toContain('useSectionFold("property", "bids", bids.length)');
    expect(prop).toContain('page="property"');
    expect(prop).toContain("site={{ id: s.id, name: s.name }}");
    expect(read("src/components/customers-page.tsx")).toContain(
      'useSectionFold(site ? "property" : "customer", "tasks", rows.length)',
    );
  });
});
