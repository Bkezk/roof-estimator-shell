/**
 * Owner, Oct 9: "make sure when the owner/manager clicks service it isnt filtered to just mine
 * and make sure everyone who opens the service page it opens on the tech board."
 *
 * Before: the Service menu item opened the ticket list with Mine switched on for anyone ticked
 * Technician (the owner is), and the Tech Board refused everyone but managers. Now the menu
 * opens on the board, the board shows to everyone with Service (dispatch — drag, drop, the "+"
 * on a cell, New ticket — stays a manager's), and the list's Mine chip starts off for everyone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("the Service menu opens on the Tech Board", () => {
  const side = read("src/components/app-sidebar.tsx");
  it("the item links to /service/board and stays lit on every /service page but My tickets", () => {
    expect(side).toMatch(
      /title: "Service",\s*url: "\/service\/board",\s*icon: Wrench,\s*page: "service",\s*lit: "\/service",\s*except: \["\/service\/today"\]/,
    );
    expect(side).toContain("isActive(item.lit ?? item.url)");
  });
});

describe("the Tech Board shows to everyone; dispatch stays a manager's", () => {
  const board = read("src/components/service/board-page.tsx");
  const tabs = read("src/components/service/service-tabs.tsx");
  it("no manager gate on the page; the tab shows to everyone", () => {
    expect(board).not.toContain("The board is for managers.");
    expect(board).toMatch(/export function BoardPage[\s\S]*?return <Board week=\{week\} \/>;/);
    expect(tabs).toMatch(
      /\{ title: "Tech Board", to: "\/service\/board", icon: CalendarDays, show: everyone \}/,
    );
  });
  it("drag, drop, the cell '+' and New ticket are under `dispatch` (managesTickets then; dispatchesTickets — the office too — since Oct 9)", () => {
    expect(board).toContain("const dispatch = dispatchesTickets(profile);");
    expect(board).toMatch(
      /const startDrag = [\s\S]*?if \(!dispatch\) \{\s*e\.preventDefault\(\);\s*return;\s*\}/,
    );
    expect(board).toMatch(/const dropOn = [\s\S]*?if \(!dispatch\) return;/);
    expect(board).toMatch(
      /const canDrag = props\.drag && \(stage === "open" \|\| stage === "scheduled"\);/,
    );
    expect(board).toMatch(
      /\{props\.dispatch && \(\s*<Link\s+to="\/service"\s+search=\{\{ new: 1, tech: r\.id, date: d \}\}/,
    );
    expect(board).toMatch(/\{dispatch && \([\s\S]*?New ticket/);
    // Every chip is told whether this viewer may drag it.
    expect(board.match(/drag=\{(dispatch|props\.dispatch)\}/g)?.length).toBe(2);
  });
});

describe("the ticket list's Mine chip starts off for everyone", () => {
  const page = read("src/components/service-page.tsx");
  it("no profile-driven default", () => {
    expect(page).toContain("const [mineOn, setMineOn] = useState(false);");
    expect(page).toContain("const mine = !isTech && mineOn;");
    expect(page).not.toContain("mineOverride");
    expect(page).not.toContain("!!profile?.technician)");
  });
});
