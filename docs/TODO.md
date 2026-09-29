# To-do (owner's list, kept in the repo so it survives sessions)

Add, reorder or strike items here; each Claude session reads this first. Done items move to
the bottom with the commit that closed them.

## Open

**Phase 0 — bid-to-bid validation (the current gate).** Reconcile the two validation bids
against Bid-Advantage line by line; nothing downstream ships to real estimating until it passes.
Spec: [`specs/2026-09-29-bid-validation-phase-0.md`](specs/2026-09-29-bid-validation-phase-0.md).

**Owner actions (keys and secrets, Sep 27)** — nothing here goes in the repo or in chat:

- Lovable Cloud › Secrets: `RESEND_API_KEY` (from a Resend account with the flatroofonline.com
  domain verified), `NOTIFY_FROM_EMAIL` (e.g. `Bid-O-Matic <notifications@flatroofonline.com>`),
  `APP_URL` (the app's public address, used for links in emails and push). Until set, email
  reminders show as failed on Admin › Reminders; in-app and push still work.
- GitHub repository secrets: `APP_URL` (same value) and `CRON_SECRET` (the value of
  `LOVABLE_CRON_SECRET` shown in Lovable Cloud) so `.github/workflows/reminders.yml` fires
  reminders every 30 minutes in office hours. Without them, reminders go out only when an office
  user opens the app.
- Each user: open `/account` on their phone and turn push on (iPhone: add to Home Screen first).
- For phase D: CenterPoint CSV exports of Companies, Properties, Contacts, Tickets and Invoices
  (⋮ › Download All to CSV / Email CSV on each list), and if reachable the 475 repair templates
  and 142 materials.

**Building age on Prospecting (owner asked Sep 28; checked with proof).** Decision for the owner: buy the core counties from Regrid, or keep `year_built` hand-entered — [notes](handoff-service-module.md#building-age-on-prospecting-sep-28).

**Tennessee buildings (owner, Sep 29: "whole state").** Loader, workflow, migration (applied) and map built; owner runs "Refresh Tennessee data" once at night — [notes](handoff-service-module.md#tennessee-buildings-sep-29).

0. **Service module / CenterPoint replacement (owner, Sep 24)** — handoff and history in `docs/handoff-service-module.md`; build from `docs/service-module-design.md` — [notes](handoff-service-module.md#item-0-service-module-and-centerpoint); spec [`specs/2026-09-29-service-module.md`](specs/2026-09-29-service-module.md).
1. **Import old bids (.bax).** Built; NOT FINISHED (owner, Sep 26): (a) owner compares imported bids with Bid-Advantage, (b) drip edge / gravel stop / fascia bar entries, (c) skipped items, (d) labor tables read from the file — [notes](handoff-service-module.md#item-1-import-old-bids-bax).
   1b. **Importer: drip edge, gravel stop and fascia bar entries.** The four sample files had
   none, so the estimate-level XML shape of those accessory entries is unknown and they are
   skipped with a note in the import preview (a bid that used them imports short by those
   lines). Owner is finding an old .bax that used one; then add all three to
   `src/lib/bax/bax-import.ts`.
   1c. **Close the .bax cost gaps (owner, Sep 26), so an imported bid always reprices to what
   Bid-Advantage showed.** Each piece gets a test on a sample file.
   1. **Freeze the file's labor tables into the bid's snapshot**, and correct the import preview note — [notes](handoff-service-module.md#item-1c1-freeze-the-files-labor-tables).
   2. **Apply the legacy discount and the tear-off adjust instead of skipping them.** Find in
      the legacy IL how Bid-Advantage applies `<discount>` (where in the money chain, % or $)
      and `<tearoffadjust>` (a multiplier on tear-off hours; 1 = none), add the matching bid
      fields in the engine with a parity test, and import them. Today both only warn.
   3. **Import the remaining skipped items**: membrane accessories and two-piece metals with
      ids the app does not know yet, and term-bar extra feet in an unmapped colour — map them
      from the file's own catalog like the other accessories instead of warning.
   4. **Drip edge, gravel stop and fascia bar entries** (1b) — needs one old .bax that used
      them.
   5. **Proof run**: import every old .bax the owner has, compare each total with Bid-
      Advantage's Estimate Review, and list any bid that differs by more than rounding with
      the reason. Done when every difference is explained by a price the owner changed on
      purpose.
      **Storm call points (built Sep 28).** — [notes](handoff-service-module.md#storm-call-points-built-sep-28).
      **Construction leads (built Sep 28; sources added Sep 29).** — [notes](handoff-service-module.md#construction-leads-built-sep-28).
      **Tennessee leads (Sep 29).** STREAM, UT bids, Nashville permits, SAM.gov TN; round two: BidNet (TN & KY), Chattanooga permits, Knox County, TN universities; migrations applied — [notes](handoff-service-module.md#tennessee-leads-sep-29).

2. **Building age.** No free statewide source carries year built (footprints: none; state
   parcels: Webster only; Census: per-tract medians). Paths, in order: (a) county PVA bulk
   export or subscription — owner to check Hardin's qPublic site for a data download and
   whether the property card shows year built and owner; (b) a one-click "Open PVA card"
   button per building if the card's web address carries the address or parcel; (c) the
   salesperson types "Roof installed (year)" on first contact (already on the form; the
   "age unknown" filter shows what is left).
3. **Statewide load, then monthly refresh.** Built; statewide load complete Sep 25. Open: Ballard, Clark, Fulton and Martin keep almost no address points — [notes](handoff-service-module.md#item-3-statewide-load-then-monthly-refresh).
   3b. **Inventory locations (built Sep 24).** Shop + four service vehicles (plates N2X384,
   08 D4L983, V3C058, 08 995892 — the owner's list had "08 D4L983" twice; confirm the fourth
   plate). Admins edit `inventory_locations` (name / order / active) in the database for now;
   an admin screen for vehicles is a small follow-up. Next: a standard load (par list) per
   vehicle with "restock to par".
   3c. **Drivers for service vehicles (owner, Sep 25).** Assigned driver per vehicle with history; pop-up defaults; per-driver view — [notes](handoff-service-module.md#item-3c-drivers-for-service-vehicles).
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
10. **PlanSwift → Bid-O-Matic bids (owner, Sep 25–26). RESUME HERE.** Two separate pieces:
    - **A. Pricing inside PlanSwift** — a project somewhat outside Bid-O-Matic — [notes](handoff-service-module.md#item-10-a-pricing-inside-planswift).
    - **B. Import the finished PlanSwift job into Bid-O-Matic's Bids**, NOT into Takeoff — [notes](handoff-service-module.md#item-10-b-import-the-finished-planswift-job-into-bids).
      Next, in order:
    1. Owner: import `Bid-O-Matic Costing.SwiftTemplates` in PlanSwift 11, draw one
       `BOM Roof Section` on a scaled page, screenshot its properties (`BOM SysID`, `BOM MWO`,
       `BOM Memb $/SF`, `BOM InstallHrs`). Zero or an error = one of the two unverified PlanSwift
       behaviours (a text compare inside `[!if()]`; a formula length limit — the adhesive
       coverage lookup is ~13 KB).
    2. Owner: send one PlanSwift **job** export with that section (the file the importer reads;
       shows whether the drawn points are in it), and upload the owner's own
       `templets.SwiftTemplates` so the generators can run here
       (`scripts/planswift/sample/XMLData.XML`).
    3. Pass to the PlanSwift chat: field fastener spacing from the pull-test lookup (15 in at
       the estimator defaults, not a fixed 12); lumber blocking rows are per 12 ft piece; rebuild
       with the fresh `partC.json` sent Sep 25.
    4. Owner: set the Duro-Fleece 60 mil Plus price (226 $/sq ft in the catalog, 2.26 likely)
       and per-foot prices for the four automatic Roof Edge Blocking rows (below).
    5. Build piece B (the job importer into Bids) against the real job file, with a test on it.
    6. An "Export PlanSwift feed" button on Estimate Pricing that writes the table export
       `feed_to_partc.py` reads, so piece A can be regenerated without a developer.
       Price list gaps the PlanSwift build surfaced: fixed live + migration `20260925150000`
       (Duro-Tuff 50 Gray / Dark Gray 129 → 1.29; 13" pipe stack Dark Gray 2435 → 24.35). Still
       open for the owner: Duro-Fleece 60 mil Plus 226; the four automatic Roof Edge Blocking
       rows (½", ¾", 5/4", 2" Wood Blocking) are $0 per foot, so blocking material bills nothing
       in both PlanSwift and the estimator; Non-DL TPO, EPDM and Duro-Bond 40 have no membrane
       prices. All editable on Estimate Pricing.
11. **Price List Import polish:** Accept-all / Confirm-all, remember "Not this", explain a
    zero-item column pick, prefill the new-product dialog.

## Done

- Prospecting: county load, commercial rule, address match, named businesses, statewide
  loader + workflow, map with imagery and tap-to-add, roof-age / size / sort filters
  (commits through 9d8f8f4, Sep 24).
- Inventory: one screen, "Use on job" for crews, Undo on the confirmation and in History.
- Buildings page salesperson-first layout; Load county data with Advanced hidden.
