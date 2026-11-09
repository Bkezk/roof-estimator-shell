/**
 * The Project Bids audit fixes (owner, Nov 6: "go for 1, 2, 3, 4, 5, 6, 8, 9"): the slim list
 * (1), the copy's folder and due date (2), rows that wrap on a phone (3), a lock release that
 * survives a tab close and a named holder (4), the Combiner's shared customer and earliest due
 * date (5), one spelling per estimator (6), the documents' files removed on a purge (8), the
 * labels (9). The pure parts are exercised; the wiring is pinned by reading the source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      validator: (v: (d: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/bid-locks.functions", () => ({ liveLockHeldElsewhere: vi.fn(async () => null) }));

import {
  type BidListRow,
  bidRoofSystems,
  canonicalEstimator,
  importedFromLabel,
  patchBidRow,
  patchBidRows,
} from "./bids-list";
import { type DocumentFilesClient, listBids, removeBidDocumentFiles } from "./bids.functions";
import { combinedHeader } from "./combine-bids";
import { duplicateBidRow } from "./duplicate-bid";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/routes/bids.tsx");
const fns = read("src/lib/bids.functions.ts");
const estimate = read("src/routes/estimate.tsx");

describe("1. the slim list", () => {
  it("reads the roof systems off the Setup default and the sections, in order, once each", () => {
    expect(
      bidRoofSystems("Duro-Last", [{ roofSystem: "Duro-Tuff" }, { roofSystem: "Duro-Last" }, {}]),
    ).toEqual(["Duro-Last", "Duro-Tuff"]);
    expect(bidRoofSystems(undefined, null)).toEqual([]);
    expect(bidRoofSystems("", "not an array")).toEqual([]);
  });
  it("names the import source", () => {
    expect(importedFromLabel("bid-advantage")).toBe("Bid-Advantage");
    expect(importedFromLabel("planswift")).toBe("PlanSwift");
    expect(importedFromLabel(null)).toBeNull();
    expect(importedFromLabel("other")).toBeNull();
  });
  it("listBids returns the row the page needs and never the payload or the sections", async () => {
    const raw = {
      id: "b1",
      name: "Gym",
      status: "draft",
      grand_total: "12.5",
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-02T00:00:00Z",
      updated_by_name: "Claude",
      folder: null,
      due_date: "2026-12-01",
      lost_reason: null,
      account_id: "a1",
      opportunity_id: "o1",
      estimator_name: " Brian ",
      typed_customer: null,
      roof_system: "Duro-Last",
      sections: [{ roofSystem: "EPDM Rubber", big: "x".repeat(10_000) }],
      import_source: "planswift",
      account: { id: "a1", name: "Owens" },
    };
    const selects: string[] = [];
    const sb = {
      from: (table: string) => ({
        select: (cols: string) => {
          selects.push(`${table}: ${cols}`);
          const q = {
            is: () => q,
            order: () => q,
            returns: () => Promise.resolve({ data: [raw], error: null }),
            in: () => Promise.resolve({ data: [{ id: "o1", title: "Gym reroof" }], error: null }),
          };
          return q;
        },
      }),
    };
    const rows = await (
      listBids as unknown as (a: { data: unknown; context: unknown }) => Promise<BidListRow[]>
    )({ data: undefined, context: { supabase: sb, userId: "me" } });
    expect(rows).toEqual([
      {
        id: "b1",
        name: "Gym",
        status: "draft",
        grand_total: "12.5",
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-02T00:00:00Z",
        updated_by_name: "Claude",
        folder: null,
        due_date: "2026-12-01",
        lost_reason: null,
        account_id: "a1",
        opportunity_id: "o1",
        account: { id: "a1", name: "Owens" },
        opportunity: { id: "o1", title: "Gym reroof" },
        estimator_name: "Brian",
        typed_customer: "",
        roof_systems: ["Duro-Last", "EPDM Rubber"],
        import_source: "planswift",
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("xxxx");
    // No `*`: the columns, the JSON paths, the sections for the systems, the account.
    expect(selects[0]).not.toContain("*");
    expect(selects[0]).toContain("estimator_name:data->customer->>estimatorName");
    expect(selects[0]).toContain("sections:data->sections");
    expect(selects[0]).toContain("import_source:data->importInfo->>source");
    expect(selects[0]).toContain("account:crm_accounts!bids_account_id_fkey(id, name)");
  });
  it("patches one row, or several, in place", () => {
    const rows: { id: string; name: string; folder: string | null }[] = [
      { id: "a", name: "A", folder: null },
      { id: "b", name: "B", folder: null },
    ];
    expect(patchBidRow(rows, "b", { name: "B2" })[1]).toEqual({
      id: "b",
      name: "B2",
      folder: null,
    });
    expect(patchBidRow(rows, "b", { name: "B2" })[0]).toBe(rows[0]);
    expect(patchBidRows(rows, ["a", "b"], { folder: "F" }).map((r) => r.folder)).toEqual([
      "F",
      "F",
    ]);
  });
  it("the page patches the cache after a rename, a status change, a folder move or rename and a delete, and refetches only after a restore or a copy", () => {
    expect(page).toContain("const patchRows = (fn: (rows: BidListRow[]) => BidListRow[]) =>");
    expect(page.match(/patchRows\(/g)?.length).toBe(5);
    expect(page).toContain("patchBidRows(rows, v.ids, { folder: r.folder })");
    expect(page).toContain('lost_reason: v.status === "lost" ? (v.lostReason ?? null) : null,');
    expect(page).toContain("patchRows((rows) => rows.filter((b) => b.id !== r.id));");
    // The row reads the server's fields, never the payload.
    expect(page).not.toContain("bid.data");
    expect(page).toContain(
      "const roofSystemsOf = (bid: BidListRow): string[] => bid.roof_systems;",
    );
    expect(page).toContain("importedFromLabel(bid.import_source)");
    expect(page.match(/refresh\(\)/g)?.length).toBe(2);
  });
});

describe("2. the copy keeps the folder and takes a due date", () => {
  it("duplicateBidRow copies the folder and sets the due date given", () => {
    const row = duplicateBidRow(
      {
        name: "Gym",
        data: {},
        grand_total: 1,
        account_id: "a",
        site_id: null,
        building_id: null,
        roof_id: null,
        folder: "Bell County",
      },
      "Claude",
      "2026-11-06T00:00:00Z",
      undefined,
      "2026-12-01",
    );
    expect(row.folder).toBe("Bell County");
    expect(row.due_date).toBe("2026-12-01");
    expect(row.status).toBe("draft");
  });
  it("the server requires the day and the popup asks for it, the source's day to start", () => {
    expect(fns).toContain(
      '"The bid due date must be a day (YYYY-MM-DD)"),\n      })\n      .parse(d),',
    );
    expect(fns).toContain("data.name,\n          data.dueDate,");
    expect(page).toContain('id="copy-bid-due"');
    expect(page).toContain('dueDate: bid.due_date ?? "",');
    expect(page).toContain('toast.error("Give the copy a due date.");');
    expect(page).toContain("dueDate: copyFor.dueDate,");
  });
});

describe("3. rows wrap on a phone", () => {
  it("the row's right cluster wraps", () => {
    expect(page).toContain('<div className="flex flex-wrap items-center gap-x-6 gap-y-2">');
    expect(page).not.toContain('<div className="flex items-center gap-6">');
  });
});

describe("4. the lock release survives a tab close; the holder is named", () => {
  it("the release is sent keepalive; the lock is taken once the profile is known", () => {
    const hook = read("src/lib/use-bid-lock.ts");
    expect(hook).toContain("fetch: (input, init) => fetch(input, { ...init, keepalive: true }),");
    expect(estimate).toContain("enabled: authed && !!profile,");
  });
});

describe("5. the Combiner's header", () => {
  it("the customer every source shares, the site when every source names it, the earliest due date", () => {
    expect(
      combinedHeader([
        { accountId: "a", siteId: "s1", dueDate: "2026-12-10" },
        { accountId: "a", siteId: "s1", dueDate: "2026-11-20" },
      ]),
    ).toEqual({ accountId: "a", siteId: "s1", dueDate: "2026-11-20" });
    expect(
      combinedHeader([
        { accountId: "a", siteId: "s1", dueDate: null },
        { accountId: "a", siteId: "s2", dueDate: "2026-11-20" },
      ]),
    ).toEqual({ accountId: "a", siteId: null, dueDate: "2026-11-20" });
    expect(
      combinedHeader([
        { accountId: "a", siteId: null, dueDate: null },
        { accountId: "b", siteId: null, dueDate: null },
      ]),
    ).toEqual({ accountId: null, siteId: null, dueDate: null });
    expect(
      combinedHeader([
        { accountId: null, siteId: null, dueDate: "bad" },
        { accountId: null, siteId: null, dueDate: null },
      ]),
    ).toEqual({ accountId: null, siteId: null, dueDate: null });
  });
  it("the estimator picks the shared customer as a change of this session and sets the day", () => {
    expect(estimate).toContain("const header = combinedHeader(sources);");
    expect(estimate).toContain(
      'if (header.accountId) linkFromTakeoff(header.accountId, "", header.siteId);',
    );
    expect(estimate).toContain('setBidDueDate(header.dueDate ?? "");');
  });
});

describe("6. one spelling per estimator", () => {
  const roster = ["Braden Keck", "Brian Folden", "Garry Peters", "John Smith", "John Doe"];
  it("the roster's spelling on a match, the one first-name match, else as typed", () => {
    expect(canonicalEstimator("brian folden", roster)).toBe("Brian Folden");
    expect(canonicalEstimator("Brian", roster)).toBe("Brian Folden");
    expect(canonicalEstimator(" brian ", roster)).toBe("Brian Folden");
    // Two Johns: left as typed.
    expect(canonicalEstimator("John", roster)).toBe("John");
    expect(canonicalEstimator("Claude", roster)).toBe("Claude");
    expect(canonicalEstimator("", roster)).toBe("");
    expect(canonicalEstimator(null, [])).toBe("");
  });
  it("the Bids page folds through the roster; the estimator's save does too", () => {
    expect(page).toContain("canonicalEstimator(bid.estimator_name, roster ?? [])");
    expect(estimate).toContain(
      "estimatorName: canonicalEstimator(customer.estimatorName, estimatorNames ?? []),",
    );
  });
});

describe("8. the documents' files go with a purged bid", () => {
  it("removeBidDocumentFiles lists each document's folder and removes what is there; a failure is logged, not thrown", async () => {
    const removed: string[][] = [];
    const listed: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sb: DocumentFilesClient = {
      from: () => ({
        select: () => ({
          in: async (_c, ids) => ({
            data: ids.includes("bid-1") ? [{ id: "doc-1" }, { id: "doc-2" }, { id: "doc-3" }] : [],
          }),
        }),
      }),
      storage: {
        from: () => ({
          list: async (prefix) => {
            listed.push(prefix);
            if (prefix === "docs/doc-1")
              return {
                data: [{ name: "v1.pdf" }, { name: "v2.pdf" }, { name: "a.jpg" }],
                error: null,
              };
            if (prefix === "docs/doc-3") return { data: null, error: { message: "nope" } };
            return { data: [], error: null };
          },
          remove: async (paths) => {
            removed.push(paths);
            return { error: null };
          },
        }),
      },
    };
    expect(await removeBidDocumentFiles(sb, ["bid-1"])).toBe(3);
    expect(listed).toEqual(["docs/doc-1", "docs/doc-2", "docs/doc-3"]);
    expect(removed).toEqual([["docs/doc-1/v1.pdf", "docs/doc-1/v2.pdf", "docs/doc-1/a.jpg"]]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await removeBidDocumentFiles(sb, [])).toBe(0);
    warn.mockRestore();
  });
  it("purgeBid and the 30-day sweep call it before the rows go", () => {
    const purge = fns.slice(
      fns.indexOf("export const purgeBid"),
      fns.indexOf("export const getBid"),
    );
    expect(purge).toContain(
      "await removeBidDocumentFiles(context.supabase as unknown as DocumentFilesClient, [data.id]);",
    );
    const sweep = fns.slice(
      fns.indexOf("export const listDeletedBids"),
      fns.indexOf("/** A folder name as typed"),
    );
    expect(sweep).toContain("await removeBidDocumentFiles(");
    expect(sweep.indexOf("removeBidDocumentFiles(")).toBeLessThan(sweep.indexOf(".delete()"));
  });
});

describe("9. the labels", () => {
  it("the search box says what it searches; one Clear filters", () => {
    expect(page).toContain('placeholder="Bid name, customer or folder…"');
    expect(page).not.toContain("Bid name\n            <Input");
    expect(page.match(/Clear filters/g)?.length).toBe(2);
    expect(page).toContain("No bids match these filters. Clear filters above to see every bid.");
  });
});
