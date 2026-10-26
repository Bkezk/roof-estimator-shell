/**
 * Emailing a document's PDF — SERVER ONLY. One Resend sender serves the portal (invoices.server.ts
 * emailInvoice: the from address, the attachment as base64, the error text); this is that sender
 * under the document's name, so a change to how the portal sends mail is made in one place.
 */
export async function emailPdf(input: {
  to: string[];
  subject: string;
  text: string;
  pdf: Uint8Array;
  fileName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { emailInvoice } = await import("@/lib/invoices.server");
  return emailInvoice(input);
}
