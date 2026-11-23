# Every checklist row is answered on a plan's inspection (Nov 23, 2026)

The owner, on the issue put to him: "3 go".

## What was wrong

Since Oct 26 a technician marks only the rows with a problem, and a row left blank reads as OK.
The customer's Care plan report prints "Not checked" for a blank row. So a row a technician
looked at and did not mark told the customer nobody checked it.

## The rule now

On a Roof Care plan's own inspection (an inspection ticket made for one of the plan's visits,
a storm inspection included) every checklist row needs an answer before the ticket is finished:
OK, Issue or N/A. The old "Recommend repairs" row, which the screen hides, is never counted.

An ordinary inspection is unchanged: its rows may be left blank.

Only the move into Done or later is checked. A ticket already finished moves on as before.

## Where it is enforced

1. **The workflow.** The Checklist step shows a notice: "This is a Roof Care plan inspection:
   mark every row OK, Issue or N/A. The customer's Care plan report prints "Not checked" for a
   row left blank." Under it, how many rows are left, by name, and a button "Go to the first
   one". Each row still to answer is outlined and says "Needs an answer". The step is not done,
   and its Next stays off, until every row is answered. The line under Next names the rows.
2. **Complete.** "Before you finish" lists each open row, says to go back to the Checklist
   step, and does not offer "Complete anyway", for a manager either.
3. **The ticket page.** Its checklist shows the same notice and marks.
4. **The server.** Complete (`setFieldStatus`) and the stage picker (`setServiceStage`) both
   refuse first, before a clock is stopped or anything is written, in these words: "Not answered
   yet on the checklist: Ponding, Debris. This is a Roof Care plan inspection, and the
   customer's Care plan report prints "Not checked" for a row left blank. Press Open ticket,
   mark each row OK, Issue or N/A in the Checklist step, then finish the ticket."
5. **The database.** A trigger says the same sentence for every way a stage is written
   (`service_jobs_checklist_rule`, migration `20261124100000_roof_care_checklist_answers.sql`),
   beside the cleaning questions' rule. It was tried on the live database inside a trial that
   was rolled back, and is applied with the rest of the day's database changes.

Nobody is told that someone else fixes it: the words say what to press.

## Proof

Database trial, rolled back, on a temporary Roof Watch plan with two inspections and one
ordinary inspection:

- Never saved: refused, naming all ten rows.
- Saved with two rows blank: refused, naming those two. Authorized from the stage picker: the
  same refusal.
- Every row answered with OK, Issue and N/A: Done went through.
- Already Done, with blanks put back: moved on to Authorized.
- The plan's storm inspection: refused.
- An ordinary inspection with nothing saved: Done went through.
- A move that is not into Done (Scheduled to Open): not checked.

Screen, on the local test server as the test admin, on a temporary plan inspection (ticket
999901, removed after with its plan, visit, pictures, document and history):

- The notice showed ten rows to answer, all ten were marked, the line under Next named them and
  Next was off.
- "Go to the first one" put the focus on the first row's OK.
- After two answers the count read eight. With two left the notice, the marks and the line under
  Next all read "2 rows still need an answer: Debris, Sealants."
- With every row answered the notice read "Every row has an answer.", nothing was marked, the
  line was gone and Next was on.
- The ticket page showed the same notice.

Tests: `src/lib/inspection-answers-nov23.test.ts`, 26 tests. With the changed files put back to
the code before, 9 fail: the refusals at Complete and at the stage picker, the workflow, the
screens and the database rule. Older tests that pinned the lines that moved carry a dated note.

Not tried on the screen: pressing the stage picker with a row open. A refusal there is the
server function's, which the tests prove; a press that went through would have moved a ticket
and told real staff.

## Storm inspections stay under the rule

Asked whether a plan's storm inspection should be left out, as it is for the cleaning questions,
the owner answered on Nov 23: "keep the rule". A storm inspection also ends in a report the
customer reads, so every row is answered there too.
