/**
 * Owner, Nov 13, with a picture of a bid row whose controls had dropped to a second line: "can
 * the status form where you pick draft, submitted etc be smaller so that it takes up less space
 * … and the bid info is ideally on one line", then "move the folder, copy, document, and delete
 * icons a bit closer together to save space".
 *
 * Measured in a browser: the controls were about 700 px wide and are about 450. On a 1920 screen
 * 23 of 24 rows hold the info on one line with the controls beside it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/routes/bids.tsx", "utf8");
/** One bid row's markup: from its controls to the end of the row. */
const controls = page.slice(
  page.indexOf('data-part="bid-controls"'),
  page.indexOf("/** The status groups"),
);

describe("the status box", () => {
  it("is narrower and shorter, with less padding", () => {
    expect(page).toContain('className="h-8 w-[6.75rem] gap-1 px-2 text-xs md:h-7"');
    expect(page).not.toContain(
      '<SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Bid status">',
    );
  });
  it("still offers every status and still saves at once", () => {
    expect(controls).toContain("{BID_STATUSES.map((v) => (");
    expect(controls).toContain("setStatus.mutate({ id: bid.id, status: v as BidStatus })");
    expect(controls).toContain("setWonFor({ id: bid.id, name: bid.name, day: bidOfficeToday() })");
    expect(controls).toContain("setLostFor({ id: bid.id, name: bid.name })");
  });
});

describe("the four icons", () => {
  it("sit in one tight group", () => {
    expect(controls).toContain(
      '<div className="flex items-center gap-0.5" data-part="bid-actions">',
    );
  });
  it("are square buttons, a size larger on a phone where a finger taps them", () => {
    const group = controls.slice(controls.indexOf('data-part="bid-actions"'));
    expect(group.match(/h-8 w-8 p-0 md:h-7 md:w-7/g)).toHaveLength(3);
    expect(group).toContain(
      'className="h-8 w-8 p-0 text-destructive hover:text-destructive md:h-7 md:w-7"',
    );
  });
  it("are still folder, copy, documents, delete, in that order, each with its name for a screen reader", () => {
    const group = controls.slice(controls.indexOf('data-part="bid-actions"'));
    const order = ["<FolderInput ", "<Copy ", "<FileText ", "<Trash2 "].map((i) =>
      group.indexOf(i),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const name of ["Move to folder…", "Duplicate", "Documents", "Delete"])
      expect(group).toContain(`<span className="sr-only">${name}</span>`);
  });
});

describe("the row", () => {
  it("the controls are closer to each other", () => {
    expect(page).toContain(
      '<div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-part="bid-controls">',
    );
    expect(page).not.toContain("gap-x-6 gap-y-2");
  });
  it("the bid's info takes the room the controls leave, and may shrink", () => {
    expect(page).toContain(
      '<div className="flex min-w-0 flex-1 basis-80 items-center gap-3" data-part="bid-info">',
    );
  });
  it("the due day and the total no longer reserve empty space", () => {
    expect(controls).toContain(
      'className="min-w-[6.5rem] text-right text-xs tabular-nums text-muted-foreground"',
    );
    expect(controls).toContain(
      'className="whitespace-nowrap text-right text-sm font-semibold tabular-nums"',
    );
    expect(controls).not.toContain("min-w-[120px]");
  });
  it("still wraps on a narrow screen instead of pushing the page sideways", () => {
    expect(page).toMatch(
      /className="flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-2 /,
    );
  });
});
