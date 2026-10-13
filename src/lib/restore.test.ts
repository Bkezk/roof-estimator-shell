/**
 * The restore's pure helpers (src/lib/restore.ts) on fixtures: the project label, the table
 * order from the foreign keys (with a cycle), schema drift (dropped / new required columns), the
 * user id map by email and its application to a ticket, a follow-up hold and the profiles rows
 * themselves, and the dry-run plan text.
 */
import { describe, expect, it } from "vitest";

import {
  applyIdMap,
  authDependentTables,
  buildIdMap,
  dependencyOrder,
  droppedColumns,
  formatPlan,
  newDefaultedColumns,
  newRequiredColumns,
  planTables,
  projectLabel,
  projectRef,
  readCatalog,
  sameLabel,
  USER_ID_COLUMNS_WITHOUT_FK,
  userIdColumns,
  type Catalog,
  type CatalogColumn,
} from "./restore";

const col = (name: string, extra: Partial<CatalogColumn> = {}): CatalogColumn => ({
  name,
  type: "text",
  nullable: true,
  default: null,
  is_pk: false,
  generated: false,
  ...extra,
});

/** profiles → auth.users; service_jobs → profiles (technician_id, created_by has no FK); crm_followups → profiles (held_by); a cycle between a and b. */
const CATALOG: Catalog = readCatalog({
  tables: [
    {
      name: "profiles",
      columns: [
        col("id", { type: "uuid", nullable: false, is_pk: true }),
        col("email", { nullable: false }),
        col("role"),
      ],
      pk: ["id"],
    },
    {
      name: "service_jobs",
      columns: [
        col("id", { type: "uuid", nullable: false, is_pk: true, default: "gen_random_uuid()" }),
        col("technician_id", { type: "uuid" }),
        col("created_by", { type: "uuid" }),
        col("stage", { nullable: false, default: "'new'::text" }),
        col("arrival_window", { nullable: false }), // new, NOT NULL, no default
        col("number", { type: "integer", nullable: false, default: "nextval('seq')" }),
        col("search", { type: "tsvector", nullable: false, generated: true }),
      ],
      pk: ["id"],
    },
    {
      name: "crm_followups",
      columns: [
        col("id", { type: "bigint", nullable: false, is_pk: true }),
        col("held_by", { type: "uuid" }),
        col("created_by", { type: "uuid" }),
      ],
      pk: ["id"],
    },
    { name: "a", columns: [col("id", { is_pk: true }), col("b_id")], pk: ["id"] },
    { name: "b", columns: [col("id", { is_pk: true }), col("a_id")], pk: ["id"] },
    {
      name: "company_settings",
      columns: [col("id", { type: "integer", is_pk: true }), col("company_name")],
      pk: ["id"],
    },
    { name: "no_key", columns: [col("x")], pk: [] },
    {
      name: "crm_settings",
      columns: [col("id", { is_pk: true }), col("escalate_user_ids", { type: "uuid[]" })],
      pk: ["id"],
    },
  ],
  foreign_keys: [
    {
      constraint: "profiles_id_fkey",
      table: "profiles",
      columns: ["id"],
      ref_schema: "auth",
      ref_table: "users",
      ref_columns: ["id"],
    },
    {
      constraint: "sj_tech",
      table: "service_jobs",
      columns: ["technician_id"],
      ref_schema: "public",
      ref_table: "profiles",
      ref_columns: ["id"],
    },
    {
      constraint: "fu_held",
      table: "crm_followups",
      columns: ["held_by"],
      ref_schema: "public",
      ref_table: "profiles",
      ref_columns: ["id"],
    },
    {
      constraint: "a_b",
      table: "a",
      columns: ["b_id"],
      ref_schema: "public",
      ref_table: "b",
      ref_columns: ["id"],
    },
    {
      constraint: "b_a",
      table: "b",
      columns: ["a_id"],
      ref_schema: "public",
      ref_table: "a",
      ref_columns: ["id"],
    },
    {
      constraint: "self",
      table: "a",
      columns: ["id"],
      ref_schema: "public",
      ref_table: "a",
      ref_columns: ["id"],
    },
  ],
});

describe("the project label", () => {
  it("is the company name and the Supabase project ref, whitespace folded", () => {
    expect(projectRef("https://abcdefghijkl.supabase.co")).toBe("abcdefghijkl");
    expect(projectRef("not a url")).toBe("unknown-project");
    expect(projectRef(undefined)).toBe("unknown-project");
    expect(projectLabel("  JBK   Roofing ", "https://abcdefghijkl.supabase.co/")).toBe(
      "JBK Roofing @ abcdefghijkl",
    );
    expect(projectLabel(null, "https://x.supabase.co")).toBe("unnamed @ x");
    expect(sameLabel(" JBK  Roofing @ abcdefghijkl ", "JBK Roofing @ abcdefghijkl")).toBe(true);
    expect(sameLabel("JBK Roofing @ other", "JBK Roofing @ abcdefghijkl")).toBe(false);
    expect(sameLabel(undefined, "x")).toBe(false);
  });
});

describe("dependencyOrder", () => {
  it("puts parents before children, ignores self and cross-schema references, and warns on a cycle", () => {
    const { order, cycles } = dependencyOrder(CATALOG);
    expect(order.indexOf("profiles")).toBeLessThan(order.indexOf("service_jobs"));
    expect(order.indexOf("profiles")).toBeLessThan(order.indexOf("crm_followups"));
    expect(new Set(order)).toEqual(new Set(CATALOG.tables.map((t) => t.name)));
    expect(order).toHaveLength(CATALOG.tables.length);
    expect(cycles).toEqual(["a is restored before b (circular references)"]);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
  });
  it("is alphabetical among tables that have no ordering between them", () => {
    const { order } = dependencyOrder({
      tables: [
        { name: "z", restorable: true, columns: [], pk: [] },
        { name: "m", restorable: true, columns: [], pk: [] },
      ],
      foreign_keys: [],
    });
    expect(order).toEqual(["m", "z"]);
  });
});

describe("schema drift", () => {
  const jobs = CATALOG.tables.find((t) => t.name === "service_jobs")!;
  const backupKeys = ["id", "technician_id", "created_by", "stage", "old_notes", "search"];
  it("names the backup's columns the table lost, and the new NOT NULL columns with no default", () => {
    expect(droppedColumns(backupKeys, jobs)).toEqual(["old_notes"]);
    expect(newRequiredColumns(backupKeys, jobs)).toEqual(["arrival_window"]);
    // number has a default, search is generated: the database fills them.
    expect(newDefaultedColumns(backupKeys, jobs)).toEqual(["number"]);
    expect(newRequiredColumns([...backupKeys, "arrival_window"], jobs)).toEqual([]);
  });
  it("knows which tables hang off the user accounts", () => {
    expect(authDependentTables(CATALOG)).toEqual([{ table: "profiles", columns: ["id"] }]);
  });
});

describe("user ids", () => {
  it("finds the user columns from the foreign keys plus the no-FK list, only where live", () => {
    expect(userIdColumns("profiles", CATALOG)).toEqual(["id"]);
    expect(userIdColumns("service_jobs", CATALOG)).toEqual(["created_by", "technician_id"]);
    expect(userIdColumns("crm_followups", CATALOG)).toEqual(["created_by", "held_by"]);
    expect(userIdColumns("crm_settings", CATALOG)).toEqual(["escalate_user_ids"]);
    expect(userIdColumns("a", CATALOG)).toEqual([]);
    expect(userIdColumns("nope", CATALOG)).toEqual([]);
    expect(USER_ID_COLUMNS_WITHOUT_FK["service_jobs"]).toEqual(["created_by"]);
  });
  it("maps backup profiles to live accounts by email, case-insensitively, listing the missing", () => {
    const r = buildIdMap(
      [
        { id: "old-brad", email: "Brad@JBK.com", role: "admin" },
        { id: "same-amy", email: "amy@jbk.com", role: "user" },
        { id: "old-gone", email: "gone@jbk.com", role: "user", full_name: "Gone" },
      ],
      [
        { id: "new-brad", email: "brad@jbk.com" },
        { id: "same-amy", email: "AMY@jbk.com" },
      ],
    );
    expect(r.id_map).toEqual({ "old-brad": "new-brad" });
    expect(r.matched).toBe(2);
    expect(r.missing.map((m) => m.email)).toEqual(["gone@jbk.com"]);
    expect(r.identity).toBe(false);
    const same = buildIdMap([{ id: "x", email: "x@y.z" }], [{ id: "x", email: "x@y.z" }]);
    expect(same).toEqual({ id_map: {}, matched: 1, missing: [], identity: true });
  });
  it("rewrites a ticket's technician and creator, a follow-up's holder, the profiles id and a uuid[] — nothing else", () => {
    const map = { "old-brad": "new-brad", "old-amy": "new-amy" };
    const ticket = {
      id: "t1",
      technician_id: "old-brad",
      created_by: "old-amy",
      stage: "new",
      site_id: "old-brad",
    };
    const t = applyIdMap([ticket], ["created_by", "technician_id"], map);
    expect(t.rows[0]).toEqual({ ...ticket, technician_id: "new-brad", created_by: "new-amy" });
    expect(t.rows[0]!["site_id"]).toBe("old-brad"); // not a user column: untouched
    expect(t.remapped).toBe(2);
    expect(ticket.technician_id).toBe("old-brad"); // the input is not mutated

    const hold = applyIdMap(
      [{ id: 1, held_by: "old-brad", created_by: null }],
      ["created_by", "held_by"],
      map,
    );
    expect(hold.rows[0]).toEqual({ id: 1, held_by: "new-brad", created_by: null });
    expect(hold.remapped).toBe(1);

    const prof = applyIdMap(
      [
        { id: "old-brad", email: "b" },
        { id: "kept", email: "k" },
      ],
      ["id"],
      map,
    );
    expect(prof.rows.map((r) => r["id"])).toEqual(["new-brad", "kept"]);

    const arr = applyIdMap(
      [{ id: 1, escalate_user_ids: ["old-brad", "zzz", "old-amy"] }],
      ["escalate_user_ids"],
      map,
    );
    expect(arr.rows[0]!["escalate_user_ids"]).toEqual(["new-brad", "zzz", "new-amy"]);
    expect(arr.remapped).toBe(2);

    // An empty map (a restore into the same project) changes nothing.
    const none = applyIdMap([ticket], ["technician_id"], {});
    expect(none).toEqual({ rows: [ticket], remapped: 0 });
  });
});

describe("the dry-run plan", () => {
  const inputs = [
    { table: "profiles", columns: ["id", "email", "role"], rows: 3 },
    {
      table: "service_jobs",
      columns: ["id", "technician_id", "created_by", "stage", "old_notes"],
      rows: 40,
    },
    { table: "gone_table", columns: ["id"], rows: 2 },
    { table: "no_key", columns: ["x"], rows: 1 },
    { table: "company_settings", columns: [], rows: 0 },
  ];
  const plan = planTables(CATALOG, inputs, { profiles: 3, service_jobs: 10, no_key: 0 });
  it("flags what would fail, notes what drifts, and orders the tables parents-first", () => {
    const by = Object.fromEntries(plan.tables.map((t) => [t.table, t]));
    expect(by["gone_table"]!.status).toBe("missing");
    expect(by["gone_table"]!.blocked).toBe(true);
    expect(by["service_jobs"]!.blocked).toBe(true);
    expect(by["service_jobs"]!.new_required_columns).toEqual(["arrival_window"]);
    expect(by["service_jobs"]!.dropped_columns).toEqual(["old_notes"]);
    expect(by["service_jobs"]!.user_columns).toEqual(["created_by", "technician_id"]);
    expect(by["service_jobs"]!.live_rows).toBe(10);
    expect(by["no_key"]!.status).toBe("no_pk");
    expect(by["no_key"]!.blocked).toBe(false);
    expect(by["profiles"]!.auth_dependent).toBe(true);
    expect(by["profiles"]!.blocked).toBe(false);
    expect(by["company_settings"]!.blocked).toBe(false);
    expect(plan.tables.map((t) => t.table).indexOf("profiles")).toBeLessThan(
      plan.tables.map((t) => t.table).indexOf("service_jobs"),
    );
    expect(plan.not_in_backup).toEqual(["a", "b", "crm_followups", "crm_settings"]);
    expect(plan.cycles).toHaveLength(1);
  });
  it("prints a report a person can act on, naming missing users", () => {
    const users = buildIdMap([{ id: "o", email: "gone@jbk.com", role: "user" }], []);
    const text = formatPlan(plan, users, "JBK Roofing @ abc");
    expect(text).toContain("Restore plan for JBK Roofing @ abc");
    expect(text).toContain("WOULD FAIL (missing)");
    expect(text).toContain("new NOT NULL columns with no default: arrival_window");
    expect(text).toContain("ignored (no longer live): old_notes");
    expect(text).toContain("Circular references");
    expect(text).toContain("gone@jbk.com (user): no live account");
    expect(text).toContain("2 table(s) would fail");
    const clean = formatPlan(
      planTables(CATALOG, [{ table: "profiles", columns: ["id", "email"], rows: 1 }], {}),
      null,
      "x",
    );
    expect(clean).toContain("No table would fail on the schema");
  });
});
