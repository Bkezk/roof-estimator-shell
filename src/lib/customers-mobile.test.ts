/**
 * The Customers list on a phone (owner, Oct 26: "ensure the customers page is mobile friendly.
 * theyre a bit smooshed"). Seen at 390 px: the card's three stat columns (Account manager /
 * Properties / Tickets in progress) sat beside the name as a block that would not shrink, so the
 * name got a few letters ("Be…") and the address wrapped one word per line. On a phone the stats
 * now take the full width under the name and the name may wrap; from the sm breakpoint up the
 * card is as it was. The app shell's page padding also drops from 24 px to 16 px on a phone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("the customer card on a phone", () => {
  it("stats go full width under the name below sm; beside it, right-aligned, from sm up", () => {
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain(
      'className="grid w-full grid-cols-3 gap-x-3 text-sm sm:w-auto sm:shrink-0 sm:gap-x-6 sm:text-right"',
    );
    expect(page).not.toContain(
      'className="grid shrink-0 grid-cols-3 gap-x-6 text-sm sm:text-right"',
    );
  });
  it("the name wraps on a phone and truncates only from sm up", () => {
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain('className="min-w-0 break-words text-base font-semibold sm:truncate"');
  });
  it("the page padding is 16 px on a phone, 24 px from sm up", () => {
    expect(read("src/components/auth-gate.tsx")).toContain('<SidebarInset className="p-4 sm:p-6">');
  });
});
