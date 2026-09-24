# To-do (owner's list, kept in the repo so it survives sessions)

Add, reorder or strike items here; each Claude session reads this first. Done items move to
the bottom with the commit that closed them.

## Open

1. **Import old bids (.bax files).** Built (Saved Bids › "Import old bids"): the file's own
   catalog resolves every id; labor rate, markup, commission, per diem, tax and extra shipping
   come from the estimate; Non-DL items and Exceptional Metals keep their stored unit costs
   and labor rates; the file's price tables (membrane by mil × tier × colour, Duro-Bond / Tuff
   / Fleece, adhesives, accessories, freight, setup and inspection bands, warranties, high
   wind) become the bid's frozen snapshot, dated at the legacy last save, so "Update pricing &
   labor" shows the catalog moved on. Legacy statuses fold to the four (In Progress /
   Finished / Review / Final → Draft; Submitted; Accepted → Won; Denied → Lost). Still to do:
   owner compares the imported Summit and Knox bids with the hand-keyed ones and reports the
   gaps; drip edge / gravel stop / fascia bar accessory entries are not read yet (the four
   samples had none); underlayment $/sqft is not in the file, so those price from the live
   list.
   1b. **Importer: drip edge, gravel stop and fascia bar entries.** The four sample files had
   none, so the estimate-level XML shape of those accessory entries is unknown and they are
   skipped with a note in the import preview (a bid that used them imports short by those
   lines). Owner is finding an old .bax that used one; then add all three to
   `src/lib/bax/bax-import.ts`.
2. **Building age.** No free statewide source carries year built (footprints: none; state
   parcels: Webster only; Census: per-tract medians). Paths, in order: (a) county PVA bulk
   export or subscription — owner to check Hardin's qPublic site for a data download and
   whether the property card shows year built and owner; (b) a one-click "Open PVA card"
   button per building if the card's web address carries the address or parcel; (c) the
   salesperson types "Roof installed (year)" on first contact (already on the form; the
   "age unknown" filter shows what is left).
3. **Statewide load, then monthly refresh.** Built: `scripts/load-kentucky.ts` (matching in
   the loader's memory; only linked / business points reach the database) and the
   `Refresh Kentucky data` workflow (1st of each month, one shard). Secrets LOADER_EMAIL and
   LOADER_PASSWORD are set. State after runs 5–9 (Sep 24): footprints for all 120 counties;
   addresses and businesses matched for ~40 counties. Every run stalled on the same thing: the
   database is a small instance with a burst disk-IO budget, run 5 left 2.1 M junk address
   points (1.3 GB), and once the budget is spent a 200-row upsert into that table takes over
   30 s. Owner: run `truncate table public.address_points;` in the database console (the
   loader rebuilds only the useful rows), then dispatch the workflow with footprints = false
   at night. Lessons: never run DDL while the loader is writing (an `alter table` blocked it
   and PostgREST lost its schema cache for six minutes); one shard only.
   Open: Ballard, Clark, Fulton and Martin keep almost no address points (Clark 0 of 16,695;
   Martin 19 of 6,169) — their 911 layer rows likely lack the number/street fields or
   coordinates the reader expects; paste a sample feature from one of them to fix the reader.
4. **Verify in the browser:** aerial imagery tiles show on the map; the state outline layer
   draws when zoomed in; tap-to-add works on a small shop. Both depend on the state server
   allowing cross-origin tile fetches, which cannot be checked from the build container.
5. **More facility layers** once a sample is pasted: Hospitals, Long-term care, Post-secondary,
   Libraries, Armories, Existing industry, Available industrial buildings (layer index to
   confirm per layer).
6. **Apartments:** multi-family reads as residential today. Decide whether to include them as
   a labelled type (flat-roof commercial jobs to a roofer).
7. **Estimator backlog:** order pack field; opened-box rule on the bid; TPO induction welding;
   Summit fire-rated figure; "Remove all extra lines" button on Non-DL.
8. **Inventory:** a "your recent entries" strip with Undo if the History path proves too many
   taps; a supplier order from the order list (later).
9. **Roof time-lapse (owner idea, Sep 24).** On a selected building, step through the aerial
   imagery years (Kentucky's Phase 1/2/3 flights, plus USDA NAIP for the in-between years,
   free) to see whether the roof changed — a replaced roof shows as a colour / texture jump.
   Needs: the per-year KYAPED ImageServers at kyraster.ky.gov and the NAIP service URL; a
   small year slider on the map. Later, the same comparison can flag likely re-roofs
   automatically.
10. **Price List Import polish:** Accept-all / Confirm-all, remember "Not this", explain a
    zero-item column pick, prefill the new-product dialog.

## Done

- Prospecting: county load, commercial rule, address match, named businesses, statewide
  loader + workflow, map with imagery and tap-to-add, roof-age / size / sort filters
  (commits through 9d8f8f4, Sep 24).
- Inventory: one screen, "Use on job" for crews, Undo on the confirmation and in History.
- Buildings page salesperson-first layout; Load county data with Advanced hidden.
