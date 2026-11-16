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
| `trade-bid-guards-nov16.test.ts`  | 10    | the estimator guards, search tag, scope lines         |

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

## Not built yet

- **Invoices for trade bids.** An invoice today belongs to a service ticket: its number is the
  ticket's, and the Margin report counts it through the ticket. A trade job has no ticket, and
  the owner was not sure it should ("idk if what we are doing will need service tickets the
  same way a roof does"). This waits for the owner's choice between an invoice made straight
  from a won trade bid and a ticket per job.
- The Estimate group's menu row is the only way in besides links. Nothing is sent or created
  on its own.
