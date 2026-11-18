/**
 * "Viewable to technicians" on a ticket's Activity entries (owner, Nov 17: "on the activity log
 * have a check box that says viewable to technicians and anything with that check box should
 * also show" in the pop-up a technician opens from History at this property).
 *
 * An entry a person makes on a ticket (a Note, or Called / Texted / Emailed / Visited) carries a
 * tick, crm_contact_log.tech_visible. Ticked: the entry shows in that ticket's pop-up wherever
 * the property's history is read, so a technician on a later ticket there reads it. Not ticked:
 * it stays on its own ticket, as every entry did before.
 *
 * The office chooses, entry by entry, when writing it or later. A technician-only login is not
 * asked: what a technician writes is for technicians, so it is always ticked. The lines the site
 * writes itself and the close-out's summary carry no tick.
 *
 * Pure: the words and the rules. The database says the same (contact_log_set_tech_visible,
 * 20261117190000_history_popup_tech_visible.sql).
 */
import { canAccess, isFieldOnly, type AccessLike } from "@/lib/access";

export const TECH_VISIBLE_LABEL = "Viewable to technicians";
export const TECH_VISIBLE_HELP =
  "Shows in this ticket's pop-up under History at this property, for technicians on later tickets here.";

/** The entries a tick can sit on: the ones a person makes. Not "note" (the site's own lines) or "service". */
export const TECH_VISIBLE_METHODS = [
  "called",
  "texted",
  "emailed",
  "visited",
  "other",
  "comment",
] as const;
export const canBeTechVisible = (method: string): boolean =>
  (TECH_VISIBLE_METHODS as readonly string[]).includes(method);

/**
 * Who is shown the checkbox: the office that works tickets (Service access, a manager or an
 * admin; not a technician-only login). Someone who only reads tickets through Customers access
 * is not asked (Nov 18: the database refused their tick on an entry already made, and now
 * refuses it on a new one too; 20261118210000).
 */
export const choosesTechVisible = (p: AccessLike | null | undefined): boolean =>
  !!p && !isFieldOnly(p) && canAccess(p, "service");

/**
 * What a new entry is saved with: a technician-only writer's ticket entry is always viewable to
 * technicians; the office's is as its checkbox stood. Only on a ticket, only on an entry a person
 * makes.
 */
export function techVisibleOnSave(input: {
  profile: AccessLike | null | undefined;
  kind: string;
  method: string;
  ticked: boolean | null | undefined;
}): boolean {
  if (input.kind !== "ticket" || !canBeTechVisible(input.method)) return false;
  if (isFieldOnly(input.profile)) return true;
  // Only someone who works tickets chooses; anyone else's entry stays on its own ticket.
  return choosesTechVisible(input.profile) && input.ticked === true;
}
