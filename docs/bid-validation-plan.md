# Bid-to-Bid Validation Plan

The web app (Bid-O-Matic) has feature parity with legacy Bid-Advantage; what remains is
proving the numbers match. Two deliberately loaded bids, entered identically in both apps,
close every open calculation flag. This doc is the durable spec for that test.

## How the test works

1. Build each bid below **fresh** in legacy Bid-Advantage (don't reuse an old saved bid —
   old bids may carry stale pricing; the web app's seed matches the *current* BA admin data).
2. Capture from BA, per bid:
   - The **Review tab — Cost view** and **Review tab — Labor view** (every intermediate
     line, not just the total).
   - A screenshot of **each input tab** (so the same bid can be entered identically in the
     web app).
3. Enter the same bid in the web app (New Estimate), step by step from the screenshots.
4. Click **Export** on the Review step → the estimate-review CSV.
5. Reconcile the CSV against BA's Review screens line by line (or hand both to Claude to
   reconcile). Any line that disagrees maps onto one of the flagged seams below.

## Bid 1 — the loaded mechanical job

- 2+ roof sections on **Wood** deck, **40 mil White**, mechanical attachment
- A **perimeter enhancement zone** on at least one section
- **Tear-off** on at least one section (a common type, e.g. BUR < 2", with a debris depth)
- **2 insulation layers, mechanically attached** (e.g. 1/2" ISO + Duro-Fold)
- A handful of **accessories** (corners, pipe stacks, a drain boot)
- A **parapet wall** and a couple of **curbs**
- **Stepped shipping**, standard markup (gross profit %), commission, sales tax on

Validates: tear-off ÷100 hours scale · freight basis (M0 vs membrane-only vs
material-before-tax) · direct-labor (LaborSubtotal1) membership · parapet height-band +
girth reading · curb perimeter-from-A×B reading · accessory-labor membership ·
roll-goods membrane geometry / edge overlap · setup & inspection bands.

## Bid 2 — the adhered / money job

- **Adhesive attachment** for the membrane
- An **adhesive-attached insulation layer** (pick the adhesive + substrate)
- A **warranty selected** — ideally a high-wind one (term years + max-wind band)
- **Prepay discount** on, **per-diem** set (note in/out of markup), **adjust-labor %** nonzero
- A **non-DL line** (e.g. sheet metal work) and a **metals line** (a collection box has
  real seeded prices)

Validates: adhesive labor ÷1000 sqft scale · adhesive units rounding (whole-unit purchase
or not) · warranty + high-wind + non-Master/Elite math · discount stacking & bases ·
per-diem / commission in-vs-out of markup routing · metals labor → services routing ·
shipping-percent stored scale (if percent mode is also tried).

## Open flags these bids settle

All are marked `FLAGGED FOR BID VALIDATION` in the engine source:

| Flag | Where | Settled by |
|---|---|---|
| Tear-off ÷100 hours scale | adapters/bid-builder | Bid 1 |
| Freight basis (M0?) + percent scale | bid-builder | Bid 1 (+2) |
| LaborSubtotal1 membership & single crew rate | estimate.ts | Bid 1 |
| Roll-goods geometry / edge overlap | quantities/estimate | Bid 1 |
| Parapet band/girth + membrane-sqft membership | bid-builder | Bid 1 |
| Curb perimeter reading; curb membrane material (not computed) | bid-builder | Bid 1 |
| Adhesive labor ÷1000 scale; unit rounding | adapters | Bid 2 |
| Warranty/high-wind composition | warranty.ts | Bid 2 |
| Discount stacking; per-diem/commission routing | money.ts | Bid 2 |
| Metals labor → services routing | bid-builder | Bid 2 |
| LaborSubtotal2 double-count question (rows 8+9+10+11) | estimate.ts | Either |

## Known not-yet-automated (expected manual entry in the web app)

These won't cause mismatches if entered manually, but note them while entering:
pull-test → fastener OC (enter the OC BA shows) · termination hardware pricing (add as
accessory/non-DL lines if BA bills them) · curb membrane material (add as an extra line)
· membrane fastener counts and sealant auto-quantities (ordering info only).

## Reminder about frozen pricing

Saved web bids freeze their pricing at first save. For the validation, either use an
unsaved estimate, or click **Update pricing & labor** before comparing, so both apps
compute from the same (current) admin data.

## Legacy Setup/Sections screen reconciliation (Sep 2026)

Comparison of the legacy Home + Roof Sections screens against the web estimator.
Equivalent but relocated (no gap): labor rate / markup preset / markup mode,
commission, tax exempt, per diem, discounts, and labor template all live on the
**Pricing & Warranty** step (legacy showed them on Home); the Setup step now shows a
read-only "Labor & markup" summary with a Click-here-to-edit jump, like legacy's.
Warranty type + max expected wind: Pricing & Warranty step. Update Pricing & Labor:
appears on saved (frozen) bids. Reports/Start!: Review step + Export.

Closed in the web app: Estimator's name (Setup, printed on the proposal), Roof
Sections Summary table with total sq ft (Sections step, shown at 2+ sections), new
sections inherit the previous section's material settings (legacy Defaults panel
effect), section notes / copy / Show Calculations, edges A–D with termination /
blocking / ARP / is-perimeter.

Known deliberate differences (revisit at validation):
- **Pull Test (lbs) + Design Table (psf)** — the web app takes Fastener OC directly;
  the legacy pull-test→OC lookup is not modeled (enter the OC BA shows). Engine pins
  designTable 60.
- **Defaults panel scope** — the web Setup step now has a real Defaults panel (deck
  type, roof system, attached-with, mil, color, avg sheet, warranty) that seeds new
  sections, with Apply-to-existing. Wall type + parapet/underlayment attach defaults
  remain per-item entries on their steps.
- **Per-section Man Hours / Labor Cost inline** (legacy summary grid): available via
  each section's Show Calculations; not shown inline.
- ~~Section edge diagram~~ — now drawn on the Sections step right rail (A top /
  B right / C bottom / D left with termination, blocking, ARP annotations).
- **Date Created** display: web shows Updated on Saved Bids instead.
