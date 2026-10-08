/**
 * "New customer from this building" on Roofs & Storms (owner, Oct 8: "when a building is
 * selected [have] a new customer from this building button that makes it a customer"). Pure
 * rules: what the New customer dialog starts with, and the property (site) created under the
 * new customer from the building. The page (components/prospect-page.tsx) opens the dialog,
 * saves the site after the customer, and lands on the customer.
 */

export interface BuildingLike {
  name: string;
  address1: string;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  owner_name?: string | null;
}

export interface AddressLike {
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
}

const t = (v: string | null | undefined) => (v ?? "").trim();

/**
 * The building's address for a customer or a property. An approximate address (the refresh's
 * best guess) is not copied as a street line — the city, state and zip still are — so a guess
 * never becomes a customer's address unlabelled (the same rule as "New bid from this building").
 */
export function addressFromBuilding(b: BuildingLike, approx: boolean): AddressLike {
  return {
    address1: approx ? "" : t(b.address1),
    address2: approx ? "" : t(b.address2),
    city: t(b.city),
    state: t(b.state).toUpperCase() || "KY",
    zip: t(b.zip),
  };
}

/**
 * What the New customer dialog starts with: the owner on the deed when the data has one (the
 * customer is who pays, not what the building is called), else the building's name; and the
 * building's address as the physical address.
 */
export function customerPrefillFromBuilding(
  b: BuildingLike,
  approx: boolean,
): { name: string; address: AddressLike } {
  return { name: t(b.owner_name) || t(b.name), address: addressFromBuilding(b, approx) };
}

/** The property under the new customer: the building's name (or its street) at its address. */
export function siteFromBuilding(
  b: BuildingLike,
  approx: boolean,
  accountId: string,
): {
  account_id: string;
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
} {
  const a = addressFromBuilding(b, approx);
  return {
    account_id: accountId,
    name: t(b.name) || a.address1 || t(b.address1) || "Property",
    ...a,
  };
}
