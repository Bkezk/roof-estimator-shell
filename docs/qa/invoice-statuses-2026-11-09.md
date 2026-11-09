# Invoice statuses condensed (Nov 9, 2026)

Owner, Nov 9: "go ahead and condense the invoice statuses, how would you know the difference
between final and sent?" — by the sent stamp. An invoice already records when it was sent, to
whom and by whom (`sent_at`, `sent_to`, `sent_by_name`); the editor printed "Sent Oct 3 to …" and
the list has a Sent column. Sent as a separate status repeated that stamp and added a step.

## Now

- **Statuses: Draft → Final → Paid, with Void to the side.** Sending an invoice stamps it and
  leaves the status alone (final, or paid when a paid invoice is sent again). A final invoice's
  notes say "Sent Oct 3 to …" or **"Not sent yet"**.
- **The list's chips: Awaiting invoice · All · Unpaid · Draft · Final · Paid · Void** (seven,
  were eight). Unpaid = final, not yet marked paid. The Sent column stays (the stamp).
- **The Margin report keeps its four tiles** — Final, not yet sent · Sent, unpaid · Paid · Won
  bids — bucketed by the stamp (`marginBucket`: paid; else sent when `sent_at` is set; else
  final). A drill-down row of a sent invoice still reads "Sent".
- Share links, Mark paid, Void, the Owner view's unpaid tile, the Sage export and the Unpaid
  filter all read final / paid where they read final / sent / paid.
- A stored `sent` (none was live: 1 draft, 4 final, 2 paid, 3 void) reads as final
  (`asInvoiceStatus`), and migration `20261109090000_invoice_status_sent_folds_into_final.sql`
  folds any such row and narrows the check to the four statuses (applied live; the constraint
  now reads draft / final / paid / void).

## Proof

Read only in the browser as the test login: the list's chips as above, the Unpaid chip's tooltip
"Final, not yet marked paid"; invoice #6009.2 (Final) shows "Finalised Oct 14, 2026 · Not sent
yet", the read-only note, and Download PDF · Create share link · Send · Mark paid · Void; the
Owner › Business margin tiles read Final, not yet sent · Sent, unpaid · Paid · Won bids with the
note "Final and paid invoices only". No writes were made.

Tests: the invoice, share, margin and owner suites updated (`invoice-finalize-*`,
`invoice-frozen-pdf-void-paid`, `invoice-readonly-note`, `invoice-share`, `margin-report`,
`owner-business`; a sent invoice is now a final one with `sent_at`); `marginBucket` exercised.
Full chain green.
