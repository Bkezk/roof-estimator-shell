# Invoices list in status groups (Nov 9, 2026)

Owner, Nov 9: "like on bids where each status is a collapsible row, the same for invoices where
each status is a collapsible row and each row is sorted by date."

## Now

- The Invoices table is **one collapsible group per status, Draft → Final → Paid → Void**, each
  with a header row — chevron, the status, "4 invoices · $668.52" (a void group shows the count
  alone) — that collapses the group; the choice is remembered per browser (`jbk-portal:
  invoices-collapsed`), as the Project Bids page remembers its groups. An empty group is left out.
- **Rows are by date, newest first, inside each group**; a click on a column heading still sorts
  the rows inside every group (Total, Customer, Due…), and the chips, search, dates and footer
  work as before (a chip shows that one group).
- `lib/invoice-groups.ts` (pure, tested): the grouping with totals, the remembered collapse.

## Proof

Read only in the browser as the test login: four groups — "DRAFT 1 invoice · $25.00", "FINAL 4
invoices · $668.52", "PAID 2 invoices · $1,679.21", "VOID 3 invoices" — all open; the Final rows
Oct 14, Oct 14, Oct 14, Oct 8 (newest first). Collapsing Void hid its rows and wrote `["void"]`;
after a reload Void stayed collapsed and the others open. Total ascending sorted the Final rows
$15, $16, $318.76, $318.76. The Unpaid chip showed the Final group alone. The footer still reads
"7 invoices (void left out) $2,372.73 · Paid $1,679.21 · Open $668.52". No writes.

Tests: `src/lib/invoice-groups.test.ts`. Full chain green.
