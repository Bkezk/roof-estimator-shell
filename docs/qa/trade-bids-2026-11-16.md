# Trade Bids (Nov 16, 2026)

Owner: "were talking about expanding into other areas so we need a way to bid them … set labor
and cost and time similar to the project bid calculator but simpler and we can save it per job
type like fill it in for painting save it, fill it in for siding save it".

Then: "have it similar to project bids, listing the info on the bids then have a new button
trade bids that pops up two options, a dropdown of the existing types of bids (painting etc) or
starting a new one … ensure if someone leaves the pages the pop up reminding to save or giving
the option to leave without saving is offered. I don't want that list combined with project
bids, but I do want the statuses, owners page, needs attention, and margin report to accurately
reflect the trade bids, a saved bid should keep its own numbers … Yes we need printed proposals
and invoices."

And on the menu: "Not under estimate pricing dropdown but under estimate pricing above
inventory on the nav bar".

## What was built

| Piece                 | Where                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| The sum               | `src/lib/trade-bid.ts` (pure rules, no database)                        |
| Job types and bids    | `src/lib/trade-bids.functions.ts`                                       |
| The list and popup    | `src/components/trade/trade-bids-list.tsx`, `new-trade-bid-dialog.tsx`  |
| Setting up a job type | `src/components/trade/trade-setup-screen.tsx`, `trade-lines-editor.tsx` |
| The bid               | `src/components/trade/trade-bid-screen.tsx`                             |
| Which screen a bid opens | `src/lib/bid-kind.ts`                                                |
| The page              | `/trade-bids` (`src/routes/trade-bids.tsx`), Estimate access            |
| Menu                  | its own row under Estimate Pricing, above Inventory                     |
| Printed proposal      | the "Trade proposal" template (`src/lib/documents/defaults.ts`)         |

## How a bid is priced

A job type says what a bid measures (walls in sq ft, doors each), its materials (cost, how far
one goes, waste, whether it is bought whole), its labor tasks (hourly rate, how much one person
does in an hour, or set hours), flat costs, and overhead, profit and sales tax on materials.

A bid copies the job type's setup when it is started and keeps that copy. Changing the job type
later changes new bids only. A bid's own rates can also be changed on the bid.

The example the tests and the browser run both reproduce to the cent:

| Line                              | Amount    |
| --------------------------------- | --------- |
| Materials                         | $717.50   |
| Sales tax on materials, 6%        | $43.05    |
| Labor, 37 hours                   | $1,062.00 |
| Flat costs                        | $400.00   |
| Cost                              | $2,222.55 |
| Overhead, 15% of cost             | $333.38   |
| Profit, 20% on cost and overhead  | $511.19   |
| Price                             | $3,067.12 |

Margin 27.5% of the price. 37 hours for a crew of 2 at 8 hours a day is 2.3 working days.

The price and the figures the Margin report reads are worked out on the server from the bid's
own numbers. Nothing price-like sent by the browser is trusted.

## How it sits with roofing bids

A trade bid is a row of `bids` with `kind = 'trade'`. So its status, due date, reminders, the
owner page, Needs attention, Work Overview, the search box, a customer's page and the Margin
report count it by the rules they already had. What changed in those places is the link: each
one now opens a trade bid on Trade Bids and a roofing bid in the estimator.

- Project Bids, its folders and its bin leave trade bids out. Trade Bids has its own list and
  its own bin.
- The roofing estimator never loads a trade bid (an old link is sent to Trade Bids) and its
  save refuses one.
- Warranty leads list roofing bids only.
- A copy of a trade bid is a trade bid.

## Database

`supabase/migrations/20261116200000_trade_bids.sql`, applied to the live database by hand and
checked: the table `trade_types`, the columns `bids.kind` (default `roof`) and
`bids.trade_type_id`, a trigger that stops a bid changing kind, and `warranty_leads()` for
roofing bids only. Every existing bid took the default and nothing else on it changed.

Proven on the live database in a run that was rolled back:

- a manager set up a job type; a second one with the same name in other capitals was refused;
- an estimator read it, could not add, change or delete one, and saved a trade bid;
- a bid could not change kind, a roofing bid could not point at a job type, and a kind other
  than the two was refused;
- a technician saw no job types and no bids and could not add one;
- deleting a job type left its bid whole, still a trade bid;
- a won trade bid was not in the warranty leads.

## Tests

| File                              | Tests | What                                                  |
| --------------------------------- | ----- | ----------------------------------------------------- |
| `trade-bid-nov16.test.ts`         | 17    | the sum, every number worked by hand                  |
| `trade-bids-server-nov16.test.ts` | 100   | server functions, links, documents, migration, menu   |
| `trade-screens-nov16.test.ts`     | 51    | the setup and bid screens and their helpers           |
| `trade-bids-list-nov16.test.ts`   | 52    | the list and its helpers                              |
| `trade-bid-guards-nov16.test.ts`  | 16    | the estimator guards, search tag, scope lines, customer |

Chain: eslint 0 errors, tsc clean, 580 files / 8,022 tests pass, production build succeeds.

Older tests that pinned changed lines were updated with dated notes (the bid selects that now
read `kind`, the links built by `bid-kind.ts`, the menu order, the default templates).

## Browser run

On the local build against the live database, signed in as the test login, on a temporary
customer, a temporary job type and a temporary bid. No real bid, customer or setting was
touched.

| Check                                                      | Result                                  |
| ---------------------------------------------------------- | --------------------------------------- |
| Menu order                                                 | Project Bids, Estimate Pricing, Trade Bids, Inventory; not inside the dropdown |
| New trade bid popup, nothing set up                        | "No trades are set up yet." and Set up a new trade |
| New job type: every number box                             | blank; Save off until it has a name     |
| Sample numbers on the setup screen                         | $3,067.12, every line as worked by hand |
| A word typed in a number box                               | Save off, "1 box holds something that is not a number" |
| Leaving the setup unsaved (menu link)                      | Stay, Leave without saving, Save and leave |
| Leaving with nothing changed                               | no question                             |
| Popup after the save                                       | the job type in the dropdown, Start the bid |
| New bid: quantities                                        | blank; the price lists what is missing  |
| Save with no customer or due date                          | refused, both fields named in red       |
| Bid filled in                                              | $3,067.12                               |
| Mouse wheel over a number box                              | no change                               |
| Leaving the bid unsaved (menu link and the browser's Back) | asks both times                         |
| Saved, reloaded                                            | quantities, scope, due date and price as saved |
| Wall paint $38 to $40 on the bid only                      | materials $737.50, price $3,096.38      |
| Job type's wall paint changed to $50 afterwards            | saved bid still $3,096.38; a new bid $3,242.66 |
| Project Bids list and its bin                              | no trade bid                            |
| An old estimator link to the trade bid                     | opens on Trade Bids                     |
| Search box                                                 | tag "Trade Bid", opens on Trade Bids    |
| Marked Won (asks the day)                                  | Won group, 1 bid, $3,096.38             |
| Margin report, Nov 2026                                    | revenue $3,096.38, 37 hours, link to Trade Bids |
| Documents on the bid                                       | starts on Trade proposal                |
| The proposal                                               | job type, the three scope lines on three lines, total $3,096.38 |
| Copy                                                       | a draft trade bid with the same numbers |
| Lost                                                       | asks the reason; Cancel leaves the status |
| Delete, Restore, Delete forever                            | each asks first and does what it says   |
| 390 px wide: list, bid, setup                              | no sideways scroll                      |
| Estimator who is not a manager                             | bids and saves; cannot set up or change a job type |
| Technician                                                 | no menu row; the address sends them to My tickets |

Found in the browser run and fixed, each with a test:

- Work Overview linked a draft trade bid to the roofing estimator (the server dropped `kind`
  on the way to the page).
- The search box tagged a trade bid "Project Bid".
- A scope of several lines ran together on screen in the document editor. The PDF already
  printed the lines.
- "A set number of hours" was cut short in its box. It reads "Set hours".

Afterwards the temporary rows were removed and the counts checked against the start: 27 bids,
all roofing; 0 job types; 45 documents; 638 customers; 1,139 properties; 216 notices; 6
opportunities; the test login as it was. The history log keeps its lines about the temporary
rows. One row stays on purpose: the "Trade proposal" template, added to the templates the same
way the Inspection report was.

## Invoices (Nov 17)

Owner: "Go with option 1, T-1001 format, and im not sure on that yet" (on whether a job gets one
invoice or a deposit and a final).

An invoice is made straight from a Won trade bid. No ticket is made.

- **Same invoices as a ticket's.** The same table, list, Draft, Final, Paid and Void, the same
  PDF, payment and share link. What differs is the parent: `invoices.bid_id` in place of the
  ticket (`service_job_id` may now be blank; exactly one of the two is set).
- **Numbers.** A bid takes a job number from a series that starts at 1001 the first time it is
  invoiced, shown "T-1001". A second invoice on the same bid is "T-1001.2", as a ticket's second
  is "6012.2". A voided invoice frees its number.
- **One invoice or several.** Left open on purpose. A new invoice starts at what the bid has
  left to bill (its price less its live invoices before tax), so one invoice bills it all and a
  second is only ever the remainder. The amount can be changed on the draft for a deposit.
- **The bid screen** has an Invoices block on a Won bid: each invoice, what is left to bill,
  and Make an invoice. It shows only to people who may invoice (an admin, a manager, or Service
  with the Invoices tick).
- **Tax** starts at 0% (a trade bid's price already holds the sales tax paid on materials). The
  Tax % box on the draft is the office's to set.
- **No cost on a bid's invoice.** The job's cost and margin are the bid's. The Margin report
  counts the won bid from its own figures and leaves its invoices out, so nothing is counted
  twice. The invoice page shows no cost or margin for one.
- **A bid with a live invoice cannot be deleted**, as a ticket with one cannot. The words say
  which invoice to void. Voided invoices go with a bid when it is removed for good.
- **Every ticket step is skipped** for an invoice with no ticket (stages, the ticket's pointer,
  rebuild from the ticket, ticket photos, purchase orders). A ticket's invoice behaves exactly
  as before: the existing invoice tests pass unchanged apart from dated pin updates.

Database: `supabase/migrations/20261117090000_trade_bid_invoices.sql`, applied to the live
database by hand and checked. Proven there in runs that were rolled back:

- a draft bid and a roofing bid are refused a job number, in plain words;
- a won trade bid gets 1001 and the same number when asked again;
- two invoices and a line save; an invoice with no parent and the same number twice are refused;
- Final then Paid works with no ticket (the ticket triggers tolerate the blank);
- deleting the bid is refused while an invoice is live, for a manager and for an estimator who
  cannot see invoices; with every invoice voided the bid deletes and purges, taking them with it;
- an estimator sees no invoices and cannot take a number or make one;
- someone with the Invoices tick and no Estimate access sees the invoices but not the bid.

Tests added: `bid-invoices-nov17.test.ts` (10, the numbering and what is left to bill),
`trade-invoices-db-nov17.test.ts` (10, the database change), `trade-invoices-server-nov17.test.ts`
(64, server functions, the PDF, the Margin report rule) and `trade-invoices-ui-nov17.test.ts`
(36, the Invoices block and the invoice page without a ticket).

Browser run on a temporary customer, job type and bid (price $3,096.38):

| Check                                              | Result                                    |
| -------------------------------------------------- | ----------------------------------------- |
| Draft bid                                          | "Mark the bid Won to invoice it."         |
| Won bid                                            | Invoices block, Left to bill $3,096.38    |
| Unsaved change on the bid                          | button off, "Save the bid first."         |
| Make an invoice                                    | #T-1001, one line for $3,096.38, tax 0%   |
| Header                                             | "Trade bid T-1001" and the bid's name, linking to the bid |
| Ticket-only parts (photos, Rebuild, cost, margin)  | not shown                                 |
| Amount changed to a $1,000 deposit, reloaded       | saved, total $1,000.00                    |
| Preview, Finalise, Download PDF                    | PDF titled Invoice, #T-1001, with the scope of work |
| Mark paid, $1,000                                  | Paid                                      |
| Back on the bid                                    | T-1001 Paid $1,000.00, Left to bill $2,096.38 |
| Make another invoice                               | #T-1001.2 for $2,096.38, "per proposal, balance", printed as its own line |
| Another with nothing left                          | refused: "This bid is billed in full…"    |
| Invoices list                                      | both, in their status groups; found by "T-1001" in search |
| Deleting the bid                                   | refused, naming T-1001 and T-1001.2       |
| Margin report                                      | the won bid once ($3,096.38, cost $2,243.75, 27.5%); no invoice rows |
| Void #T-1001.2                                     | Void on record; $2,096.38 left to bill again; the next invoice takes T-1001.2 |
| Delete a draft                                     | asks first, then back on the bid          |
| 390 px wide: the bid with invoices, an invoice     | no sideways scroll                        |
| Estimator (no Invoices tick)                       | no Invoices block; cannot open an invoice; cannot delete the invoiced bid |
| Office user (Service and Invoices, no Estimate)    | sees and opens the invoices; "Trade bid T-1001" is plain text, no link |

Found in this run and fixed, each with a test:

- The one line was folded into "Services and materials" on the customer's copy. It prints in
  its own words.
- The invoice carried the whole job's cost, so a deposit read as a loss. A bid's invoice now
  carries no cost and shows none.
- A deleted bid with only voided invoices could not have been purged, which would have stopped
  the clean-up of old deleted bids. The link was changed before anything used it.

Chain after the invoice work: eslint 0 errors, tsc clean, 584 files / 8,149 tests pass, production
build succeeds.

Afterwards the temporary rows and the two stored PDFs were removed and the counts checked: 27
bids, 0 job types, 0 invoices, 45 documents, 638 customers, 55 tickets, the number series back
at 1001 and unused, the test login as it was.

Also on Nov 17, after the owner looked for the customer on a trade bid: the bid's Customer box
has an "Add a new customer" button, the job type setup screen says the customer goes on each
bid, and a saved job type offers "Start a bid of this trade".

## Subcontractor lines (Nov 17)

Owner: "can it be used when we sub stuff out?" … "Go ahead and add the subcontractors line and
explain it". Also asked that trade prices stay "completely separate from project bids and
estimate prices": they are. A trade's prices live in the job type and in each bid, nowhere else.

A job type and a bid may hold subcontractor lines beside materials, labor and flat costs.

- **What a line holds:** what is subbed out, who does it (picked from the vendor list), and
  either one quote for the job or the sub's rate for each unit the job measures.
- **No sales tax and no crew hours** are added for a sub line.
- **Markup.** With "Its own markup" left blank the line is a cost like any other, and the bid's
  overhead and profit apply to it. With a percent typed (0 counts) the line stands apart:
  overhead and profit are worked on every other cost, and the line adds its cost plus its own
  markup. The totals say what overhead and profit were worked on when the two differ.
- **On the bid's main screen** a Subcontractor quotes card holds each line's name, the vendor
  and the quote or rate box, so a quote is typed where the measurements are. The basis and the
  markup are changed under "Change this bid's rates and lines".
- **Margin report:** what the subs are paid sits with the flat costs in the bid's figures, so
  the report's cost is the bid's cost.
- A setup saved before sub lines existed is priced and saved exactly as before.

Tests: `trade-subs-nov17.test.ts` (19, the sum, worked by hand) and `trade-subs-ui-nov17.test.ts`
(51, the form helpers and the screens), plus one server test for a saved bid with sub lines.

Browser run on a temporary customer, vendor, job type and bid (own costs $2,243.75, price
$3,096.38 before any sub):

| Check                                                | Expected by hand                 | Shown    |
| ---------------------------------------------------- | -------------------------------- | -------- |
| A $600 quote, markup blank                           | cost 2,843.75, price 3,924.38    | the same |
| The same line with its own markup 10%                | price 3,096.38 + 660 = 3,756.38, margin 24.3% | the same |
| Changed to $0.20 a sq ft of 3,000                    | still 600.00 and 3,756.38        | the same |
| A second line, $1,500 quoted, markup blank           | overhead 561.56, profit 861.07, price 5,826.38, margin 25.4% | the same |
| What overhead and profit were worked on              | $3,743.75                        | the same |
| Labor hours with both subs                           | still 37                         | the same |
| Job type with the washing line, sample 3,000 sq ft   | 3,067.12 + 660 = 3,727.12        | the same |

Also seen: a new line's boxes start blank and a blank quote says "Type the quote." without
pricing the line; a word in the quote box keeps Save off; the vendor is picked from the list and
shows after a reload; leaving with a sub unsaved asks first; a line added and removed again is
not an unsaved change; a saved bid keeps its own lines when the job type gains one, and a new bid
of the job type starts with the job type's line; no sideways scroll at 390 px with the rates
open.

One older fault found by the helper and fixed with a test: a labor line's Hours box and its
"One person does" box were one box to the screen, so a mistake typed in one showed in the other
when "Goes by" was switched.

Afterwards the temporary rows were removed and the counts checked: 27 bids, 0 job types, 0
invoices, 638 customers, 1 vendor, 55 tickets, the test login as it was.

## Nov 17, later: a markup box per sub line, the rates popup, and Save always in reach

Owner: "can you make the 10% mark up editable per line", then "can we have this be a button to
the left of the save button that you can click and it pops up those forms. also would it be too
much trouble to have this on the bids when you scroll down to where it goes off screen it stays
at the top so wherever you are editing you can also navigate the bid and save it? can you also
make the save button on service behave the same way it does on the trade bids when you scrolled.
I like how you did that on trade bids and want to implement that broadly."

What changed:

- **A sub line's own markup** is a box on the bid's main screen, beside the quote. Blank is not
  0: a blank line takes the bid's overhead and profit, and the sentence under the row says which
  it is. The pricing rule did not change.
- **Rates and lines** is a button in the bar at the bottom of a trade bid, left of Save. It opens
  a popup holding the editor that was a folding section at the foot of the page. Changes go
  straight into the bid on screen; the popup shows the price as it moves; Done closes it and the
  bid's own Save saves. A deleted bid keeps the button, to read the lines, and has no Save.
- **One Save bar** (`src/components/save-bar.tsx`) for every screen that has a Save: the trade
  bid, the trade setup, the service ticket and the opportunity. It is the last thing in the
  page's column and stays at the bottom of the window while the page is scrolled. On the ticket
  and the opportunity the button moved out of the form and submits it by name, so Enter in a box
  and the button still do the same thing, and Save is off exactly when it was.
- **A project bid's bar** (the steps, the checks, Save, Update pricing & labor) stays at the top
  of the window. On a phone the steps are one row that slides sideways, and the step shown is
  slid into sight.
- The selected-photos bar of a ticket sits above the Save bar instead of under it.

Tests: `save-bar-nov17.test.ts` (27), five more in `trade-subs-ui-nov17.test.ts` and
`trade-screens-nov16.test.ts`, and the older checks that pinned the moved parts updated with a
dated note.

Browser run at 1500 x 900 and 390 x 800, on the owner's test job type, a new project bid, a new
ticket, a new opportunity and existing records that were read and scrolled only. Nothing was
saved.

| Check                                                    | Seen                                   |
| -------------------------------------------------------- | -------------------------------------- |
| Trade bid: the bar at the top, middle and foot of the page | in view each time                    |
| Rates and lines is left of Save, on one row              | yes, both widths                       |
| Sub markup 10 to 25 on 600.00 of washing                 | markup 150.00, price up by 90.00       |
| Sub markup cleared                                       | "Takes the bid's overhead and profit." |
| A word typed in the markup box                           | Save says one box is not a number      |
| The popup: inside the window, scrolls inside itself      | yes, no sideways scroll                |
| A material's cost raised by 10 in the popup              | the popup's price and the bid's moved together |
| Escape in the open subcontractor list                    | closes the list, the popup stays       |
| Project bid scrolled 900 px                              | the bar is at the top, Save and Update in view |
| Review pressed from down the page                        | Review shown, page back at the top     |
| Phone: steps row                                         | slides sideways, page does not         |
| New ticket: Create with a date and no customer           | "Pick or add the customer first"       |
| The same by Enter in a box                               | the same message                       |
| Ticket and opportunity scrolled                          | the bar stays at the bottom            |
| One picture selected on a ticket                         | its bar is wholly above the Save bar   |

Found in the run and fixed before it went out: the popup opened with its first box selected, so
the next key would have wiped a name; Escape in the subcontractor list closed the whole popup;
on a phone the steps row made the page slide sideways.

Afterwards the counts were checked: 28 bids, one of them a draft trade bid the owner made
himself that morning, 1 job type (the owner's test), 55 tickets, 6 opportunities, 638 customers,
0 invoices, the trade number series unused, the picture count of the ticket looked at unchanged,
the test login as it was.

## Left for the owner

- Whether a job gets one invoice or a deposit and a final. Both work today.
- Whether customers are charged sales tax on trade work. Invoices start at 0%.
- Overhead is a percent of cost and profit a percent of cost plus overhead (a markup). A
  gross-profit choice like the roofing calculator's can be added.
- The Save bar can go on the remaining screens with a Save at the foot of a long page: the
  Estimate Pricing pages and the Setup pages.
- The vendor list's own words say "vendor" (for example "Clear the vendor") where a bid picks a
  subcontractor from it.
