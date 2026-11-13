# Lovable's security check: rules that let everyone through (Nov 13)

Lovable's publish screen showed "Some access rules let everyone through, 11 affected tables".
It flags every row rule written as `using (true)` or `with check (true)`. Every one of these
rules is for signed-in users only; none is open to the public.

The list below was worked out from the migration files (the database connection was down), and
it comes to eleven tables, the same count as Lovable's. It still needs confirming on the live
database.

## Open on purpose (nine tables, left as they are)

| Table                                                              | What it holds                                                    | Why every signed-in user reads it       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------- |
| `inventory_locations`, `inventory_movements`, `inventory_settings` | Shelves and trucks, stock moves, the opened-box rule. No prices. | Inventory is everyone's (owner, Oct 1). |
| `county_codes`, `lead_sources`, `storm_settings`, `data_refreshes` | Reference lists and the data refresh log.                        | Read by several pages.                  |
| `bid_locks`                                                        | Who has a bid open.                                              | The "being edited by" notice.           |
| `vehicle_drivers`                                                  | Which person is on which truck.                                  | Inventory and Service read it.          |

## Tightened (owner: "yes techinicians shouldnt see those pricing number and fix the push notifications button")

Migration `20261113140000_service_settings_read_and_push_mark.sql`.

1. **`service_settings`** (material markup, tax rate, payment terms, invoice email words). The
   read was `using (true)`. It is now an admin, a manager, or a user with the Invoices tick: the
   same three as the invoices' own rules. Every reader in the app was already behind that check
   (Setup > Service rates, Setup > Material pricing, the invoice paths).
2. **`push_subscriptions`**. `push_subscriptions_dispatch_update` let anyone with Customers,
   Service or Estimate access, a technician included, change any person's device row, every
   column. The rule is dropped. The notice sender now calls `push_subscription_mark(id, ok)`,
   which sets "sent just now" or "this device is gone" and nothing else. A person still manages
   their own devices under `push_subscriptions_own`.

## Proof on a local PostgreSQL 16 (same roles, helpers and rules; not the live database)

Before the change, all six kinds of user read the markup, and an office user and a technician
each rewrote another person's device endpoint. After:

| User        | Reads service settings | Rewrites another person's device |
| ----------- | ---------------------- | -------------------------------- |
| Admin       | yes                    | (server key only)                |
| Manager     | yes                    | no                               |
| Invoicer    | yes                    | no                               |
| Office user | no                     | no                               |
| Technician  | no                     | no                               |
| Estimator   | no                     | no                               |

- A person still changes their own device row.
- The stamp function, called by an office user on a technician's device: the two stamps
  changed; the endpoint and keys did not.
- A user with none of Customers, Service or Estimate cannot stamp another person's device.
- Without a login the function is refused. With the server key it stamps any row.
- Running the migration a second time changes nothing and raises no error.

## Order of release

Either order is safe. New site with the old database: the function is missing, so the sender's
old one-column stamp runs under the old rule. New database with the old site: the published site
sends with the server key, which no rule applies to.

## Tests

`src/lib/security-open-rules-nov13e.test.ts` (12). It also refuses any later migration that
writes a `using (true)` or `with check (true)` rule.

## Applied to the live database (Nov 13, about 15:25 UTC)

- Before: the live rules that let everyone through were exactly the eleven tables listed above.
- After: nine remain, the nine that are open on purpose.
- Checked on the live database by acting as each kind of user inside a change that was rolled
  back: an admin, a manager and an invoicer read `service_settings`; a technician reads no row.
  A manager, an invoicer and a technician each changed no row when they tried to rewrite another
  person's device. The stamp function, called as a technician, set "gone" and left the endpoint,
  the keys and the owner as they were.
- `push_subscription_mark`: not callable without a login; callable signed in and with the server
  key.
- There was no plain office user and no estimator-only user on the live site to act as; those
  two were covered on the local PostgreSQL only.

## Left as it is

- A sender with Customers, Service or Estimate access can still mark another person's device as
  gone, which stops that device's push until its owner turns notifications on again. The sender
  needs that stamp to work.
