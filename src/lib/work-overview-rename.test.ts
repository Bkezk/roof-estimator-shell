/**
 * Owner, Oct 2: "My Work" is renamed "Work Overview" everywhere a person sees it — the sidebar,
 * the page's heading and browser title, the Owner view's hints, toasts and emails. The URL stays
 * /my-work (links and bookmarks keep working), as do file names, query keys and identifiers.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
const isSource = (p: string) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p);

describe('no "My Work" left where people see it', () => {
  const files = [
    ...walk("src/components").filter(isSource),
    ...walk("src/routes").filter(isSource),
    ...readdirSync("src/lib")
      .filter((f) => f.endsWith(".server.ts"))
      .map((f) => join("src/lib", f)),
  ];
  it("covers the components, the routes and the server modules", () => {
    expect(files).toContain(join("src/components", "app-sidebar.tsx"));
    expect(files).toContain(join("src/routes", "my-work.tsx"));
    expect(files).toContain(join("src/lib", "notify.server.ts"));
    expect(files).toContain(join("src/lib", "tasks-notify.server.ts"));
  });
  it('none of them says "My Work" (code or comment)', () => {
    expect(files.filter((f) => read(f).includes("My Work"))).toEqual([]);
  });
});

describe("Work Overview, at the same address", () => {
  it("the sidebar entry", () => {
    const s = read("src/components/app-sidebar.tsx");
    expect(s).toContain('isActive={isActive("/my-work")} tooltip="Work Overview"');
    expect(s).toContain('<Link to="/my-work">');
    expect(s).toContain("{!collapsed && <span>Work Overview</span>}");
  });
  it("the page heading", () => {
    expect(read("src/components/my-work-page.tsx")).toMatch(
      /<ListTodo className="h-6 w-6" \/> Work Overview\s*<\/h1>/,
    );
  });
  it("the browser title, on the /my-work route", () => {
    const r = read("src/routes/my-work.tsx");
    expect(r).toContain('createFileRoute("/my-work")');
    expect(r).toContain('meta: [{ title: "Work Overview — JBK Portal" }]');
  });
});
