/**
 * A link that opens an address in the phone's or the browser's maps (owner, Nov 2: the
 * customer's physical address is a link, as the ticket's address on My tickets has been since
 * Oct 8). One form for every page: Google Maps' search address, which iPhones and Android hand
 * to their maps app and a desktop opens in the browser.
 */

/** The maps link for an address line; null when there is nothing to look up. */
export function mapsUrl(address: string | null | undefined): string | null {
  const q = (address ?? "").replace(/\s+/g, " ").trim();
  return q ? `https://maps.google.com/?q=${encodeURIComponent(q)}` : null;
}

/** "tel:" wants the digits (and a leading +), not the formatting. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
