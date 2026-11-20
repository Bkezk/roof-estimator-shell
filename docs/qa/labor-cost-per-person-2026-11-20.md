# What an hour of each person costs (Nov 20)

The owner, told that the Cost column on the Service rates page holds the prices: "idk what the
cost is because it depends on the tech, but i know the cost is less than that price." Then, on
an hourly cost on each person: "go on 1 plz".

No pay figure is in this file or anywhere in the repository. The amounts in the tests are made up.

## What changed

| Before                                                               | Now                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| One cost for a technician and one for a helper, whoever did the work | Each person can have their own hourly cost                          |
| Typed on the Service rates page, where it holds the prices           | Typed on Users & access, in an Hourly cost box beside the bill rate |
| So a service invoice showed labor at little or no margin             | A line costs what its person costs, and the margin follows          |

- The box is on Admin › Settings › Users & access, for people marked as technicians. It starts
  blank.
- Typed, it is the cost of that person's labor and travel lines on a service invoice. An hour on
  the road is paid as an hour on the roof, so both use it.
- Blank, the cost on the Service rates page is used for that person, as before. So is an unnamed
  helper of an old-style ticket.
- The price the customer pays is not touched. Only the cost side, which the margin is worked
  from.
- An invoice already made keeps its lines. A draft takes the new cost when it is rebuilt. An
  invoice made from now on takes it.

## Who sees it

Pay is kept apart from the person's own record, in a table only admins read and write. The
person does not see their own figure.

Whoever builds an invoice has to be given the figures, so an invoice's cost can be right: an
admin, a manager, or a user with Invoices access. They get them through one function and cannot
change them. They already see the cost on every invoice line, so from a labor line they can work
out what an hour of that person costs. Technicians and other office users get nothing.

## What was proven

Tests: `src/lib/labor-cost-per-person-nov20.test.ts`, 13 tests. They fail on the code before
this change.

On the live database, in one trial that was rolled back:

1. An admin typed a cost, read it back and changed it.
2. A cost below nothing was refused.
3. The technician whose cost it was read nothing: not the table, not the function. He could not
   change it or add one.
4. An office user with Invoices access read nothing from the table and got the figure through
   the function.
5. A manager read nothing from the table, got the figure through the function, and could not
   change it.
6. Nobody signed out can use the table or the function.

Also on the live database, on a temporary ticket at the test customer's "site 2" with one hour of
travel and two of labor by the test login, removed after. The site's own invoice builder was run
as the test login, without saving an invoice:

7. With a cost typed for that login, both lines carried it, at the same prices as before.
8. With the cost taken away, both lines carried the Service rates page's cost again.

In a browser, as an admin: Users & access has the Hourly cost column, with a blank box for each
of the eight technicians and its help line. Nothing was typed and nothing was sent. No sideways
scroll at desk, laptop or phone width. No page errors.

## The database

`supabase/migrations/20261120500000_profile_labor_costs.sql`: the table `profile_labor_costs` and
the function `technician_cost_rates`, applied by hand through the database tool and checked
against the file.
