# The flyer's look on the Roof Care sign-up, and the two public pages (Nov 21, 2026)

The owner, Nov 20: "id like the roof care popup after you click the roof care button on the ticket
workflow to have a bit more color similar to the one sheeter i sent you and id like the public page
to mimic that sign up process and style".

The one-sheeter is the Roof Care Plans flyer. It stays out of the repository, and so do its prices:
every price on these screens is what the server answers for the building.

## 1. The look, once

`src/components/roof-care/flyer-look.tsx`, with its colours and its face in `src/styles.css`.

| Part               | What it is                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Green band         | The flyer's lime green (`--jbk-green`, measured from the sheet) with the headline in a heavy, condensed face, capitals  |
| Plan column        | Name in heavy blue capitals, one bold line, a rule, the yearly price with "per year", a rule, a list with green squares |
| Recommendation tag | The green tag on top of Roof Care                                                                                       |
| Step heading       | The number on green, the title in the heavy face, a rule under it                                                       |
| Blue band          | The logo's blue (`--jbk-blue`) with white print, at the foot                                                            |

- The face is Barlow Condensed, weight 800, Latin only, from the `@fontsource` package: it is served
  from the site's own files. Nothing loads from another site. A phone without the file yet falls
  back to a narrow face it has.
- The parts are drawn from named colours (`--flyer-name`, `--flyer-ink`, `--flyer-rule`,
  `--flyer-soft`, `--flyer-tint`), so they read in three places: the white public pages, the light
  app and the dark app. On the dark cards the plan names take a lighter blue.
- The headline sizes grow with the site's text size, like every other size.
- The parts know no price. Every number is handed in.

## 2. The sign-up pop-up

`SignUpDialog` in `src/components/roof-care/plan-card.tsx`. The look only.

| Before                              | After                                                                 |
| ----------------------------------- | --------------------------------------------------------------------- |
| A plain blue header                 | The green band, "ROOF CARE PLANS." in the heavy face                  |
| Round blue step numbers             | The number on green and the title in heavy blue capitals, with a rule |
| Three bordered cards, a rounded tag | The flyer's three columns, green squares, the green tag on Roof Care  |
| Buttons under the form              | The blue band: the plan picked and its yearly price, and the buttons  |

Kept exactly: the five steps and their words, every box, the roof size check, the red line under
the days box, "Still needed", the terms and their date, the staff's part, every `data-*` mark, and
every call to the server. The blue band repeats only what is already shown above it (the plan picked
and its price).

Measured on the real signed-in page, on a temporary ticket, with a size typed and Roof Care picked
(the last button was never pressed):

| Screen       | Pop-up / screen | Sideways scroll | Parts past the edge | Steps  | Plans, prices, tag |
| ------------ | --------------- | --------------- | ------------------- | ------ | ------------------ |
| 320 phone    | 320 / 320       | none            | 0                   | 1 to 5 | 3, 3, yes          |
| 390 phone    | 390 / 390       | none            | 0                   | 1 to 5 | 3, 3, yes          |
| 390 dark     | 390 / 390       | none            | 0                   | 1 to 5 | 3, 3, yes          |
| 1400 desktop | 832 / 1400      | none            | 0                   | 1 to 5 | 3, 3, yes          |

## 3. The two public pages

`/care` (`src/routes/care.tsx`, `src/components/public/care-page.tsx`) and `/request`
(`src/routes/request.tsx`, `src/components/public/request-page.tsx`). Their boxes and the sheet
around them are `src/components/public/fields.tsx`; what each form still needs, and what is sent,
is `src/lib/public-pages.ts`; the shape agreed with the server is `src/lib/public-forms.ts`; the
four calls are `src/components/public/api.ts` over `src/lib/public-forms.functions.ts`.

### /care, Roof Care plans

The sign-up's steps, for a visitor on their own phone:

1. **Your building.** Street, city, state, zip, the building's name, the roof's size or the closest
   size range, and "I have several buildings". The button is "Show my price".
2. **Pick your plan.** The three plans are explained from the start, with "Your price shows once we
   have your building's address" where the price will be. **No price shows until the address has
   been sent.** Then each plan shows this building's yearly price, and "an estimate until we measure
   your roof" is said under them. Change the building afterwards and the prices go until the button
   is pressed again.
3. **About you.** Name, company, phone, email, "Who referred you?", how they would like to pay
   (check or card). The page says nobody is charged on it and that the office gets in touch.
4. **Your agreement.** The same terms as the sign-up, read from `ROOF_CARE_TERMS`, the tick, and the
   typed name as the signature.

Then one button, and a thank-you with the reference, what happens next and the phone number.

The other cases:

| Case                                          | What the page does                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| The address is not on the map                 | Says so, shows no price, asks to check the address or call                |
| The address was placed by its town            | Shows the prices and says the price is an estimate until confirmed        |
| A roof that gets a custom quote               | Shows no price; the visitor can still send who to call, with no agreement |
| Several buildings                             | Says multi-building pricing is by phone, and still lets them send         |
| A call that fails, or too many from one place | Says so in plain words, with the phone number; nothing typed is lost      |

### /request, Request service

The same look. The services to tick come from the office's list (more than one allowed), with a box
for what is going on; then the building, then who is asking. If the list cannot be read the page
still works: the box says what is wanted.

### Both pages

- Open with no sign-in, drawn bare: no menu, no search, no bell, no link into the signed-in site.
- Kept out of search results (`noindex`): they are reached from a printed sheet.
- Always the flyer on white, also on a phone set to dark (`.jbk-public` in `src/styles.css`).
- Every box has its label, the right keyboard (phone, email, zip), a 16 px letter and a line under
  it for what is wrong. Every button and choice is at least 48 px tall.
- A box no person sees or tabs to (`website`) and how long the page was open go with the request:
  the server drops what a robot sends.
- Two presses in the same instant send once.
- No cookie and nothing kept in the browser. Nothing is loaded from another site.
- Nothing on them says whether the visitor is already a customer.

### How the two paths were opened, and nothing else

`src/components/auth-gate.tsx` asks `isPublicFormPath(pathname)` (`src/lib/public-forms.ts`): the
path alone, exactly `/care` or `/request`, a slash at the end allowed. On those two the gate does
not send a signed-out visitor to the sign-in and draws the page bare. Every other path is treated
as before.

A signed-out browser, on the dev server:

| Opened                                                        | Lands on                | Public page | App menu |
| ------------------------------------------------------------- | ----------------------- | ----------- | -------- |
| `/care`, `/care/`                                             | `/care`                 | yes         | no       |
| `/request`                                                    | `/request`              | yes         | no       |
| `/`, `/bids`, `/service`, `/customers`                        | `/login`                | no          | no       |
| `/owner`, `/admin/users`, `/admin/roof-care`, a property page | `/login`                | no          | no       |
| `/requests`, `/carex`                                         | `/login`                | no          | no       |
| `/care/extra`                                                 | stays, "Page not found" | no          | no       |

After the public pages: 0 cookies, nothing in the browser's storage, no call to another site.

Measured signed out, with a price shown and Roof Care picked:

| Screen | `/care` page / screen | `/request` page / screen | Parts past the edge | Smallest box letter |
| ------ | --------------------- | ------------------------ | ------------------- | ------------------- |
| 320    | 320 / 320             | 320 / 320                | 0                   | 18.4 px             |
| 375    | 375 / 375             | 375 / 375                | 0                   | 18.4 px             |
| 390    | 390 / 390             | 390 / 390                | 0                   | 18.4 px             |
| 414    | 414 / 414             | 414 / 414                | 0                   | 18.4 px             |
| 430    | 430 / 430             | 430 / 430                | 0                   | 18.4 px             |

A phone set to dark: the sheet and its boxes are white all the same.

## How it was tried

- The pop-up: on the real signed-in page through the dev server, on a temporary ticket (999601,
  removed after with its child rows). A size was typed, "Show my price" pressed, a plan picked.
  "Agree and sign up" was never pressed.
- The public pages, the whole way through (building, price, plan, about you, agreement, send,
  thank-you; and the request page): with made-up answers in the server's place, so no real request
  was made. The made-up prices match no plan price.
- The public pages with the real calls wired in: every call was stopped in the browser. The price
  button and both send buttons said "That did not go through. Nothing you typed is lost: try again,
  or call us", and the typing was kept. The request page drew without its list.
- Not tried: a real phone in the hand; a real request reaching the server (the server's side has
  its own record).

## Tests

- `src/lib/roof-care-flyer-look-nov21.test.ts`: 14 tests. The colours and the face, the parts, and
  the sign-up pinned as it was (steps, rules, marks, words, the terms' date).
- `src/lib/public-pages-nov21.test.ts`: 32 tests. The two paths and nothing near them; what each
  form still needs and what it sends; no price before the address; the terms by name; the robot's
  box; the keyboards and sizes; nothing of the signed-in site on the pages.
- On the code before this change neither file can pass: `flyer-look.tsx`, `public-pages.ts` and
  the pages did not exist, and the old pop-up, gate and stylesheet hold none of the pinned parts
  (checked against the last commit's text).
- Older pins moved, each with a dated note: the gate's two lines in `password-reset-nov14`,
  `work-overview-oct20-audit3`, `-audit4` and `-fixes`; the plan columns in
  `roof-care-customer-facing-nov19`.
