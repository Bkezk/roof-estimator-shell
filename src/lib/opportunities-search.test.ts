import { describe, expect, it } from "vitest";

import { OPP_STATUSES } from "@/lib/opportunities.functions";
import { parseOpportunitiesSearch, STATUS_VALUES } from "./opportunities-search";

describe("/opportunities search params", () => {
  it("knows the same statuses as the server", () => {
    expect([...STATUS_VALUES]).toEqual([...OPP_STATUSES]);
  });
  it("reads an id and new as before", () => {
    expect(parseOpportunitiesSearch({ id: "x" })).toEqual({ id: "x" });
    expect(parseOpportunitiesSearch({ id: "" })).toEqual({});
    expect(parseOpportunitiesSearch({ new: 1 })).toEqual({ new: 1 });
    expect(parseOpportunitiesSearch({ new: "1" })).toEqual({ new: 1 });
    expect(parseOpportunitiesSearch({ new: true })).toEqual({ new: 1 });
    expect(parseOpportunitiesSearch({ id: "x", new: 1 })).toEqual({ id: "x" });
    // An opened or new opportunity ignores the list presets.
    expect(parseOpportunitiesSearch({ id: "x", status: "allopen", overdue: 1 })).toEqual({
      id: "x",
    });
    expect(parseOpportunitiesSearch({ new: 1, status: "won" })).toEqual({ new: 1 });
  });
  it("is the plain list without params", () => {
    expect(parseOpportunitiesSearch({})).toEqual({});
  });
  it("presets the list's status chip: All open or one status", () => {
    expect(parseOpportunitiesSearch({ status: "allopen" })).toEqual({ status: "allopen" });
    for (const s of OPP_STATUSES)
      expect(parseOpportunitiesSearch({ status: s })).toEqual({ status: s });
    expect(parseOpportunitiesSearch({ status: "bogus" })).toEqual({});
  });
  it("presets the Overdue filter with overdue=1", () => {
    expect(parseOpportunitiesSearch({ status: "allopen", overdue: "1" })).toEqual({
      status: "allopen",
      overdue: 1,
    });
    expect(parseOpportunitiesSearch({ overdue: 1 })).toEqual({ overdue: 1 });
    expect(parseOpportunitiesSearch({ overdue: "yes" })).toEqual({});
  });
  it("filters to one person with assignee=<uuid> (the Owner view's per-person numbers)", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseOpportunitiesSearch({ status: "allopen", assignee: id })).toEqual({
      status: "allopen",
      assignee: id,
    });
    expect(parseOpportunitiesSearch({ assignee: id, overdue: 1 })).toEqual({
      assignee: id,
      overdue: 1,
    });
    expect(parseOpportunitiesSearch({ assignee: "bob" })).toEqual({});
    expect(parseOpportunitiesSearch({ assignee: 5 })).toEqual({});
    // An opened opportunity ignores it.
    expect(parseOpportunitiesSearch({ id: "x", assignee: id })).toEqual({ id: "x" });
  });
});
