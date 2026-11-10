# Documents: page snippets, Word import, inserted PDFs shown (Nov 10, 2026)

Asked for by the owner after the snippet question: "go ahead and build the page snippet. and
allow the import of word documents not just PDFs, also when you import a pdf there it is not
shown". Proved in the browser as the test login on a temporary template, with the owner's own
one-page Word form (Roof Evaluation Summary) and a three-page test PDF. The temporary template,
snippet, library PDF and their two files were removed afterwards; the owner's own library PDF
was not touched.

## Page snippets

- A saved snippet can now be a whole page. New column `document_modules.page_modules`
  (`supabase/migrations/20261110200000_document_page_snippets.sql`, applied live): the page's
  modules in order. Null means a one-module snippet, as before.
- Saving: Document tab, the page's three-dot menu, "Save page as snippet…", then a name.
- Using: Modules tab, Saved snippets. A page snippet reads "Page · N modules". Its + adds it as a
  new page right after the selected page, with fresh copies, as many times as wanted. A page
  snippet is not dragged; one-module snippets still are.
- A document still holds 60 pages at most; past that the + says so.
- Saving and deleting snippets stays with admins and managers.

Browser: the imported form saved as "Page · 2 modules"; + twice made two new pages.

## An inserted PDF is drawn in the editor

- Before, an inserted PDF was a grey bar with the file's name ("Prints as its own pages").
  Nothing of the PDF itself was shown.
- Now its pages are drawn under that bar at the sheet's width (pdf.js, the Takeoff page's
  loader). The first 12 pages are drawn and the rest counted; all of them still print.
- New server function `documentAssetUrl` gives the editor a one-hour link to the library file.

Browser: a three-page PDF showed three drawn pages.

## Word import

- "Import Word" under each sheet, beside Insert PDF. It takes a .docx and adds a NEW page after
  that sheet, made of ordinary modules that can be edited: text (headings, bold, italic,
  underline, centred or right-aligned, bullet and numbered lists), each picture, each table.
- The reader is our own (`src/lib/documents/docx-import.ts`): a .docx is a zip of XML. No new
  package.
- Pictures are stored with the document or template, like an uploaded picture, at the size Word
  showed them. JPEG and PNG come across.
- Word form fields still showing their placeholder ("Click here to enter text.") come across
  blank, with the label kept.
- What the editor has no match for is left out and named in the message after the import:
  headers and footers, text boxes, newspaper columns, other picture formats. Fonts, colours and
  exact spacing do not come across.
- An older .doc file is refused with the way to fix it (Save As .docx in Word).
- A brand-new template that has never been saved cannot store pictures yet; the message says to
  save once and import again.

Browser, the owner's form: the logo at Word's size, "ROOF EVALUATION SUMMARY" as a centred
heading, the labels (Customer, Location, Inspection Date, Bldg(s) & Sq Ft, Existing Roof(s)
Composition, Assessment & Recommendations) in bold with blank lines to type on.

## Tests

`src/lib/documents/page-snippets-word-nov10.test.ts` (10 tests; a .docx is built inside the
test). Two older pins were updated for the page-snippet row (`documents-ui.test.ts`).

## Follow-up the same day

The owner, after trying it: "if you click save page as a snippet how does it know which page?
… could we just have the button document import and accept pdf, word, and publisher files?
also when i import a pdf with multiple pages it appears weirdly … the pdf pages should just be
in the page lineup normally".

- **Which page.** Each row of the Pages list has its own three-dot menu, so the menu belongs to
  that row's page. The item now reads "Save page 2 as a snippet…" and the popup's title says
  "Save page 2 as a snippet".
- **One button.** "Insert PDF" and "Import Word" are now one "Import document" button under each
  sheet. Its popup lists the library's PDFs and has "Upload file", which takes a PDF (into the
  library and inserted) or a Word document (a new page of editable modules).
- **Publisher.** A .pub file can be picked, but it cannot be read: the format is Microsoft's own
  and only Publisher opens it. The message says to use File, Export, Create PDF/XPS Document in
  Publisher and import that PDF.
- **PDF pages in the lineup.** An inserted PDF used to be one sheet (a grey bar, then every page
  stacked inside one tall sheet). Each of its pages is now a sheet of its own in the lineup,
  drawn edge to edge, with a tab such as "Page 1 · Banner 2, page 1 of 3". The first sheet's tab
  carries Move up, Move down and a bin (with Undo). The first 12 pages are drawn; the rest are
  counted and all print.
- **Found on the way.** Saving a brand-new template raised "Leave without saving?" on the very
  save that made it, and the template never moved to its own address, so its pictures could not
  be stored. Fixed: that move is no longer treated as leaving.

Browser, on a temporary template (removed afterwards): a three-page PDF made three sheets; the
owner's Word form came in as page 2; a .pub file gave the Publisher message; the popup read
"Save page 2 as a snippet"; the bin took the PDF out.
