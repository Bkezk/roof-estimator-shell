/**
 * Owner, Oct 5 (service follow-up 1): "is the admin able to easily edit material … in the
 * tickets?" — not before: lines taken from the shop or another truck were a read-only list, and
 * an office login with no truck saw "No truck is set up for you today". Since then (owner, Oct 9:
 * one list, one way in — materials-one-list.test.ts) EVERY login that may log material corrects
 * every line on the ticket from the one "On this ticket" list with the same −, typed total and +
 * as a truck row, and adds what was forgotten through "Find any material" or "Browse the shop".
 * The manager-only stepper list and its "Add material (shop or a truck)" button are gone; what
 * this file protects is the behaviour behind them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planReduce } from "@/components/service/materials-utils";

const src = readFileSync("src/components/service/materials-section.tsx", "utf8");

describe("any line on the ticket can be corrected", () => {
  it("lines from the shop or another truck get the stepper — for everyone, not managers only", () => {
    expect(src).not.toContain("managesTickets(profile)");
    expect(src).not.toContain("officeRows");
    expect(src).not.toContain("On this ticket — correct a quantity");
    expect(src).toContain('aria-label="On this ticket"');
    expect(src).toContain("fromText={r.from}");
  });
  it("+ takes more from the same place; a stock the screen knows is checked here (the short-stock question), else the server checks", () => {
    expect(src).toContain("onAdd={(n) => add(r, n, r.known)}");
    expect(src).toContain("onSet={(n) => setTotal(r, n, r.known)}");
    // `ok`: the tap's short_ok, or a cell the tech already said "it came from here" for (Oct 9).
    expect(src).toContain("if (checkStock && !ok && units > onHand + EPS) {");
    const inv = readFileSync("src/lib/inventory.functions.ts", "utf8");
    expect(inv).toContain("const onHand = await onHandAt(sb, locationId, data);");
  });
  it("− puts it back where it came from: a release, capped by the server at what the ticket took", () => {
    expect(src).toContain("onReduce={(n) => reduce(r, n)}");
    expect(planReduce([], 2, true)).toEqual([{ kind: "release", units: 2 }]);
    const inv = readFileSync("src/lib/inventory.functions.ts", "utf8");
    expect(inv).toContain(
      'const jobRelease = data.reason === "released" && !!data.service_job_id;',
    );
  });
  it("a tech may only undo their own entries from the last 24 hours; the refusal says so", () => {
    expect(src).toContain(
      "const plan = planReduce(ownFreshEntries(now, r, r.piece, myName), units, canRelease);",
    );
    expect(src).toContain(
      "only your own entries from the last 24 hours can be taken back here; ask the office to correct the ticket",
    );
  });
  it("lines nobody may correct (returns with nothing used) stay read-only rows of the same list", () => {
    expect(src).toMatch(/r\.packs > EPS \? \(\s*<TruckRow/);
    expect(src).toContain(
      "returned {amountText(packsToUnits(-r.packs, r.piece), r.piece, r.unit)}",
    );
  });
  it("forgotten material is added on the ticket, never a jump to Inventory (owner, Oct 8); the shelf view stays as Browse the shop", () => {
    expect(src).not.toContain("Add material (shop or a truck)");
    expect(src).not.toContain('to="/inventory"');
    expect(src).toContain("Browse the shop");
    expect(src).toContain('aria-label="Material from elsewhere"');
    expect(src).toContain("queryFn: () => truckFn({ data: { location_id: fromLoc! } }),");
  });
});

describe("the invoice follows the ticket", () => {
  it("Rebuild says to correct hours and quantities on the ticket", () => {
    expect(readFileSync("src/components/service/invoice-editor.tsx", "utf8")).toContain(
      "correct hours and quantities on the ticket (its Time and Materials), then rebuild. Lines you added here and prices you changed here stay",
    );
  });
});
