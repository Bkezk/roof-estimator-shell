# Prompt: study invoicing in CenterPoint Connect and report back

Copy everything below the line into a fresh agent session that has a browser open on the owner's
already-logged-in CenterPoint Connect tab (app.centerpointconnect.com). The agent writes a report;
the report comes back to the JBK Portal build so the invoice there can be made to match.

The earlier exploration report (`docs/centerpoint/centerpoint-report.md`, §5 "Invoices and
payments", screenshots 10–16) already covers the basics: invoice # = ticket #, the DETAILS /
PAYMENTS / PURCHASE ORDERS tabs, billable vs produced columns, tax at 0 %, the printed PDF's page 1
and "Work Completed" pages, and that payments are not recorded. This study goes deeper on exactly
how an invoice is built, sent and printed, and adds purchase orders and vendors, which that report
only touched.

---

You are studying how **invoicing** works in CenterPoint Connect for JBK, Inc. (Roofing Division),
using a browser tab that is already signed in. Your job is to look, read and document. You are
replacing nothing and fixing nothing. The report you write will be used to rebuild the same
invoicing inside JBK's own portal, so precision matters more than speed: field names as printed on
screen, the order things appear in, what is required, what is automatic, and what the customer
finally receives.

## Ground rules

1. **Read-only.** Do not create, edit, send, archive, delete, import or export anything. Do not
   press Send, Save, Add Payment, Add PO, Archive, Email CSV, Download CSV or Payment Import. If
   a screen can only be seen by starting a "New …" form, open the form, read it, and close it
   without saving. If a dialog asks to confirm anything, cancel.
2. **No credentials.** Never read, store or write down a password, API token, session cookie or
   login link. The tab is already signed in; that is all you need. If you are signed out, stop and
   say so.
3. **Customer data stays put.** Describe screens and fields; quote a customer name, address or
   amount only where it is needed to show a format (one or two examples per point is enough).
   Do not list customers, contacts or invoices in bulk, and do not copy the app's data calls or
   JSON into the report.
4. **Say what you saw, not what you assume.** When something could not be seen (a tab that would
   not open, a button that needs a save first), write "not seen" and why. Mark anything you infer
   as an inference.
5. **Take screenshots** of every screen and dialog you describe, numbered in the order you took
   them, and refer to them by number in the report. Also save the printed invoice as a PDF for two
   different tickets if the app offers "View PDF" without sending.

## What to study, in this order

### A. Where invoices live

- Service ▸ Invoices and Productions ▸ Invoices: every column in the list, the default sort,
  the filters (stage, date, paid, archived), the search, the footer totals, and every entry of the
  ⋮ menu. What distinguishes a draft from a sent invoice in the list.
- From a ticket: the Invoice block on the ticket page ("View", "Edit & Send", anything else), and
  what it shows before an invoice exists, while a draft exists, and after sending.
- Can one ticket have more than one invoice? Look for a second-invoice path (a "New Invoice" or
  "Additional Invoice" button, a "Final" toggle, a ".2" style number). Say exactly what you found.

### B. The invoice editor, field by field

Open the editor on one invoiced ticket and one not-yet-invoiced ticket (open the form, do not
save). For each field write: label as printed, type (text, date, dropdown and its options, toggle),
default value, whether it is required, and whether it is filled automatically from the ticket, the
company or the property.

- Invoice Information: Final, Invoice #, Invoice Date, Due Date, Bill-To, billing instructions,
  Payment Terms, Customer PO, Job #, Description / narrative, Check-in / check-out names,
  signature, anything else.
- The line table: every column heading; the three line kinds (travel, labor, material) and any
  others (repair, other, discount, fee); how the "Helper" lines arise when Number of Techs > 1;
  what a user can change on a line (quantity, rate, description, date, taxable) and what is
  locked; how a line is added by hand and how one is removed.
- Where the rates come from: the labor-rate class on the ticket (Emergency / Urgent / Standard /
  Not to Exceed) and the account's hourly rates; the material markup; whether a per-ticket override
  exists. Note the numbers on screen.
- Totals: Subtotal, Tax (rate, label, what it applies to), Amount Due, Produced, Margin,
  Margin/Hour. Which of these the customer sees and which are internal.
- The live PDF preview under the table: does it update as lines change?

### C. Sending

- Press nothing, but open whatever shows the send step's fields (often the Send button opens a
  dialog; if it would send immediately, do not press it and say so). Record: recipients (where they
  come from, whether several, whether a vendor or a non-contact email can be typed), subject and
  message defaults, attachments (the PDF, photos), CC/BCC, "mark as Invoiced" behaviour.
- What the sent record shows afterwards: sent-at, sent-by, recipients, the email text, and whether
  an invoice can be re-sent or edited after sending.

### D. The printed invoice (the customer's copy)

Save the PDF of two invoices (one with photos, one without if possible) and describe every page:

- Page 1: header (logo, company address, title), the identification block (Invoice #, Date,
  Customer PO, Job #, Due Date), Send To vs Property blocks, the description/amount table, Grand
  Total, Payment Terms text, the office contact line, the narrative.
- Work Completed pages: one per repair? Fields shown (template text, Completed date, quantity,
  unit, section, priority), Before / After photo layout and count, "Check In/Out With", signature.
- Fonts, column alignment, where page breaks fall, footer text and page numbers. Anything shown in
  the editor that is **not** on the PDF (cost, margin, produced) — list it.

### E. Payments and after

- The PAYMENTS tab: fields of the Add Payment form (amount, date, method, reference, note),
  partial payments, how PAID and PAID DATE appear on the list, and what "Payment Import CSV"
  expects (describe the dialog; do not import).
- Voiding, crediting, discounting or re-issuing an invoice: is there any such action? Archiving:
  what it does and what it hides.
- Reports that read invoices: AR / Aging, Service Scoreboard "available to invoice", anything with
  invoice totals. Columns and filters only.

### F. Purchase orders

JBK's crews sometimes buy material for a job themselves (Lowe's, a supply house) and the purchase
needs to sit on the ticket and on the invoice's cost.

- Ticket ▸ PURCHASE ORDERS tab and the Workflow (close-out) page's "Add PO": every field of a PO
  (number and its format, vendor, date, amount, description, line items, receipt/attachment,
  who entered it), whether the PO number is typed or generated, and how a PO changes the ticket's
  Cost / Margin.
- Invoice ▸ PURCHASE ORDERS tab: are POs shown to the customer, billed through, or internal only?
  Does a PO become an invoice line, and at what price (cost, cost + markup)?
- Reports ▸ PO's: columns and filters.

### G. Vendors and bill-to parties

- Vendors area: every field of a vendor record (name, address, contact, phone, email, terms,
  account number, notes) and what links to a vendor (POs, materials, properties, anything else).
  Note the two vendors that exist and how they were used.
- Sub Contractors area: the same, briefly, and whether a sub can be a bill-to or a PO recipient.
- Bill-To on a ticket and invoice: how a bill-to company different from the property's owner is
  chosen, whether a vendor or sub can be chosen as the bill-to, and whether an invoice can be
  addressed to someone who is not a company at all.
- Company billing fields: Billing Address, Billing Instructions, External Identifier, tax label
  override, "hide product price from technicians". Where each shows up on an invoice.

### H. Who may do what

Without changing anyone's permissions: from the Settings or user screens you can open, note which
roles can create, edit, send, record payments on and archive invoices, and which can see cost and
margin. If Settings will not open for this user, say so.

## The report

Write a single Markdown document, `centerpoint-invoicing-report.md`, with sections A–H above in
that order, each a mix of short prose and tables (Field | Type | Default | Required | Source). Put
screenshot numbers in brackets where they apply. Finish with:

- **Differences to watch**: ten or fewer things that would surprise someone rebuilding this from
  the earlier exploration report alone.
- **Open questions** for RoAnna Sims (the person who invoices), each one answerable in a sentence.
- **Not seen**: everything you could not reach, with the reason.

Bring back the report, the numbered screenshots and the saved PDFs together. Nothing else is
needed.
