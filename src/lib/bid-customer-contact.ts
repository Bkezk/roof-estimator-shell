/**
 * Whose phone and email Bid Setup shows beside the customer (owner, Nov 13: "in the empty white
 * space there can we show the linked customers contact info, if no contact info on file, the
 * primary contacts info").
 *
 *   1. The customer's own contact: the name, office phone, cell and email on its card.
 *   2. None of those three on the card: its Primary contact.
 *   3. No Primary contact with a number or an email either: the first contact that has one, in
 *      the list's own order (billing contacts first, then by name).
 *   4. Nobody: null, and the page says so.
 *
 * A name alone is not contact info: a card with a name but no number and no email goes on to
 * its contacts. Pure: no imports, no I/O.
 */
export interface ContactAccount {
  contact_name: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
}
export interface ContactPerson {
  name: string | null;
  position?: string | null;
  office_phone: string | null;
  mobile: string | null;
  email: string | null;
  is_primary?: boolean | null;
}
export interface BidContact {
  /** Where it came from: the customer's card, its Primary contact, or another contact. */
  source: "customer" | "primary" | "contact";
  /** The small heading over it. */
  heading: string;
  name: string | null;
  /** The contact's position ("Facilities Manager"), when it has one. */
  role: string | null;
  office: string | null;
  cell: string | null;
  email: string | null;
}

const t = (v: string | null | undefined): string | null => (v ?? "").trim() || null;

export function bidCustomerContact(
  account: ContactAccount | null | undefined,
  contacts: readonly ContactPerson[] | null | undefined,
): BidContact | null {
  if (account) {
    const office = t(account.phone);
    const cell = t(account.mobile);
    const email = t(account.email);
    if (office || cell || email)
      return {
        source: "customer",
        heading: "Customer contact",
        name: t(account.contact_name),
        role: null,
        office,
        cell,
        email,
      };
  }
  const reachable = (contacts ?? []).filter((c) => t(c.office_phone) || t(c.mobile) || t(c.email));
  const pick = reachable.find((c) => c.is_primary) ?? reachable[0];
  if (!pick) return null;
  return {
    source: pick.is_primary ? "primary" : "contact",
    heading: pick.is_primary ? "Primary contact" : "Contact",
    name: t(pick.name),
    role: t(pick.position),
    office: t(pick.office_phone),
    cell: t(pick.mobile),
    email: t(pick.email),
  };
}

/** Does the customer's own card carry a number or an email (so its contacts need not be read)? */
export const accountHasContact = (account: ContactAccount | null | undefined): boolean =>
  !!account && !!(t(account.phone) || t(account.mobile) || t(account.email));
