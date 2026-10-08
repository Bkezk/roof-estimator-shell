/**
 * The Send To printed on one invoice, edited on that invoice only (owner, Oct 8: "editable on
 * one invoice only like centerpoint"). The invoice keeps its own copy of whom it is billed to
 * (invoices.bill_to, taken from the customer account or vendor when the draft is made); a draft
 * may change the six printed lines of that copy. The billing instructions and the Sage customer
 * id (external_id) are never taken from the editor, and the customer's record is not touched.
 * Pure, so it is tested without the server.
 */

export const SEND_TO_FIELDS = ["name", "address1", "address2", "city", "state", "zip"] as const;
export type SendTo = Record<(typeof SEND_TO_FIELDS)[number], string>;

/** The six printed lines of a saved copy (a missing one is blank). */
export function sendToOf(snapshot: Record<string, unknown> | null | undefined): SendTo {
  const s = snapshot ?? {};
  const out = {} as SendTo;
  for (const f of SEND_TO_FIELDS) out[f] = typeof s[f] === "string" ? (s[f] as string) : "";
  return out;
}

/** True when the boxes differ from the saved copy (outer spaces ignored). */
export function sendToEdited(snapshot: Record<string, unknown> | null | undefined, boxes: SendTo) {
  const saved = sendToOf(snapshot);
  return SEND_TO_FIELDS.some((f) => saved[f].trim() !== boxes[f].trim());
}

/** The invoice's copy with the edited lines laid over it; every other key is kept as it was. */
export function mergeSendTo<T extends Record<string, unknown>>(
  snapshot: T,
  edit: Partial<Record<string, string>>,
): T {
  const out: Record<string, unknown> = { ...snapshot };
  for (const f of SEND_TO_FIELDS) {
    const v = edit[f];
    if (typeof v === "string") out[f] = v.trim();
  }
  return out as T;
}
