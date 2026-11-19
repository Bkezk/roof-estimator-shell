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
- It is a read. Nothing is saved on the property.

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

## Not done, and waiting on the owner

Saving a map point and a size on every property. It writes to about 1,100 real properties, so it
waits for his word after he has seen the trial.

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
