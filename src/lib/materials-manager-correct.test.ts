/**
 * Owner, Oct 5 (service follow-up 1): "is the admin able to easily edit material … in the
 * tickets?" — not before: lines taken from the shop or another truck were a read-only list, and
 * an office login with no truck saw "No truck is set up for you today". Now a manager corrects
 * every line on the ticket with the same −, typed total and + as a truck row, and adds what the
 * tech forgot with "Add material (shop or a truck)".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planReduce } from "@/components/service/materials-utils";

const src = readFileSync("src/components/service/materials-section.tsx", "utf8");

describe("a manager corrects any line on the ticket", () => {
  it("lines from the shop or another truck get the stepper, for managers only", () => {
    expect(src).toContain("const manager = managesTickets(profile);");
    expect(src).toContain("const officeRows: ListRow[] = manager");
    expect(src).toContain("On this ticket — correct a quantity");
    expect(src).toContain("fromText={`from ${r.location_name}`}");
  });
  it("+ takes more from the same place, the server checking the stock there", () => {
    expect(src).toContain("onAdd={(n) => add(r, n, false)}");
    expect(src).toContain("onSet={(n) => setTotal(r, n, false)}");
    expect(src).toContain("if (checkStock && units > onHand + EPS) {");
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
  it("lines nobody may correct (returns) stay a read-only list", () => {
    expect(src).toContain(".filter(({ m }) => !officeKeys.has(cellKey(m)))");
  });
  it("a manager adds forgotten material from the ticket — on the ticket, never a jump to Inventory (owner, Oct 8)", () => {
    expect(src).toContain("Add material (shop or a truck)");
    expect(src).not.toContain('to="/inventory"');
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
