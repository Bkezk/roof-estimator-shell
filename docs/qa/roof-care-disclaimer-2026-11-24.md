# Roof Care: the "what an inspection is" term, and a line on the reports, Nov 24, 2026

The owner: "we likely need to add a disclaimer for the plans that were not responsible
essentially if we miss something and they have a leak (draft me it first)". Two drafts were put
to him. He said: "the shorter version looks fine", then "add the line to the inspection report
too but dont make it stand out too much".

## 1. The plan's last term

The terms are now version `2026-11-24.1`. Only the last of the eleven changed.

- Before: "The plan is not a warranty and does not cover replacing the roof."
- Now: "The plan is not a warranty or insurance and does not cover replacing the roof. An
  inspection is a visual check on the day of the visit and cannot find every problem. We are not
  responsible for leaks or for damage from a leak or from a condition we did not find."

It shows wherever the terms show: the sign-up, the public Roof Care page and the agreement
email. The set that was in use, `2026-11-23.1`, is filed word for word in
`src/lib/roof-care-terms-history.ts`, as every earlier set is. No plan had been signed under it.

The owner was told to have his attorney read the term: nobody here can say how a court in
Kentucky or Tennessee treats it.

## 2. One line on both inspection reports

"This report shows what we could see on the day of the visit." It is the last line of the
Inspection report and of the Care plan report, under the recommendation, in italics. The
report text has one size, so italics is what keeps it quiet.

- In the code: `REPORT_DAY_NOTE` in `src/lib/documents/defaults.ts`, for a template made new.
- On the live database: the office's own two templates were given the same line, by one change
  that touched only the paragraph list under each recommendation and refused to run twice. The
  rest of each template, which the owner has edited, was not touched. A report made from now on
  carries the line; a report already made does not change.

## Proof

- Tests: `src/lib/roof-care-terms-history-nov23.test.ts` (the set in use has the new version
  and words; the Nov 23 set was filed with the fingerprint it had while in use; only the last
  term differs), `src/lib/care-plan-report-nov23.test.ts` and `src/lib/documents/model.test.ts`
  (the line is on both reports; with it taken off, the Inspection report's template has the
  fingerprint it had before).
- Checks: lint 0 errors (16 warnings, as before), types clean, 679 test files and 10,408 tests
  pass, the build completes.
- On the live database after the change: both templates hold two paragraphs under the
  recommendation, the second being the line in italics.

## Not proven

A report made on the published site with the line on it, and the term on the published pages:
both need the publish. The owner's own look at one new report is the proof.
