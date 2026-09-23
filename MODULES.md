# Modules

One app, one Supabase project, one deploy (Lovable builds from `main`). Each module has its
own route group, access flag, and folder. The plan is `docs/roofing-ops-portal-brief.md`.

| Module           | Access flag | Routes                            | Code                                                                                                                                                                      | Tables it owns                                  |
| ---------------- | ----------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Estimator        | `estimate`  | `/bids`, `/estimate`, `/proposal` | `src/routes/estimate.tsx`, `src/routes/bids.tsx`, `src/lib/engine/`, `src/lib/proposal-bid.ts`, `src/lib/bids.functions.ts`, `src/components/*-screen(s).tsx`             | `bids`, `bid_locks`                             |
| Estimate Pricing | `pricing`   | `/admin/*` (except users)         | `src/routes/admin.*.tsx`, `src/lib/admin-*.functions.ts`                                                                                                                  | pricing, labor and catalog tables               |
| Inventory        | `inventory` | `/inventory`                      | `src/components/inventory-page.tsx`, `src/lib/inventory.functions.ts`, `src/lib/order-list*.ts`, `src/lib/stock-units.ts`                                                 | `inventory_movements`, `inventory_settings`     |
| Prospecting      | `prospect`  | `/prospect`                       | `src/routes/prospect.tsx`, `src/components/prospect-page.tsx`, `src/components/prospect-map.tsx`, `src/lib/prospect.ts`, `src/lib/prospect.functions.ts`, `src/lib/gis/*` | `buildings`, `roofs`, `tasks`, `address_points` |
| Users & access   | admin role  | `/admin/users`                    | `src/routes/admin.users.tsx`, `src/lib/auth.functions.ts`, `src/lib/access.ts`                                                                                            | `profiles`                                      |

## Rules

1. **The estimator's money engine (`src/lib/engine/`) changes only with an entry in
   `docs/legacy-money-parity.md` and a test.** Other modules read bid data; they write only the
   nullable link columns on `bids` (`building_id`, `roof_id`, `takeoff_id`, `opportunity_id`).
2. **No cross-module imports** — enforced by ESLint (`eslint.config.js`, CI fails on it).
   The estimator never imports prospecting code and prospecting never imports estimator code.
   They meet in exactly two places: the nullable link columns on `bids`, and plain values in a
   URL (a building hands the estimator an address and a width × length; the estimator's
   generic prefill reads them without knowing where they came from). Shared code lives in
   `src/lib/` (access, auth, UI helpers) and `src/components/ui/`. A module's server functions
   check its own access flag with `assertPageAccess`; RLS enforces the same flag.
3. **Every live database change ships as a migration** in `supabase/migrations/`, applied and
   verified, in the same commit as the code that needs it.
4. **`main` must stay green.** CI (`.github/workflows/ci.yml`) runs typecheck, lint and tests.
   Work on a branch, open a pull request, merge when green. Never rewrite published history
   (Lovable sync).
5. **A new module ships behind its access flag**: nobody sees it until an admin grants the
   page, so a half-built module never shows in the nav.
6. **New tables** carry `created_by`, `created_at`, `updated_at` (with the
   `update_updated_at_column` trigger) and RLS by page flag; deletes are soft where history
   matters.
7. **Salesperson-first outside the estimator** (owner, Sep 24). The user is a non-technical
   salesperson: the map, the building's size and address and the "New bid" button are on
   screen at once, and anything that needs a layer URL, a filter or a preview lives behind one
   setup button with an Advanced section. Judge a screen by clicks-to-useful-sales-info.
