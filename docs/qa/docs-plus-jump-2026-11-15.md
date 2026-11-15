# Documents: the + goes to the new module, Nov 15 2026

Owner: "if you click the plus to add a module the preview jumps to where the module is added".

## What was wrong

The + on a module tile or a saved snippet adds it to the bottom of the selected page. The canvas
then went to the top of that page. On a long page the new module was out of sight, and the
person had to scroll down to find it.

## What changed

- The canvas now goes to the new module itself and brings it toward the middle of the screen.
- The new module carries a thin outline for about a second and a half, so the eye finds it.
  The outline is on screens only. It is never part of a printed or saved document.
- The page is laid out again around a new module and can move it to the next sheet. One later
  look follows it there.
- Dragging a module onto a page is as it was. A page snippet still goes to its new page.

`revealModule` in `src/components/documents/editor/editor-dom.ts`, used by `addToSelected` in
`src/components/documents/editor-screen.tsx`. The outline is in `src/styles.css`.

## Proof

A new template that was never saved, 18 modules added one at a time with the +. After each one:
is the new module in view?

| | Desktop 1500 x 900 | Phone 390 x 800 |
| --- | --- | --- |
| The published site, before | 8 of 18 | 11 of 18 |
| The new code | 18 of 18 | 18 of 18 |

On the new code every one of the 18 was outlined, and no outline was left two seconds later.

## Checks

- 10 new tests in `src/lib/docs-plus-jump-nov15.test.ts`. On the old code 6 fail.
- Lint 0 errors, types clean, 7,404 tests pass, the build succeeds.
