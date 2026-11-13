# Larger text across the site (Nov 13)

Owner: "can you make font across the site larger without changing the layout?"

## What changed

One number in `src/styles.css`, `--jbk-text-scale`, now 1.12.

- Every text size is multiplied by it. Every line height is divided by it. So a line of text is
  exactly as tall as before and only the letters grow.
- Boxes, padding, icons, buttons, inputs and column widths are untouched. The page's own size
  (`html { font-size: 13px }`) is not changed.
- Screens only. In print the number is not set, so printed pages lay out as before.
- The document editor's pages (`.document-sheet`) and the proposal sheet (`.proposal-sheet`) are
  paper shown on a screen. They are held at 1, so page breaks do not move.
- Sizes written out in a class (`text-[11px]` and the like) are scaled by name in the same file.
  A test reads the source and fails when a new one appears without its rule.

To tune it later, change the one number. 1 is the old size.

| Class | Before | After |
| --- | --- | --- |
| `text-xs` | 9.75 px | 10.92 px |
| `text-[10px]` | 10 px | 11.2 px |
| `text-[11px]` | 11 px | 12.32 px |
| `text-sm` | 11.38 px | 12.74 px |
| plain text, `text-base` | 13 px | 14.56 px |
| `text-lg` | 14.63 px | 16.38 px |
| `text-2xl` | 19.5 px | 21.84 px |

## Two spots that needed room

- **Tech Board on a phone.** The Unassigned list could push the screen 24 px sideways once its
  one-line rows grew. The list now has `min-w-0`, so long rows are cut with "…" as designed.
- **Takeoff object list.** A long page name (an aerial page is named after its address) never gave
  way, so the object's own name was cut to "De…". The page name now gives way first and shows in
  full on hover.

## Proof

Tests: `src/lib/text-size-nov13m.test.ts`, 34 tests, 29 fail on the old code. Full chain clean:
550 files, 7,196 tests, lint 0 errors, types, build.

Real browser, signed in as the test login, nothing clicked or saved. Each page was measured twice
in the same window, once at the old size and once at the new one.

- **Sizes worked out by the browser.** Every size is 1.12 times the old one. Every line height,
  and the line height a child inherits, is the same number as before.
- **Paper.** Inside a document sheet and a proposal sheet every size equals the old one. With the
  browser set to print, every size on the page equals the old one too.
- **Sideways scroll.** 25 pages at 1366 and 390 wide, 23 of them at 1920 too. None gained a
  sideways scroll.
- **What does move.** A sentence that just fitted on one line can now take two, so some rows and
  hint lines are one line taller. At 1366 wide the longest pages grew by 0 to 123 px in total.
  The takeoff toolbar wraps one button earlier at 1366 wide.

Card titles (`leading-none`) are 2 px taller. Left on purpose: squeezing them would clip letters.

## Not done

- No real document was opened in the editor. The sheet proof used probe text inside a sheet.
- Not seen on a real phone.
- Found, not changed: the Owner page scrolls sideways on a phone (762 px wide on a 390 px screen).
  It did so before this change as well.
