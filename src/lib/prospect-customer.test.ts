/**
 * Roofs & Storms (owner, Oct 8): "we dont need the task header on this page, and id like when a
 * building is selected to have a new customer from this building button that makes it a customer."
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  addressFromBuilding,
  customerPrefillFromBuilding,
  siteFromBuilding,
  type BuildingLike,
} from "./prospect-customer";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const building = (over: Partial<BuildingLike> = {}): BuildingLike => ({
  name: "Pre-K - 12 Schools",
  address1: "1000 CASS STREET",
  address2: null,
  city: "Nashville",
  state: "tn",
  zip: "37203",
  owner_name: "Metro Nashville Public Schools",
  ...over,
});

describe("New customer from this building", () => {
  it("starts the dialog with the owner on the deed (else the building's name) and the address", () => {
    expect(customerPrefillFromBuilding(building(), false)).toEqual({
      name: "Metro Nashville Public Schools",
      address: {
        address1: "1000 CASS STREET",
        address2: "",
        city: "Nashville",
        state: "TN",
        zip: "37203",
      },
    });
    expect(customerPrefillFromBuilding(building({ owner_name: "  " }), false).name).toBe(
      "Pre-K - 12 Schools",
    );
    expect(customerPrefillFromBuilding(building({ owner_name: null, name: "" }), false).name).toBe(
      "",
    );
  });
  it("an approximate address is not copied as a street line, like New bid from this building", () => {
    expect(addressFromBuilding(building(), true)).toEqual({
      address1: "",
      address2: "",
      city: "Nashville",
      state: "TN",
      zip: "37203",
    });
    expect(addressFromBuilding(building({ state: null, city: null, zip: null }), false).state).toBe(
      "KY",
    );
  });
  it("the building becomes the customer's property: its name (or street) at its address", () => {
    expect(siteFromBuilding(building(), false, "acc-1")).toEqual({
      account_id: "acc-1",
      name: "Pre-K - 12 Schools",
      address1: "1000 CASS STREET",
      address2: "",
      city: "Nashville",
      state: "TN",
      zip: "37203",
    });
    expect(siteFromBuilding(building({ name: "" }), false, "acc-1").name).toBe("1000 CASS STREET");
    expect(siteFromBuilding(building({ name: "" }), true, "acc-1").name).toBe("1000 CASS STREET");
    expect(siteFromBuilding(building({ name: "", address1: "" }), true, "acc-1").name).toBe(
      "Property",
    );
  });
  it("the page: no Tasks list on the empty panel; the button for Customers users; the dialog then the property, then the customer opens", () => {
    const page = read("../components/prospect-page.tsx");
    expect(page).not.toContain("<TasksPanel");
    expect(page).not.toContain("tasks/tasks-panel");
    // A building's own Tasks card stays (Work Overview's task rows link to it).
    expect(page).toContain('<CardTitle className="text-sm">Tasks</CardTitle>');
    expect(page).toContain('const canCustomers = can("customers")');
    expect(page).toContain("{form.id && canCustomers && (");
    expect(page).toContain("New customer from this building");
    expect(page).toContain("customerPrefillFromBuilding(form, approxOpen)");
    expect(page).toContain("prefill={customerDialogPrefill}");
    expect(page).toContain("siteFromBuilding(form, approxOpen, hit.account_id)");
    expect(page).toContain('void navigate({ to: "/customers", search: { id: hit.account_id } })');
    const dialog = read("../components/crm/account-picker.tsx");
    expect(dialog).toContain('prefill?: { address?: AddressValue; source?: "prospect" }');
    expect(dialog).toContain('setPhysical(props.prefill?.address ?? blankAddress("KY"))');
    expect(dialog).toContain("...(props.prefill?.source ? { source: props.prefill.source } : {})");
  });
});
