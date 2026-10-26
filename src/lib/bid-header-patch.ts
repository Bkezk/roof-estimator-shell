/**
 * The bid's header fields that live on the row beside its contents — status (with the lost
 * reason and the won day), due date, folder, reminder — and which of them a save sends.
 *
 * Owner, Oct 26 (Somerset Career Center): Brian filed the bid under a folder from the Bids list
 * and linked it to its customer from the Customers page while his estimator tab had it open; the
 * tab then could not save ("Brian saved this at 2 pm"). The estimator used to send EVERY header
 * field on every save, so letting such a save through would have put the tab's old folder back.
 * Now it sends only the header fields changed in the tab (`bidHeaderPatch`; saveBid treats an
 * absent field as "leave as is"), the row's newer values for the rest come back with the saved
 * row, and the save toast names them (`keptElsewhere`, `savedToastText`). A new bid sends all.
 */
import { asBidStatus, type BidStatus } from "@/lib/bid-status";
import { normalizeFolder } from "@/lib/bids-folders";

/** The header as the estimator holds it (blank string = none). */
export interface BidHeader {
  status: BidStatus;
  lostReason: string | null;
  wonOn: string;
  dueDate: string;
  folder: string;
  reminderOn: string;
  reminderNote: string;
}

/** The header fields a save carries (saveBidSchema's optional ones; absent = leave as is). */
export interface BidHeaderPatch {
  status?: BidStatus;
  lostReason?: string | null;
  wonOn?: string | null;
  dueDate?: string | null;
  folder?: string | null;
  reminderOn?: string | null;
  reminderNote?: string | null;
}

const day = (s: string | null | undefined) => s || null;
const note = (on: string, text: string) => (on ? text.trim() || null : null);

/** The header as a bids row carries it. */
export function bidHeaderOfRow(row: {
  status: string;
  lost_reason: string | null;
  won_on: string | null;
  due_date: string | null;
  folder: string | null;
  reminder_on: string | null;
  reminder_note: string | null;
}): BidHeader {
  return {
    status: asBidStatus(row.status),
    lostReason: row.lost_reason ?? null,
    wonOn: row.won_on ?? "",
    dueDate: row.due_date ?? "",
    folder: row.folder ?? "",
    reminderOn: row.reminder_on ?? "",
    reminderNote: row.reminder_note ?? "",
  };
}

/**
 * What the save sends: every header field for a new bid (`loaded` null), else only the fields
 * changed in this tab since it loaded the row. The status goes with its lost reason and won
 * day; the reminder date goes with its note.
 */
export function bidHeaderPatch(loaded: BidHeader | null, cur: BidHeader): BidHeaderPatch {
  const full: Required<BidHeaderPatch> = {
    status: cur.status,
    lostReason: cur.status === "lost" ? cur.lostReason : null,
    wonOn: cur.status === "won" ? day(cur.wonOn) : null,
    dueDate: day(cur.dueDate),
    folder: normalizeFolder(cur.folder),
    reminderOn: day(cur.reminderOn),
    reminderNote: note(cur.reminderOn, cur.reminderNote),
  };
  if (!loaded) return full;
  const p: BidHeaderPatch = {};
  const statusChanged =
    loaded.status !== cur.status ||
    (cur.status === "lost" && (loaded.lostReason ?? null) !== (cur.lostReason ?? null)) ||
    (cur.status === "won" && day(loaded.wonOn) !== day(cur.wonOn));
  if (statusChanged) {
    p.status = full.status;
    p.lostReason = full.lostReason;
    p.wonOn = full.wonOn;
  }
  if (day(loaded.dueDate) !== day(cur.dueDate)) p.dueDate = full.dueDate;
  if (normalizeFolder(loaded.folder) !== normalizeFolder(cur.folder)) p.folder = full.folder;
  if (
    day(loaded.reminderOn) !== day(cur.reminderOn) ||
    note(loaded.reminderOn, loaded.reminderNote) !== note(cur.reminderOn, cur.reminderNote)
  ) {
    p.reminderOn = full.reminderOn;
    p.reminderNote = full.reminderNote;
  }
  return p;
}

/**
 * The header fields the saved row carries differently from the tab — changed elsewhere while
 * the tab was open and kept by the save — as words for the toast. A won day the tab left blank
 * is the server's default (today), not someone else's change.
 */
export function keptElsewhere(tab: BidHeader, row: BidHeader): string[] {
  const kept: string[] = [];
  if (tab.status !== row.status) kept.push("status");
  else if (row.status === "lost" && (tab.lostReason ?? null) !== (row.lostReason ?? null))
    kept.push("lost reason");
  if (row.status === "won" && tab.wonOn && day(tab.wonOn) !== day(row.wonOn)) kept.push("won day");
  if (day(tab.dueDate) !== day(row.dueDate)) kept.push("due date");
  if (normalizeFolder(tab.folder) !== normalizeFolder(row.folder)) kept.push("folder");
  if (
    day(tab.reminderOn) !== day(row.reminderOn) ||
    note(tab.reminderOn, tab.reminderNote) !== note(row.reminderOn, row.reminderNote)
  )
    kept.push("reminder");
  return kept;
}

/** The save toast: plain when nothing changed elsewhere, else naming what was kept. */
export function savedToastText(kept: readonly string[]): string {
  if (!kept.length) return "Bid saved";
  const list =
    kept.length === 1 ? kept[0] : `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`;
  const was = kept.length === 1 ? "was" : "were";
  return `Bid saved. The ${list} ${was} changed elsewhere since you opened this bid; that change is kept.`;
}
