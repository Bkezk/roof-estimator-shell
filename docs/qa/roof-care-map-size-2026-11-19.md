# Roof Care: the map's roof size on the sign-up

The owner, Nov 19:

> should we go ahead and lookup and save the customers properties to make it easier to price the
> plans?

and, after the plan was laid out, "go with looking up the properties".

## What was built

On the Roof Care sign-up, under the roof size box:

> The map shows a building of about 22,400 sq ft at this address. If the property has more than
> one roof, add them together. **Use this size**

- The box still starts blank. The size goes in when a person presses the button.
- The size is the building outline's area, said to the hundred.
- A building found by the property's name, not its address, says so: "Check it is the right
  building."
- No outline at the address, an address outside Kentucky and Tennessee, a slow map server:
  nothing is offered and the size is typed as before. The sign-up never waits on the map for more
  than ten seconds, and never fails because of it.
- Opening the sign-up saves nothing on the property.

It uses the same address finder as the ticket's aerial picture: our stored buildings and 911
address points, then the two states' own map servers.

## The trial: fifty properties, nothing saved

Fifty properties with no map point were taken at random from the 1,105 that have none, and
looked up with the site's own finder, signed in as an admin. Nothing was written.

| What the lookup gave                                        | Of 50 |
| ----------------------------------------------------------- | ----- |
| A building with an outline, so a size to offer              | 33    |
| A point on the map with no outline over it                  | 2     |
| The street, but not that number                             | 5     |
| Nothing in our map data                                     | 10    |
| A map point in the end, with the Census address lookup used | 46    |
| No point at all                                             | 4     |

Of the 33 sizes, 15 were under the price floor, 17 between the floor and the custom-quote size,
and one over it. Two of the 33 were found by the property's name. One of the fifty was outside
the two states.

The median lookup took a third of a second. The slowest took twenty seconds, which is why the
sign-up stops waiting at ten.

What the trial cannot say: how close an outline's area is to the roof the company would
measure. No bid is linked to an outline, so there is nothing to hold it against.

## Every property looked up and saved

The owner saw the trial and said "go". All 1,139 properties were looked up the same way, and the
answers were saved on the property (`supabase/migrations/20261119500000_site_map_roof_size.sql`:
`map_roof_sqft`, `map_found_how`, `map_checked_at`; the point goes in `lat` and `lng`, as the
aerial picture already saves it).

| What the lookup gave                                             | Of 1,139 |
| ---------------------------------------------------------------- | -------- |
| A building with an outline: a point and a size                   | 683      |
| A point on our map with no outline over it                       | 90       |
| No building in our map data; the street address from the Census  | 166      |
| Found only by the property's name: not saved, a person checks it | 28       |
| A point that was not a place in the country: not saved           | 7        |
| No street address on the property                                | 10       |
| Nothing found                                                    | 155      |

- **945 properties now have a map point** (34 had one before), and **683 have a size to offer**.
- Of the 683 sizes, 384 are under the price floor, 236 between the floor and the custom-quote
  size, and 63 over it.
- A point already on a property was not changed. 28 of the 34 that had one came back from the
  lookup at the same spot, to the metre.
- A Census point was kept only when its state is the property's state.
- The sign-up says the size kept on the property at once. A property with none is still looked
  up when its sign-up opens.

How it was saved without disturbing anything: the answers went into a holding table that only an
admin could write to, were checked there, tried once in a transaction that was rolled back, and
then saved in one statement. The property history got no rows from it and no property's "last
changed" moved, so the Customers lists read as before. The holding table was removed. No ticket
and no bid was touched.

## How it was proven

**A browser on the current code**, as an admin, on the test customer's four properties, with
every save blocked:

| Property             | The sign-up showed                                                |
| -------------------- | ----------------------------------------------------------------- |
| Corbin, Kentucky     | A size at once. The box was blank until "Use this size"           |
| Nashville, Tennessee | A size at once                                                    |
| Richmond, Kentucky   | No line: our map has no outline at that address. The box is typed |
| Woodstock, Illinois  | No line: outside the two states. The box is typed                 |

After "Use this size", Get the price gave the three plans' prices. The Corbin building is under
the price floor and showed the floor's prices.

**Tests.** `src/lib/roof-care-map-size-nov19.test.ts`.
