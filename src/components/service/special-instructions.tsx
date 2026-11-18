/**
 * A ticket's Special instructions as a box to READ (owner, Nov 18): above the timeline of
 * History at this property, on the My tickets card and at the top of the close-out, so a
 * technician reads them where they work, whether or not the property has any history.
 *
 * Nothing is drawn without text. A technician-only login is never handed instructions the
 * office keeps to itself (lib/ticket-instructions.ts), so there is nothing to hide here: the
 * "office only" line is for the office, on the screens it shares with technicians.
 */
import { INSTRUCTIONS_OFFICE_ONLY } from "@/lib/ticket-instructions";
import { ClampedText, type ClampLines } from "@/components/service/clamped-text";
import { TICKET_NOTES_LABEL } from "@/lib/field-ticket-page";

export function SpecialInstructionsBox({
  text,
  officeOnly = false,
  title = TICKET_NOTES_LABEL,
  className = "",
  where,
  clampLines,
}: {
  text: string | null | undefined;
  /** The office is told when technicians do not see these. */
  officeOnly?: boolean;
  title?: string;
  className?: string;
  /** Which screen it is on, for the tests and the browser checks. */
  where: "history" | "card" | "closeout";
  /**
   * Stop at this many lines, with "Show all" for the rest (owner, Nov 18: the top of the
   * workflow was busy). Left out: the whole text, as on the card and in the history.
   */
  clampLines?: ClampLines;
}) {
  const body = (text ?? "").trim();
  if (!body) return null;
  return (
    <section
      className={`rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 ${className}`}
      aria-label={title}
      data-special-instructions={where}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
      {clampLines ? (
        <ClampedText
          name="instructions"
          lines={clampLines}
          text={body}
          className="mt-1 whitespace-pre-line break-words text-sm"
        />
      ) : (
        <p className="mt-1 whitespace-pre-line break-words text-sm">{body}</p>
      )}
      {officeOnly && (
        <p className="mt-1 text-xs opacity-80" data-special-instructions-office-only>
          {INSTRUCTIONS_OFFICE_ONLY}
        </p>
      )}
    </section>
  );
}
