# Invoices page — audit (Nov 9, 2026)

Owner, Nov 9: "do a thorough audit of the invoice page, its essential the numbers are accurate and
it behaves as it should … dont assume anything and prove your findings." Code read
(`components/service/invoices-page.tsx`, `invoice-editor.tsx`, `lib/invoices.functions.ts`,
`invoices.server.ts`, `invoice-totals.ts`, `invoice-numbering.ts`, `invoice-labor.ts`,
`invoice-materials.ts`, `invoice-po-lines.ts`, `invoice-groups.ts`, the share route `routes/i.$token.ts`),
a SQL recompute of every live invoice, and a browser run as the Claude login on one temporary
customer and ticket (#6059, two time entries and one purchase order added for it, every row
removed afterwards). Scripts: scratchpad `wo/pw-inv-audit-1.cjs`, `-2a` … `-2e`. The write guard
aborted every REST write and every server-function write that named a row not mine (none was
refused). A uuid sweep afterwards: 0 "ZZ" accounts, tickets, invoices, lines, time entries,
purchase orders, notifications, audit rows or storage files; 10 invoices and 8 live tickets, as
before. The one notification the Authorize step sent (ticket_authorized, to the authorizer) was
removed with the rest.

## The numbers (all proven)

- **Every stored invoice is consistent.** SQL over the 10 live invoices: subtotal = Σ line
  totals, every line total = qty × rate and cost_total = qty × cost_rate, tax = subtotal of the
  taxable lines × tax_rate, total = subtotal + tax, paid_amount = total on both paid invoices,
  ticket stages match (final / paid → Invoiced, draft / void → Authorized). 0 mismatches.
- **A draft is priced from the ticket as the rates say.** Standard rates: tech labor 2.5 h ×
  $85 (cost $85), helper labor 2.5 h × $55 ($55), tech travel 1 h × $55 (cost $85), helper
  travel 1 h × $45 (cost $55); the $100 purchase order became a taxable Material line at $175
  ("cost + 75%", cost $100). Subtotal $625.00, Cost $590.00, Margin $35.00; the internal
  Purchase orders row shows $0.00 "· 1 on the invoice" (not counted twice).
- **The live totals follow every edit exactly as `computeTotals` says** — checked at nine
  states: a hand line 3 × $19.99 (taxable), tax 6% (tax $14.10 = 6% of the $234.97 taxable
  part, not of labor), markup 50% (the PO line re-priced to $150, the hand line untouched),
  Mark up purchase orders off ($100) and on ($150), markup back to 75% ($175), a rate typed on
  the tech labor line ($90; its cost stays $85; a later markup round trip leaves it at $90).
  Final draft: Subtotal $697.47 · Tax (6%) $14.10 · Total $711.57 · Cost $590.00 · Margin
  $121.57. The autosaved row and lines in the database carry the same figures, `rate_overridden`
  on the typed line.
- **Finalise** froze those totals, stored `invoices/6059-736b4fcc.pdf` (one page: "Services and
  materials $697.47", Subtotal, Tax (6%) $14.10, Grand Total $711.57 — the lines roll up by
  default, `invoice-pdf-rows.ts`), moved the ticket to Invoiced, asked "Send it now?" (Not now).
  A draft backdated to Nov 1 and finalised untouched took today's date (§4 rule).
- **The list:** Final group "5 invoices · $1,380.09" (= 668.52 + 711.57), footer "8 invoices
  (void left out) $3,084.30 · Paid $1,679.21 · Open $1,380.09", my row first (newest date), the
  Oct 14 ↔ Oct 14 range inclusive both ends (1 draft, 3 finals, 1 paid, 1 void), search by
  customer, PO #, Job # and number ("6009" → 6009 and 6009.2), the footer sums the rows shown;
  the Paid chip, `?status=unpaid` (Final alone, open), `?tab=to-invoice` (Awaiting open, 3
  tickets = the database's Authorized count).
- **Mark paid** defaults to today, the total ($711.57) and Check; the page then reads "Paid
  $711.57 on Nov 9, 2026 by Check · ref ZZ-CHK-1"; Edit payment reopens with those values.
- **Export to Sage** for today only: the warning "One invoice has no Sage customer #" named mine,
  Download anyway produced one INVOICE row (697.47 / 14.10 / 711.57, status paid, PaidOn) and
  six LINE rows; only that invoice was stamped exported ("Exported to Sage Nov 9" on its page).
- **Share link:** created, read on the published site without a login → 200 `application/pdf`
  (61 KB, the same file), "Viewed once, Nov 9" afterwards; an unknown token → 404; after Turn
  off link → 404. (On this machine the route answers 404 because the dev server has no service
  role key — not a bug.)
- **Another invoice → #6059.2**; its internal Purchase orders row reads "counted on #6059";
  Delete draft freed the number ("takes number 6059.2") and the next draft took it again;
  finalised then voided: "Void", kept on record under 6059.2, the ticket stayed Invoiced because
  #6059 was still live, the list's Void group counted it and the sums left it out.

## Findings (owner, Nov 9: "fix 1 … 6 is not an issue"; 2–5 proposed, awaiting the choice)

**Fix 1 (done, same day).** The lines and the Totals box sit side by side only when the content
is at least 1,420 px wide — a container query (`@min-[1420px]`, so the sidebar's width counts),
not the window's `xl`; narrower, the box goes below the lines and the line grid scrolls sideways
in its own strip (`data-lines-scroll`). Proven read-only on the real draft #6024 at 1280, 1366,
1440, 1536, 1680 and 1920 px: the Remove × answers `elementFromPoint` at every width (at 1280
after scrolling the strip 50 px), the box is beside the lines from 1680 up. The first attempt
built the class names from a template and Tailwind never generated them — written out in full,
`invoice-editor-layout.test.ts` pins that. Full chain green (504 files / 6,428 tests).

1. **Lines table under the Totals box (office view, 1280–1536 px wide).** With the Cost column,
   the line grid is 1,096 px wide at minimum and the two-column layout (`xl:grid-cols-[minmax(0,1fr)_300px]`)
   leaves it less, so the Total column and the Remove × of the first lines sit under the sticky
   Totals box: `document.elementFromPoint` on the × returned the Totals box at 1280, 1366, 1440
   and 1536 px; the × answered at 1680 and 1920. The Remove click timed out in Playwright at 1440.
   Screenshot `wo/inv-audit-draft.png`.
2. **The Awaiting invoice group ignores the search and the dates.** Searching "ZZ Audit" or
   narrowing to today ↔ today still shows "AWAITING INVOICE 3 tickets" above the one matching
   invoice (`awaitingShown = status === "all" && waiting.length > 0`).
3. **Margin / hour counts helper hours as their own hours.** A 3.5-hour visit with one helper
   reads "(7 h travel + labor)" and $5.00/h on a $35 margin; per crew-hour it would be $10.00/h.
   A definition to confirm, not an arithmetic error (`computeTotals` sums every labor and travel
   line's qty).
4. **A partial payment is counted two ways.** After Edit payment to $700 on the $711.57 invoice
   the Paid group header still sums invoice totals ("3 invoices · $2,390.78") while the footer's
   Paid sums payments ($2,379.21); the invoice reads Paid with no balance due shown, and Open
   leaves it out.
5. **Another invoice drafts the whole ticket again.** The second draft carried the same five
   lines (time and the PO) at $625.00; only the internal PO row knew the PO was counted on
   #6059. The office trims by hand; a forgotten line bills twice.
6. **A paid invoice cannot be voided** (only Edit payment); the page says "A correction goes
   through Sage." Fine if that is the rule.

Everything else behaved as the code and the owner's rules say.
