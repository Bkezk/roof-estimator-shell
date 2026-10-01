import { describe, expect, it } from "vitest";

import { SERVICE_STAGES } from "@/lib/service.functions";
import { parseServiceSearch, STAGE_VALUES } from "./service-search";

const T = "7c3f8a4e-1b2d-4c5e-8f9a-0b1c2d3e4f5a";
const A = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const S = "2b3c4d5e-6f7a-4b1c-8d2e-3f4a5b6c7d8e";

describe("/service search params", () => {
  it("knows the same stages as the server", () => {
    expect([...STAGE_VALUES]).toEqual([...SERVICE_STAGES]);
  });
  it("reads a ticket id and close-out as before", () => {
    expect(parseServiceSearch({ id: "x" })).toEqual({ id: "x" });
    expect(parseServiceSearch({ id: "x", closeout: "1" })).toEqual({ id: "x", closeout: 1 });
    expect(parseServiceSearch({ id: "x", closeout: true })).toEqual({ id: "x", closeout: 1 });
    // A ticket wins over the list presets.
    expect(parseServiceSearch({ id: "x", stage: "openwork", overdue: 1 })).toEqual({ id: "x" });
  });
  it("reads a new ticket's prefill as before", () => {
    expect(parseServiceSearch({ new: 1, tech: "t1", date: "2026-10-02" })).toEqual({
      new: 1,
      tech: "t1",
      date: "2026-10-02",
    });
    expect(parseServiceSearch({ new: "1", date: "Oct 2", from: T })).toEqual({ new: 1, from: T });
    expect(parseServiceSearch({ new: true, account: A, site: S })).toEqual({
      new: 1,
      account: A,
      site: S,
    });
    // A site only with its account; a non-uuid account is dropped.
    expect(parseServiceSearch({ new: 1, site: S })).toEqual({ new: 1 });
    expect(parseServiceSearch({ new: 1, account: "acme" })).toEqual({ new: 1 });
    // A new ticket ignores the list presets.
    expect(parseServiceSearch({ new: 1, stage: "open", overdue: "1" })).toEqual({ new: 1 });
  });
  it("is the plain list without params", () => {
    expect(parseServiceSearch({})).toEqual({});
    expect(parseServiceSearch({ new: 0 })).toEqual({});
  });
  it("presets the list's stage chip: Open work or one stage", () => {
    expect(parseServiceSearch({ stage: "openwork" })).toEqual({ stage: "openwork" });
    for (const s of SERVICE_STAGES) expect(parseServiceSearch({ stage: s })).toEqual({ stage: s });
    expect(parseServiceSearch({ stage: "bogus" })).toEqual({});
    expect(parseServiceSearch({ stage: 3 })).toEqual({});
  });
  it("presets the Overdue filter with overdue=1", () => {
    expect(parseServiceSearch({ stage: "openwork", overdue: 1 })).toEqual({
      stage: "openwork",
      overdue: 1,
    });
    expect(parseServiceSearch({ overdue: "1" })).toEqual({ overdue: 1 });
    expect(parseServiceSearch({ overdue: "0" })).toEqual({});
  });
});
