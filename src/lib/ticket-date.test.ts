import { describe, expect, it } from "vitest";
import {
  OPPORTUNITY_DATE_REQUIRED,
  TICKET_DATE_REQUIRED,
  assignDateProblem,
  opportunityDateProblem,
  ticketDateProblem,
} from "./ticket-date";

describe("ticketDateProblem — a ticket always has a date (owner, Oct 1)", () => {
  it("a new ticket needs a date", () => {
    expect(ticketDateProblem({})).toBe(TICKET_DATE_REQUIRED);
    expect(ticketDateProblem({ scheduled_date: null })).toBe(TICKET_DATE_REQUIRED);
    expect(ticketDateProblem({ scheduled_date: "" })).toBe(TICKET_DATE_REQUIRED);
    expect(ticketDateProblem({ scheduled_date: "2026-10-03" })).toBeNull();
  });
  it("an update may leave the date alone but may not clear it", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(ticketDateProblem({ id })).toBeNull();
    expect(ticketDateProblem({ id, scheduled_date: "2026-10-03" })).toBeNull();
    expect(ticketDateProblem({ id, scheduled_date: null })).toBe(TICKET_DATE_REQUIRED);
    expect(ticketDateProblem({ id, scheduled_date: "" })).toBe(TICKET_DATE_REQUIRED);
  });
  it("the board needs a day on every drop", () => {
    expect(assignDateProblem(null)).toBe(TICKET_DATE_REQUIRED);
    expect(assignDateProblem("2026-10-03")).toBeNull();
  });
});

describe("opportunityDateProblem", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  it("a new opportunity may be blank (the admin default fills it)", () => {
    expect(opportunityDateProblem({})).toBeNull();
    expect(opportunityDateProblem({ expected_close: null })).toBeNull();
  });
  it("an update may not clear the date", () => {
    expect(opportunityDateProblem({ id, expected_close: null })).toBe(OPPORTUNITY_DATE_REQUIRED);
    expect(opportunityDateProblem({ id, expected_close: "" })).toBe(OPPORTUNITY_DATE_REQUIRED);
    expect(opportunityDateProblem({ id, expected_close: "2026-11-01" })).toBeNull();
    expect(opportunityDateProblem({ id })).toBeNull();
  });
});
