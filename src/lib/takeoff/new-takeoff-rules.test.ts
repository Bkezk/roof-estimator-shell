/**
 * Owner, Oct 27: "customer shouldn't be required on takeoff please remove that, just make it the
 * name and plan file or aerial screenshot or address." The create rules as a pure helper, and
 * source pins that the New takeoff dialog no longer gates on a customer. Fails on the old code
 * (the toast and the `canPickCustomer ? !!account` gates).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canCreateTakeoff, newTakeoffBlocker } from "./new-takeoff-rules";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("canCreateTakeoff: the customer is never required", () => {
  it("PDF / screenshot need a name and a file", () => {
    expect(canCreateTakeoff({ mode: "pdf", name: "Smith roof", file: {}, aerial: null })).toBe(
      true,
    );
    expect(canCreateTakeoff({ mode: "image", name: "Smith roof", file: {}, aerial: null })).toBe(
      true,
    );
    expect(canCreateTakeoff({ mode: "pdf", name: "   ", file: {}, aerial: null })).toBe(false);
    expect(canCreateTakeoff({ mode: "pdf", name: "Smith roof", file: null, aerial: null })).toBe(
      false,
    );
    expect(canCreateTakeoff({ mode: "image", name: "", file: null, aerial: {} })).toBe(false);
  });
  it("From an address needs the address picture; the name is optional", () => {
    expect(canCreateTakeoff({ mode: "address", name: "", file: null, aerial: {} })).toBe(true);
    expect(canCreateTakeoff({ mode: "address", name: "x", file: {}, aerial: null })).toBe(false);
  });
  it("the blocker names what is missing", () => {
    expect(newTakeoffBlocker({ mode: "pdf", name: "", file: {}, aerial: null })).toBe(
      "Give the takeoff a name — the job or building, not the file.",
    );
    expect(newTakeoffBlocker({ mode: "pdf", name: "A", file: null, aerial: null })).toBe(
      "Choose the plan-set PDF first.",
    );
    expect(newTakeoffBlocker({ mode: "image", name: "A", file: null, aerial: null })).toBe(
      "Choose the screenshot first.",
    );
    expect(newTakeoffBlocker({ mode: "address", name: "", file: null, aerial: null })).toBe(
      "Find the address (or pick the building on the map) first.",
    );
    expect(newTakeoffBlocker({ mode: "address", name: "", file: null, aerial: {} })).toBeNull();
    expect(newTakeoffBlocker({ mode: "pdf", name: "A", file: {}, aerial: null })).toBeNull();
  });
});

describe("the New takeoff dialog", () => {
  const src = read("src/components/takeoff-page.tsx");
  it("no longer refuses without a customer", () => {
    expect(src).not.toContain(
      "Pick the customer this takeoff is for (or add them) before creating it.",
    );
    expect(src).not.toContain("canPickCustomer ? !!account");
    expect(src).toContain("const ready = canCreateTakeoff({ mode: source, name, file, aerial });");
    expect(src).toContain("newTakeoffBlocker({ mode: source, name, file, aerial })");
  });
  it("keeps the customer as an optional field that still prefills the name", () => {
    expect(src).toContain('<Label htmlFor="takeoff-customer">Customer (optional)</Label>');
    expect(src).toContain("if (!nameTouched) setName(v ? suggestTakeoffName(v.label");
    expect(src).toContain("...(account ? { account_id: account.account_id } : {}),");
    // The list copes with a takeoff that has no customer.
    expect(src).toContain("{t.account_id && (");
    expect(src).toContain('!(t.account?.name ?? "").toLowerCase().includes(q)');
  });
});
