# Spec: <short name>

Status: draft | approved | building | confirmed | falsified | partial
Owner approved: <date or blank>
Module: <Estimator | Pricing | Inventory | Prospecting | Customers | Service | Access>
Closes TODO item: <quote the line>

## 1. Hypothesis

One or two sentences. "If we build X, then <user> can <do Y> in <N clicks / N seconds /
without Z>." State the user (office, salesperson, tech, admin) — MODULES.md rule 7 applies
outside the estimator.

## 2. Success criteria (written BEFORE building — do not edit after approval)

Numbered, each one testable by a person who did not build it.

1. …
2. …
3. …

## 3. Falsifiers

What outcome would mean this was the wrong thing to build, or built wrong? If you cannot
write one, the hypothesis is not falsifiable — rewrite §1.

- …

## 4. Out of scope

What this deliberately does not do. Prevents scope creep mid-build.

- …

## 5. Seams and unknowns

Anything that must not be guessed: a legacy formula, a data export format, a third-party API,
a price. Each gets a source to consult and a stop-and-ask rule.

| Unknown | Source that settles it | If unavailable |
| --- | --- | --- |
| … | … | flag and stop |

## 6. Rollback condition

Under what condition is this reverted or hidden behind its access flag rather than fixed
forward? (MODULES.md rule 5: a new module ships behind its flag.)

## 7. Test plan

Map each success criterion to the test(s) that prove it. Unit tests in `src/**/*.test.ts`;
anything needing a browser gets a numbered manual check the owner can do in under 5 minutes.

| Criterion | Test | Type |
| --- | --- | --- |
| 1 | `src/lib/…test.ts › "…"` | unit |
| 2 | manual: open /…, do …, expect … | manual |

## 8. Result (filled in at close — never before)

Outcome: confirmed | falsified | partial
Closing commit: <hash>
Evidence per criterion:

1. …
2. …

What was learned / what changed in the design as a result:

- …

Decisions made during the build (also appended to `docs/DECISIONS.md`):

- …
