# QXO (GNF) quote prices and item numbers (Nov 13)

The owner sent two QXO bid proposals, one for EPDM and one for TPO, and asked for the prices to
be updated by item number. Dollar amounts are kept out of this file: they are the owner's quoted
prices, and they are on record in the portal under Admin > Price import > Import history.

## What was found

- The portal's EPDM and TPO accessory rows are named for Firestone products and carry Firestone
  item numbers (W56...). The quotes are for GNF products (W590... and short numbers).
- None of the eighteen numbers on the quotes was in the item-number list (1,252 rows checked).
- The list itself was being read short: see "The 1,000-row bug" below.

## What was applied (owner: "yes go ahead with the confident ones")

Eight quote lines whose product, pack and unit match a portal row. Each GNF number was added to
its row, beside the Firestone number already there, and the row's price was set to the quote's.
One import run records every old and new value and can be reverted from Import history.

| GNF number | Portal row                                                                              | Column |
| ---------- | --------------------------------------------------------------------------------------- | ------ |
| W590010152 | Adhesives: EPDM Bonding Adhesive                                                        | Price  |
| W590010058 | EPDM Other Accessories: 60-mil EPDM FormFlash 12" x 100' roll                           | Price  |
| W590010057 | EPDM Other Accessories: 60-mil EPDM FormFlash 9" x 100' roll                            | Price  |
| W590010098 | EPDM Corners: QuickSeam Corner Flashing 8-1/2" dia.                                     | White  |
| W590030400 | Adhesives: UltraPly Bonding Adhesive                                                    | Price  |
| W590030083 | Non-DL TPO Corners: UltraPly TPO Inside/Outside Molded Corner                           | White  |
| W590030081 | Non-DL TPO Pipe Stacks: UltraPly TPO Universal Pipe Flashing, sizes 1" to 6" (six rows) | Price  |
| 30080      | Non-DL TPO Other Accessories: UltraPly TPO Unsupported Flashing .060, 24" x 50' roll    | Price  |

Thirteen cells in all. Before writing, each row was read and matched the value quoted to the
owner; after writing, each was read back. The Tan and Gray prices on the TPO corner and pipe rows
were left as they were. Bids already saved keep their prices until "Update Pricing & Labor" is
used on them.

Done as the test login through the portal's own Price import functions, so the run shows that
login's name.

## Not applied: waiting for the owner

Twelve quote lines where the pack or the product differs from the nearest portal row: the two
3-gallon primers, the EPDM peel-and-stick pipe boot, the 6" reinforced perimeter strips (EPDM and
TPO), the EPDM 7" x 100' and 9" x 50' peel-and-stick flashings, the TPO edge caulk, the TPO
T-joint cover, the TPO walkway pad (60' roll against the portal's 50'), the TPO cleaner and the
TPO cover tape kit. The last two have no item number on the quote. Both quotes say "1 of 2"; the
second pages have not been seen.

## The 1,000-row bug

`listItemNumbers` and `listItemNumberKeys` each read the list in one request, and one request
returns at most 1,000 rows. The list has more, so the 252 mappings after the first 1,000 in
screen order, most of the Non-DL TPO screens, never reached the Price import page, the Item
numbers tab, the catalog editor or the Inventory page. Both now read every page
(`src/lib/admin-item-numbers.functions.ts`, test `src/lib/item-numbers-all-pages-nov13g.test.ts`).
The live site has this fix once it is published.
