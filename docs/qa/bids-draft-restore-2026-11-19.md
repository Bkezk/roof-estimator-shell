# Bids: unsaved work kept in the browser, and custom items under the add box

The owner, Nov 19, of the two bid items in that day's list: "Go on 1, 2".

1. Unsaved work on a bid: "keep an unsaved draft in the browser and offer to restore it."
2. "Adding several custom items means scrolling back up." Show the new rows under the add box.

No bid was saved or changed for this. The browser run used a new bid that was never saved.

## 1. The unsaved work is kept and offered back

| Before                                                     | Now                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| What was not saved lived only on the page                  | The page writes it to the browser about 1.5 seconds after each change |
| A closed browser or a lost sign-in threw it away           | Opening the bid again asks: restore it, or discard it                 |
| A reload of a bid started from PlanSwift gave the raw file | The work done since the import is offered back                        |

The rules, in `src/lib/bid-draft.ts`:

- Kept: exactly what Save sends, with the bid's name, its customer link and its header.
- Where: the browser's IndexedDB on that computer, `jbk-bid-drafts`. A bid with its frozen
  prices runs to a few hundred thousand characters, which a few of would fill the browser's
  small key/value storage.
- For whom: one draft for each person and each bid. Another person signed in on the same
  computer is never offered it.
- A bid never saved has no id, so a person's new bids share one slot on that computer.
- A new bid nobody has typed into keeps nothing. It reads "changed" from its own starting
  fills, and those are not anyone's work.
- Never restored unasked. The question has two buttons and cannot be waved away. Until it is
  answered nothing is written over the draft.
- A saved bid is asked about once this tab holds it for editing. A second window on the same
  bid is read-only and is not offered the first window's work in progress.
- If the bid was saved again after the draft's work began, the question says so, and says that
  restoring and pressing Save replaces what was saved since.
- A restored draft leaves the bid "Unsaved changes", and the draft stays until Save.
- Removed by Save, by Discard, and by "Leave without saving".
- Also written at once when the tab is hidden or the page closes.
- Nothing of the engine changed: it stores and restores the data Save sends.

If the browser has no storage to give (a private window, site data blocked), the page works as
before and keeps the draft only while it is open.

## 2. Custom items show right under the add box

| Before                                                   | Now                                                   |
| -------------------------------------------------------- | ----------------------------------------------------- |
| A new custom item was drawn below every stock row        | It is drawn right under the add box, the newest first |
| The cursor jumped to the bottom of the list after adding | It lands in the new row's Quantity, under the box     |

One component draws every Non-DL list, so all nine changed together. Only where the rows are
drawn moved. The saved list stays in the order the items were added, so the totals and the
proposal's order are as before.

## Proof

Tests: `src/lib/bids-draft-restore-nov19.test.ts`, 21 tests. Three older pins were updated with
dated notes (`bids-add-form-dismiss-nov19`, `inspection-bid-link`, `opportunity-reps`). The 49
test files that read these screens pass.

Browser, a new bid never saved, no save sent, no page errors:

1. A fresh new bid, untouched: no question, and nothing kept after 3 more seconds.
2. Two custom items added: the list read box, item two, item one, then the stock rows. The
   cursor was in the new item's Quantity each time.
3. A draft was in the browser's storage 3 seconds later, holding both items.
4. The page was closed with no question, as a crash would. Opened again, it asked "Restore
   your unsaved work?" with the day and time. Escape did not close the question.
5. Restore: both items were back, the bid read unsaved, and the draft was still kept.
6. Closed and opened a third time, then Discard: no draft left and no custom rows.
7. Changed again, then left by the Bids link and "Leave without saving": the draft was gone.
8. A new bid after that: no question.

Not proven in a browser:

- A saved bid's draft. That needs a real bid opened and changed, which this work does not do.
  Its rules are proven by tests: the wait for the edit lock, and "saved again since".
- A bid started from PlanSwift. It needs an import file in the tab.
