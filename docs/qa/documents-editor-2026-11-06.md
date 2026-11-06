# Documents builder and editor — assessment and fixes (Nov 6, 2026)

Owner, Nov 6: "assess the documents builder and editor, any way to make it much more user
friendly? and easy to use", then "Fix 1, 2, 3 … 5 please make the splits match print … 8".
Driven as the Claude login on a temporary customer, bid and document (deleted after, the PDF
files in the documents bucket included; a uuid sweep over every public and storage table came
back empty). Scripts: scratchpad `wo/pw-docs-1..4.cjs`; the write guard aborted every REST write
and every server-function write naming a row that was not mine.

## What was found

Usage since the module shipped (Oct 26): 7 documents, 5 of them stuck at v1 with no PDF, none
emailed.

| # | Finding | Proof |
|---|---------|-------|
| 1 | Edits lost on a sidebar click, no warning (only Back and the tab close warned) | typed, clicked Customers, reopened: text gone |
| 2 | No undo: deleting a module or a page was instant and final; Ctrl+Z did nothing | module 13 → 12, no toast, Ctrl+Z stayed 12 |
| 3 | Phone: the side panel hidden (no title, options, modules, variables, pages); the module toolbar hover-only; the sheet at 44 % (text ≈ 6 px) | 390 px viewport |
| 4 | A fresh Proposal shows five amber bracketed chips ([Account Website], [Company Contact Position], [Bid Square Feet], [Warranty]); the PDF prints them blank, so the letter reads "over 0 roof section(s) totaling approximately square feet" | PDF text extracted with pdfjs |
| 5 | Screen 4 sheets, PDF 3 pages: the editor packed by measured heights, the PDF by its own layout; text was never split on screen | `Page 1 · continued` where print had none |
| 6 | CenterPoint's words: JBK is "Account", the customer "Company"; /cust finds no variable; modules, snippets, variables, "Dotted page-breaker…" | the Variables tab |
| 7 | 45 variables in 7 groups; the five people need are buried | the Variables tab |
| 8 | Save Template As, Manage Templates and Revisions twice on screen (Save menu and Document tab) | |
| 9 | "test template" (4 pages, no description) offered to everyone in the New document picker | office data; the owner handles it |

Other observations: the New document dialog is good as it is (one click, defaults filled, the
editor open in 3.3 s); Ctrl+S, revisions, PDF in under a second, the newer-save refusal and the
"/" menu all work.

## Fixes (this commit)

1. **Leaving asks.** `useBlocker` in the editor shell: Save and leave / Leave without saving /
   Stay, for in-app navigation; the tab close keeps the browser's warning. The Back button no
   longer uses `window.confirm`.
2. **Undo / Redo.** The reducer keeps the pages and options before every change (typing in one
   text box is one step; the box keeps TipTap's own undo for keystrokes). Ctrl+Z / Ctrl+Shift+Z
   (Ctrl+Y) outside text boxes and inputs, Undo / Redo buttons in the header, and a "<Module>
   deleted — Undo" / "Page N deleted — Undo" toast that puts the thing back where it was. A text
   box follows a value changed under it (undo, redo, a restored revision).
3. **Phone.** A Tools button (below md) opens the Document / Modules / Variables tabs in a
   sheet; adding a module closes it. A tap on a module shows its toolbar (focus-within). The
   sheet never shrinks below 3/4 (10.5 pt text stays readable) and the canvas scrolls sideways.
   The header's action row wraps so it no longer widens the page.
5. **The sheets are the PDF's pages.** The canvas now runs the PDF's own layout engine
   (`pdf-layout.ts` `layoutModules` + `paginate`) in the browser with pdf-lib's Helvetica
   metrics (loaded once, `screen-measure.ts`), the pictures' sizes as the canvas reports them
   and the same pricing / inspection sources, and reads back which modules land on which sheet
   and where a module is cut (`screen-pagination.ts`). A text cut is placed at the very line in
   the box (text pieces now carry their block and line); other modules by share of their height
   or at the nearest row. The screen's type is set like the PDF's (10.5 pt body, 18 / 14 / 12 pt
   headings, 1.35 line height, 4 pt paragraph gap, 6 pt blank line, 18 pt list indent, 10 pt
   module gap). An inserted PDF takes its own sheet and its pages in the numbering. Until the
   metrics load the old packing shows. An empty picture slot says it prints nothing.
8. **One place for the three buttons** (the Save menu).

Proof in the browser (`pw-docs-4.cjs`, temp bid): a fresh Proposal shows 3 sheets and prints
3 pages; with 45 paragraphs typed into the letter, 5 sheets and 5 pages, each cut part ending at
the page-break line (a first part had shown the module's tail because an `overflow: hidden`
window scrolls to the caret — now `overflow: clip`). Module delete → toast → Undo restores;
Ctrl+Z undoes an add, Redo re-adds, Ctrl+Z inside a box stays the box's. The leave dialog on a
sidebar click: Stay keeps, Save and leave saves, Leave without saving drops. Phone: the sheet
612 px wide with sideways scroll, Tools opens the tabs, + adds and closes, a tap shows the
toolbar, text 14 px.

Tests: `src/lib/documents-editor-fixes-nov6.test.ts` (1, 2, 3, 8 — reducer undo exercised),
`src/lib/documents/screen-pagination.test.ts` (5), pins updated in `documents-ui.test.ts`,
`sheet-segments.test.ts`, `repair-list-ui.test.ts`, `editor-state.test.ts`,
`editor-helpers.test.ts`. All of them fail on the previous code.

## Second commit (owner: "For 4 just make it a faint placeholder … Go with 7")

4. **A blank chip is a faint placeholder**: the label in a dashed grey box, no amber, no
   brackets, with the tooltip "Blank: the record has no value here, so nothing prints" (the PDF
   prints nothing for it). Proven on a fresh temp Proposal: 5 blank chips drawn faint with the
   hint.
7. **Most used first.** The Variables tab opens with a "Most used" list (customer name, contact
   and phone, the property's address, today's date, the total price and the bid name — the
   ticket number on a ticket) and every other group folded with its count; a group unfolds on
   its title; a typed filter shows every match unfolded. The search (and the "/" menu, the same
   function) also answers to "customer" / "client" for the Company group and "jbk" for the
   Account group, which is the one place the CenterPoint vocabulary bit (6 stays otherwise, at
   the owner's choice). Proven: Most used 8 rows, the groups at 0 until unfolded (11), "cust"
   → the Company group alone.

Tests: `editor-helpers.test.ts` (chipText, mostUsedVariables, the search words),
`documents-editor-fixes-nov6.test.ts` (pins). They fail on the previous code.

## Third commit (owner, Nov 6)

- **Delete document… in the editor's Save menu** (document mode only): the same confirm as the
  Documents panel, then back to the ticket or bid the document was started from, with no
  "Leave without saving?" on the way even with unsaved edits. Proven on a temp bid: the menu
  shows it, the confirm names the document, the editor lands on the bid, the panel is empty.
- Tech Board (same commit): the "Finished, no technician" chips print "since <date>" — the day
  the ticket entered its stage, which is what the group is ordered by — instead of the
  scheduled date that made the order look random (`inStageSince`, service-schedule.ts).
  Proven read-only on the live board: Oct 14, Oct 14, Oct 14, Oct 26, Oct 28, Nov 3.

## Open

- **9** — office data ("test template" in the picker); the owner handles it.
