/**
 * What a technician reads when a ticket is in the office's hands (owner, Oct 6). Since M9 (Oct 5)
 * a Done ticket is reviewed first and sits at Authorized before it is invoiced; the close-out
 * screen and the inspection save said "The office has invoiced or closed this ticket" for that
 * stage too, which was not true yet. Pure: no I/O; the callers add their own tail ("; ask the
 * office …").
 */
export function officeStageMessage(stage: string): string {
  return stage === "authorized"
    ? "The office is reviewing this ticket — it is Authorized"
    : "The office has invoiced or closed this ticket";
}
