# CLAUDE.md — Bid-O-Matic (roof-estimator-shell)

Read in this order at the start of every session, before touching code:

1. `MODULES.md` — module boundaries, the seven rules. Non-negotiable.
2. `docs/DECISIONS.md` — dated decisions and what would reverse them. Do not relitigate one
   without an entry that supersedes it.
3. `docs/TODO.md` — the owner's open list. Work the top item unless told otherwise.
4. The spec for the work you are about to do, in `docs/specs/`. If there is none, write one
   from `docs/specs/TEMPLATE.md` and get it approved before implementing. No spec, no build.

## What this is

Internal web app for one commercial roofing contractor (Duro-Last systems). It replaced a
discontinued Windows estimator (Bid-Advantage) and is growing into prospecting, CRM, service
and inventory. Stack: TanStack Start + React 19, Supabase, Vite, Vitest. Lovable builds and
deploys from `main`.

## Commands

    npm ci                      # what CI runs: installs exactly package-lock.json
    npm install                 # after adding/removing a dependency; commit package-lock.json
    npm run dev
    npx tsc --noEmit -p .       # typecheck
    npm run lint                # 0 errors required; a handful of warnings are pre-existing
    npm test                    # vitest run — 640+ tests, ~10 s

`bun.lock` is Lovable's lockfile; `package-lock.json` is CI's. When a dependency changes, update
both (`npm install` and `bun install`) so neither drifts.

## Definition of done

Work is done only when ALL of the following are true. Do not report done otherwise.

- Typecheck, lint and tests pass locally. Run all three yourself before reporting; do not ask
  the owner to run them.
- Every behaviour in the spec's success criteria has a test that would fail without the change.
- Any change under `src/lib/engine/` has a matching entry in `docs/legacy-money-parity.md`
  (MODULES.md rule 1).
- Any live database change ships as a migration in `supabase/migrations/` in the same commit.
- The spec's **Result** section is filled in: confirmed / falsified / partial, with the
  evidence (test names, numbers, screenshots).
- `docs/TODO.md`: the item moved to Done with the closing commit hash.
- New decisions appended to `docs/DECISIONS.md`.

## How to work with the owner

- The owner is not a coder. Report outcomes, evidence and choices — not diffs. A choice
  should be framed as options with a recommendation, never an open-ended question.
- Prefer one long autonomous run over many short check-ins: plan, get the plan approved,
  then implement, test and self-fix to green before coming back.
- When the spec and the code disagree, the spec wins until the owner changes the spec.
- Never guess a data format, a price, a formula or a legacy behaviour. Flag it, cite the
  source you would need, and stop at that seam. `FLAGGED FOR …` markers in the engine are
  open questions, not decoration — never silently resolve one.
- Never rewrite published history (Lovable sync). Branch, PR, merge when green.
- Secrets never go in the repo or in chat. The committed `.env` holds only the Supabase
  publishable key; nothing else belongs there.
