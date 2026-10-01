/**
 * Every ticket and opportunity carries a date (owner, Oct 1: "you have to have a date in order
 * to create a ticket — there's no sense in having service / inspections / opportunities if we
 * never need to know when to follow up"). The server functions throw these messages; the forms
 * show them inline and keep the Create button off until a date is picked.
 */

export const TICKET_DATE_REQUIRED = "Pick a date — every ticket needs a follow-up date";
export const OPPORTUNITY_DATE_REQUIRED =
  "Pick an expected close date — every opportunity needs a follow-up date";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The problem with a ticket's date, or null. Creating (no id) needs a date; updating may leave
 * the date out (unchanged) but may not clear it. A technician's field saves never send the
 * date, so an old undated ticket still moves through its stages.
 */
export function ticketDateProblem(input: {
  id?: string | null | undefined;
  scheduled_date?: string | null | undefined;
}): string | null {
  const d = input.scheduled_date;
  if (d === undefined) return input.id ? null : TICKET_DATE_REQUIRED;
  return d && YMD.test(d) ? null : TICKET_DATE_REQUIRED;
}

/** The board: a drop onto a cell carries its day; the rail keeps the ticket's own day. */
export function assignDateProblem(scheduled_date: string | null | undefined): string | null {
  return scheduled_date && YMD.test(scheduled_date) ? null : TICKET_DATE_REQUIRED;
}

/**
 * An opportunity: a new one with no date takes the admin default (crm_settings), so only an
 * update that clears the date is refused.
 */
export function opportunityDateProblem(input: {
  id?: string | null | undefined;
  expected_close?: string | null | undefined;
}): string | null {
  if (!input.id) return null;
  if (input.expected_close === undefined) return null;
  return input.expected_close && YMD.test(input.expected_close) ? null : OPPORTUNITY_DATE_REQUIRED;
}
