/**
 * "My tickets" (owner, Oct 9: the Today item under Customers "should probably be called my
 * tickets for anyone marked technician that can see that"). The page listed every open ticket
 * for Office users, and only today's by name; now it is the signed-in person's own open tickets
 * for everyone, the office included, and is called My tickets in the menu, the heading, the tab
 * title and every link back to it. The URL stays /service/today.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("myDay returns the caller's own tickets, whoever they are", () => {
  const src = read("src/lib/service-field.functions.ts");
  const body = src.slice(
    src.indexOf("export const myDay"),
    src.indexOf("export", src.indexOf("export const myDay") + 10),
  );

  it("filters on technician_id = me unconditionally", () => {
    expect(body).toMatch(/\.eq\("technician_id", context\.userId\)/);
    // The old office-wide branch is gone.
    expect(body).not.toMatch(/if \(!isOffice\(p\)\)/);
    expect(body).not.toContain("whole board");
  });

  it("still lists only open and scheduled tickets", () => {
    expect(body).toMatch(/\.in\("stage", \["open", "scheduled"\]\)/);
  });
});

describe("the name is My tickets everywhere it is shown", () => {
  it("menu item", () => {
    const s = read("src/components/app-sidebar.tsx");
    expect(s).toMatch(/title: "My tickets",\s*url: "\/service\/today"/);
    expect(s).not.toMatch(/title: "Today"/);
  });
  it("heading, with the date as a subtitle", () => {
    const s = read("src/components/service/today-page.tsx");
    expect(s).toContain(">My tickets</h1>");
    expect(s).toMatch(/<p className="text-sm text-muted-foreground">\{title\}<\/p>/);
    expect(s).not.toContain("Today · {title}");
  });
  it("tab title", () => {
    expect(read("src/routes/service.today.tsx")).toContain('title: "My tickets — JBK Portal"');
  });
  it("links back from the close-out, the ticket page and Invoices", () => {
    expect(read("src/components/service/closeout.tsx")).toMatch(/ArrowLeft[^\n]*\/> My tickets/);
    expect(read("src/components/service-page.tsx")).toMatch(/CalendarDays[^\n]*\/> My tickets/);
    // (The board's "Go to …" button went with its manager-only gate, Oct 9.)
    const inv = read("src/components/service/invoices-page.tsx");
    expect(inv).toContain("Go to My tickets");
    expect(inv).not.toContain("Go to Today");
  });
});
