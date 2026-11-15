# Documents: modules under five headers, Nov 15 2026

Owner: "I'd like to have the modules grouped by type under headers such as text, pictures, etc
(please make some suggestions for this before implementation)".

Three mock-ups were shown: five headers always open, the same five folding, and three broader
headers. The owner picked the first ("Option A"), kept the header names ("they are good"), and
confirmed that Photo on left and Photo on right belong under Pictures ("yes that's correct").

## The groups

| Header | Modules |
| --- | --- |
| Text | Body, Two columns |
| Pictures | Full Photo, Two photos, Photo on left, Photo on right, Photo Grid |
| Tables and prices | Full Table, Pricing Table, Price lines |
| Service | Repair List, Checklist item |
| Page parts | Letterhead, Signature, Horizontal Line |

The headers are always open. A tile is what it was: it drags onto a page, and its + adds it to
the bottom of the selected page. The saved snippets stay below the groups.

`MODULE_GROUPS` in `src/lib/documents/model.ts`, drawn by the Modules tab in
`src/components/documents/editor-screen.tsx`.

## Proof, on the new code in a browser

- Desktop and phone: 5 headers and 15 tiles, in the order above.
- A + from the last group added a Signature, and the canvas went to it.
- A Full Table dragged from its group onto the page landed on the page.
- No sideways scroll on the phone. No console errors.
- Done on a new template that was never saved.

## Checks

- 12 new tests in `src/lib/docs-module-groups-nov15.test.ts`: the five headers and their
  modules, and that every tile is under exactly one header. On the old screen 3 fail.
- One older pin in `documents-ui.test.ts` was updated on purpose.
- Lint 0 errors, types clean, 7,416 tests pass, the build succeeds.
