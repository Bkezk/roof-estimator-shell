/**
 * Owner, Nov 3: "on the takeoffs when you want a satelitte picture theres no easy way to search
 * an address from the new takeoff prompt." Three fixes, each pinned here so the old code fails:
 *   1. the satellite picture is the first option and the default, named so, with the address
 *      box first in the form and focused;
 *   2. a status line says what the search is doing while it runs (the first search of a session
 *      was measured at 15–30+ seconds with only a spinner);
 *   3. customer properties on file are suggested as the address is typed, and a pick files the
 *      takeoff under that customer and searches at once.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  suggestAddressInput,
  suggestTakeoffAddresses,
  type AddressSuggestion,
} from "@/lib/takeoff-aerial.functions";
import { fakeSupabase } from "@/test/fake-supabase";

import {
  SUGGEST_LIMIT,
  shapeSuggestions,
  suggestQuery,
  suggestionAddressLine,
  suggestionLabel,
  type SuggestSiteRow,
} from "./address-suggest";
import { FIND_LONG_MS, FIND_SLOW_MS, findProgressLine } from "./find-progress";

const read = (rel: string) => readFileSync(rel, "utf8");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
type Row = Record<string, unknown>;
type Call<T> = (a: { data: Row; context: unknown }) => Promise<T>;

afterEach(() => vi.unstubAllGlobals());

// ── 1. The satellite picture first ──────────────────────────────────────────────────────────

describe("1. the satellite picture is the obvious choice", () => {
  const dialog = read("src/components/takeoff-page.tsx");
  const picker = read("src/components/takeoff/aerial-pick.tsx");
  it("is the first pill and the default when the dialog opens (and after a reset)", () => {
    expect(dialog).toContain('const TAKEOFF_SOURCES = ["address", "file"] as const;');
    expect(dialog).toContain('const DEFAULT_SOURCE: TakeoffSource = "address";');
    expect(dialog).toContain("useState<TakeoffSource>(DEFAULT_SOURCE)");
    expect(dialog).toContain("setSource(DEFAULT_SOURCE);");
    expect(dialog).not.toContain('useState<TakeoffSource>("pdf")');
  });
  it("is named for what it is; the PDF and the screenshot are one Upload a file pill (owner, Nov 3)", () => {
    expect(dialog).toContain('address: "Satellite picture",');
    expect(dialog).toContain('file: "Upload a file",');
    expect(dialog).toContain('const SOURCE_ACCEPT = "application/pdf,image/png,image/jpeg";');
    expect(dialog).toContain("Plan-set PDF or screenshot <span");
    expect(dialog).not.toContain('"Plan-set PDF",');
    expect(dialog).not.toContain('"Screenshot you took"');
    expect(dialog).not.toContain('"From an address"');
    expect(dialog).not.toContain('"Aerial screenshot"');
    expect(dialog).toContain(
      '"Search an address: the satellite picture comes up (Kentucky and Tennessee), frame the roof and use it. It opens scaled, ready to measure."',
    );
    expect(dialog).toContain(
      "Search an address for its satellite picture (scaled for you), or open a plan-sheet PDF",
    );
  });
  it("the address box comes before the customer and the name, with the cursor in it", () => {
    const addressAt = dialog.indexOf("<AerialAddressPicker");
    const customerAt = dialog.indexOf('<Label htmlFor="takeoff-customer">');
    const nameAt = dialog.indexOf('<Label htmlFor="takeoff-name">');
    expect(addressAt).toBeGreaterThan(0);
    expect(addressAt).toBeLessThan(customerAt);
    expect(customerAt).toBeLessThan(nameAt);
    expect(dialog).toContain(
      "<AerialAddressPicker\n              disabled={!!busy}\n              autoFocus\n              onChange={setAerial}\n              onSuggestion={pickSuggestion}\n            />",
    );
    // The customer box takes the focus only on the file option.
    expect(dialog).toContain('autoFocus={source !== "address"}');
    expect(picker).toContain("autoFocus={autoFocus}");
  });
});

describe("1b. one dialog shape whichever option is open (owner, Nov 3)", () => {
  it("the content is the wide, scrolling card for both options", () => {
    const dialog = read("src/components/takeoff-page.tsx");
    expect(dialog).toContain('className="max-h-[92vh] overflow-y-auto sm:max-w-3xl"');
    expect(dialog).not.toContain('"sm:max-w-md"');
  });
});

// ── 2. The status line ──────────────────────────────────────────────────────────────────────

describe("2. the search says what it is doing", () => {
  it("names the map being searched, then admits the state map is slow, then says to give it a moment", () => {
    expect(findProgressLine(0, "KY")).toBe(
      "Searching our map data, then Kentucky's address points…",
    );
    expect(findProgressLine(2_000, "TN")).toBe(
      "Searching our map data, then Tennessee's address points…",
    );
    expect(findProgressLine(5_999, null)).toBe(
      "Searching our map data, then Kentucky's and Tennessee's address points…",
    );
    expect(findProgressLine(FIND_SLOW_MS, "KY")).toBe(
      "Still searching — the state map is slow to answer right now. The first search can take up to half a minute.",
    );
    expect(findProgressLine(FIND_LONG_MS, "KY")).toBe(
      "Still waiting on the state map. Give it a moment more, or press Find again if nothing comes.",
    );
    expect(findProgressLine(90_000, null)).toContain("Give it a moment more");
  });
  it("shows under the address box while the lookup runs, ticking every second", () => {
    const picker = read("src/components/takeoff/aerial-pick.tsx");
    expect(picker).toContain("{findProgressLine(elapsed, hint.state)}");
    expect(picker).toContain("{lookup.isPending && (");
    expect(picker).toContain('role="status"');
    expect(picker).toContain("data-find-progress");
    expect(picker).toContain("const t = setInterval(() => setElapsed(Date.now() - t0), 1000);");
  });
});

// ── 3. Suggestions as you type ──────────────────────────────────────────────────────────────

describe("3. suggestQuery: when the box asks for suggestions", () => {
  it("from three characters, trimmed; never for coordinates or a map link", () => {
    expect(suggestQuery("")).toBeNull();
    expect(suggestQuery("  41 ")).toBeNull();
    expect(suggestQuery("412")).toBe("412");
    expect(suggestQuery("  412  Main ")).toBe("412 Main");
    expect(suggestQuery("Corbin")).toBe("Corbin");
    expect(suggestQuery("36.9757, -84.1091")).toBeNull();
    expect(suggestQuery("https://maps.google.com/?q=Corbin")).toBeNull();
  });
});

const site = (
  over: Partial<SuggestSiteRow> & { id: string; account_id: string },
): SuggestSiteRow => ({
  name: "Plant 2",
  address1: "412 Main St",
  address2: null,
  city: "Murray",
  state: "KY",
  zip: "42071",
  lat: 36.6103,
  lng: -88.3148,
  ...over,
});

describe("3. shapeSuggestions", () => {
  it("one line per property with a street, its customer named, sorted by customer then property, capped", () => {
    const accounts = new Map([
      ["a1", "Zed Foods"],
      ["a2", "Acme Foods"],
    ]);
    const out = shapeSuggestions(
      [
        site({ id: "s1", account_id: "a1", name: "Warehouse" }),
        site({ id: "s2", account_id: "a2", name: "Plant 2", address2: "Suite 4" }),
        site({ id: "s3", account_id: "a2", name: "Plant 1", lat: null, lng: null }),
        // No street: cannot be searched, left out however well the name matches.
        site({ id: "s4", account_id: "a2", name: "Main Office", address1: "  " }),
        // A customer that is gone (not in the map): left out.
        site({ id: "s5", account_id: "gone", name: "Old" }),
      ],
      accounts,
    );
    expect(out.map((s) => [s.account_name, s.site_name])).toEqual([
      ["Acme Foods", "Plant 1"],
      ["Acme Foods", "Plant 2"],
      ["Zed Foods", "Warehouse"],
    ]);
    expect(out[1]).toEqual({
      site_id: "s2",
      account_id: "a2",
      account_name: "Acme Foods",
      site_name: "Plant 2",
      address: "412 Main St, Suite 4, Murray, KY 42071",
      lat: 36.6103,
      lng: -88.3148,
    });
    expect(out[0]!.lat).toBeNull();
    expect(out[0]!.lng).toBeNull();
    const many = shapeSuggestions(
      Array.from({ length: 20 }, (_, i) => site({ id: `s${i}`, account_id: "a1", name: `P${i}` })),
      accounts,
    );
    expect(many).toHaveLength(SUGGEST_LIMIT);
  });
  it("the address line and the customer label", () => {
    expect(
      suggestionAddressLine({
        address1: "1 Oak",
        address2: null,
        city: null,
        state: "TN",
        zip: null,
      }),
    ).toBe("1 Oak, TN");
    expect(
      suggestionAddressLine({
        address1: "1 Oak",
        address2: "",
        city: "Knoxville",
        state: "",
        zip: "",
      }),
    ).toBe("1 Oak, Knoxville");
    const s: AddressSuggestion = {
      site_id: "s",
      account_id: "a",
      account_name: "Acme Foods",
      site_name: "Plant 2",
      address: "x",
      lat: null,
      lng: null,
    };
    expect(suggestionLabel(s)).toBe("Acme Foods — Plant 2");
    expect(suggestionLabel({ ...s, site_name: "Acme Foods" })).toBe("Acme Foods");
    expect(suggestionLabel({ ...s, site_name: " " })).toBe("Acme Foods");
  });
});

describe("3. suggestTakeoffAddresses (the server half)", () => {
  const call = (db: unknown, q: string) =>
    (suggestTakeoffAddresses as unknown as Call<AddressSuggestion[]>)({
      data: { q },
      context: { supabase: db, userId: ME },
    });
  const tables = {
    crm_accounts: [
      { id: "a1", name: "Acme Foods", deleted_at: null },
      { id: "a2", name: "Gone Co", deleted_at: "2026-01-01" },
    ],
    crm_sites: [
      {
        id: "s1",
        account_id: "a1",
        name: "Plant 2",
        address1: "412 Main St",
        address2: null,
        city: "Murray",
        state: "KY",
        zip: "42071",
        lat: 36.61,
        lng: -88.31,
        deleted_at: null,
      },
      {
        id: "s2",
        account_id: "a1",
        name: "Main Street Annex",
        address1: null,
        address2: null,
        city: "Murray",
        state: "KY",
        zip: null,
        lat: null,
        lng: null,
        deleted_at: null,
      },
      {
        id: "s3",
        account_id: "a1",
        name: "Deleted",
        address1: "9 Main St",
        address2: null,
        city: "Murray",
        state: "KY",
        zip: null,
        lat: null,
        lng: null,
        deleted_at: "2026-01-01",
      },
      {
        id: "s4",
        account_id: "a2",
        name: "Shop",
        address1: "7 Main St",
        address2: null,
        city: "Murray",
        state: "KY",
        zip: null,
        lat: null,
        lng: null,
        deleted_at: null,
      },
    ],
  };
  const withProfile = (access: string[]) =>
    fakeSupabase({
      profiles: [{ id: ME, role: "user", access, technician: false }],
      ...tables,
    });

  it("matches the property's name, street or town; live properties with a street under live customers only", async () => {
    const env = withProfile(["takeoff", "customers"]);
    const out = await call(env.db, "main");
    expect(out).toEqual([
      {
        site_id: "s1",
        account_id: "a1",
        account_name: "Acme Foods",
        site_name: "Plant 2",
        address: "412 Main St, Murray, KY 42071",
        lat: 36.61,
        lng: -88.31,
      },
    ]);
    expect((await call(env.db, "murray")).map((s) => s.site_id)).toEqual(["s1"]);
    expect(await call(env.db, "zzz")).toEqual([]);
  });
  it("Takeoff access is required; without the customer book the list is empty, not an error", async () => {
    await expect(call(withProfile(["service"]).db, "main")).rejects.toThrow(
      "Forbidden: Takeoff access required",
    );
    expect(await call(withProfile(["takeoff"]).db, "main")).toEqual([]);
    expect((await call(withProfile(["takeoff", "estimate"]).db, "main")).length).toBe(1);
    expect((await call(withProfile(["takeoff", "service"]).db, "main")).length).toBe(1);
  });
  it("the input is one to 120 characters, trimmed", () => {
    expect(suggestAddressInput.parse({ q: " main " })).toEqual({ q: "main" });
    expect(() => suggestAddressInput.parse({ q: "  " })).toThrow();
    expect(() => suggestAddressInput.parse({ q: "x".repeat(121) })).toThrow();
  });
  it("the picker asks 200 ms after typing, lists the hits, and a pick fills the line, hands the customer up and searches at its point", () => {
    const picker = read("src/components/takeoff/aerial-pick.tsx");
    expect(picker).toContain("const suggestFn = useServerFn(suggestTakeoffAddresses);");
    expect(picker).toContain("const t = setTimeout(() => setDebounced(address), 200);");
    expect(picker).toContain("const suggestFor = suggestOpen ? suggestQuery(debounced) : null;");
    expect(picker).toContain('aria-label="Properties on file that match"');
    expect(picker).toContain("onClick={() => chooseSuggestion(s)}");
    expect(picker).toContain("setAddress(s.address);");
    expect(picker).toContain("onSuggestion?.(s);");
    expect(picker).toContain(
      "? { address: s.address, point: { lat: s.lat, lng: s.lng } }\n        : { address: s.address },",
    );
    // Find and leaving the box close the list (a tap on a row keeps the focus in the box, so the
    // row is not pulled away under the tap); the list never shows over a running search.
    expect(picker).toContain("{suggested.length > 0 && !lookup.isPending && (");
    expect(picker).toContain("onBlur={() => setSuggestOpen(false)}");
    expect(picker).toContain("onMouseDown={(e) => e.preventDefault()}");
    const dialog = read("src/components/takeoff-page.tsx");
    expect(dialog).toContain("const pickSuggestion = (s: AddressSuggestion) => {");
    expect(dialog).toContain("label: suggestionLabel(s),");
    expect(dialog).toContain(
      "if (!nameTouched) setName(suggestTakeoffName(v.label, props.existingNames));",
    );
  });
});
