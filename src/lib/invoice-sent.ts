/**
 * The "sent" stamp on an invoice, with who sent it (owner, Oct 8: the Invoices list's "Sent by",
 * as CenterPoint's list has). Pure of the server so it is tested on its own; sendInvoice calls it
 * after the email has gone.
 *
 * Before 20261008120000_invoice_sent_by.sql is applied there is no sent_by_name column: the email
 * has already gone, so the stamp is written again without the name rather than failing.
 */

export interface WriteError {
  code?: string;
  message: string;
}

const missingSentBy = (e: WriteError) =>
  e.code === "PGRST204" || e.code === "42703" || /sent_by_name/.test(e.message);

export async function stampSent<P extends object, T>(
  write: (
    patch: P & { sent_by_name?: string },
  ) => PromiseLike<{ data: T | null; error: WriteError | null }>,
  patch: P,
  sentBy: string,
): Promise<{ data: T | null; error: WriteError | null }> {
  const r = await write({ ...patch, sent_by_name: sentBy });
  if (r.error && missingSentBy(r.error)) return write(patch);
  return r;
}
