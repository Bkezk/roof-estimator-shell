# Invoices list in status groups (Nov 9, 2026)

Owner, Nov 9: "like on bids where each status is a collapsible row, the same for invoices where
each status is a collapsible row and each row is sorted by date." Then: "make awaiting invoice
one of the dropdowns, and have them start collapsed; do the unpaid and final chips show the same
thing?" and "make the dropdown titles a little more noticeable".

## Now

- The Invoices table is **one collapsible group per status, under the Awaiting invoice queue**:
  Awaiting invoice → Draft → Final → Paid → Void. Each header row is tinted and carries a
  status-coloured badge (the same colours as the rows' badges; violet for Awaiting invoice), the
  count and, for a status, the group's total ("4 invoices · $668.52"). An empty group is left out.
- **Every group starts collapsed.** A click opens it and the choice is remembered per browser
  (`jbk-portal:invoices-open`). A narrowed list never shows a lone collapsed header: a status
  chip opens its group, `?tab=to-invoice` (the Tickets tab's count, the Owner view's tile) opens
  Awaiting invoice.
- **Awaiting invoice is a group, not a separate table or chip.** Its rows are the Authorized
  tickets on the invoice columns — ticket number (opens the ticket, whose Back returns here),
  the day it was authorized, customer, property, PO and job numbers, an Authorized badge, and
  "Waiting 26 days" with the technician — longest waiting first; the header counts the server's
  tickets. The old chip and its own table are gone.
- **Chips: All · Draft · Final · Paid · Void.** The Unpaid chip went: since Sent folded into
  Final (same day), an unpaid invoice is exactly a final one, so the two chips showed the same
  rows. `?status=unpaid` still works and lights Final.
- **Rows are by date, newest first, inside each group**; a click on a column heading still sorts
  the rows inside every group; search, dates and the footer work as before.
- `lib/invoice-groups.ts` (pure, tested): the grouping with totals, the open-groups memory, the
  forced-open rule.

## Proof

Read only in the browser as the test login, storage cleared: chips All · Draft · Final · Paid ·
Void; five headers, every one collapsed — "AWAITING INVOICE 3 tickets", "DRAFT 1 invoice ·
$25.00", "FINAL 4 invoices · $668.52", "PAID 2 invoices · $1,679.21", "VOID 3 invoices". Opening
Awaiting invoice listed #6024 and #6026 (Waiting 26 days) and #6040 (since today, Garry); opening
Final wrote `["awaiting","final"]`; after a reload those two stayed open and the rest collapsed;
a ticket row opened `/service?id=…&from=invoices`; `?tab=to-invoice` opened Awaiting invoice;
`?status=unpaid` lit the Final chip and showed the Final group open alone; the Paid chip showed
Paid alone. No writes.

Also in this change: Lovable regenerated `src/integrations/supabase/types.ts` in its own style
(no semicolons, alphabetical, overloads listed, no `| null` on arguments) and its agent routed
five RPC calls through `lib/database-rpc.ts`. The tests that pin the generated types now read a
prettier-formatted copy made by the Vitest global setup (`src/test/generated-types.ts`,
`format-generated-types.ts`) and compare formatting-free (`typesInclude`, `typesBlock`); 18 pins
were brought to the regenerated truth.

Tests: `src/lib/invoice-groups.test.ts`, `src/test/generated-types.test.ts`. Full chain green.
