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
