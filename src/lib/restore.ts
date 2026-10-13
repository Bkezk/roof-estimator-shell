/**
 * The pure part of the restore (owner, Oct 13: "build it … it needs to be as robust and safe,
 * and get all info where it needs to go accurately"): everything the restore door
 * (restore-door.server.ts) and its tests reason about without a database. Nothing here names a
 * table or a column by hand except USER_ID_COLUMNS_WITHOUT_FK, and restore-door.test.ts walks
 * the migrations to keep that list honest. The catalog comes live from restore_catalog()
 * (supabase/migrations/20261013100000_restore_door.sql), so a table or column added next month
 * is restored without touching this file.
 */

export interface CatalogColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  /** generated always / identity: never written by the restore (the database computes it). */
  generated: boolean;
}
export interface CatalogTable {
  name: string;
  restorable: boolean;
  columns: CatalogColumn[];
  pk: string[];
}
export interface CatalogFk {
  constraint: string;
  table: string;
  columns: string[];
  ref_schema: string;
  ref_table: string;
  ref_columns: string[];
}
export interface Catalog {
  tables: CatalogTable[];
  foreign_keys: CatalogFk[];
}

// ------------------------------------------------------------------ the project label
/** `abcdefghijkl` out of https://abcdefghijkl.supabase.co; "unknown-project" when unparsable. */
export function projectRef(url: string | undefined): string {
  if (!url) return "unknown-project";
  try {
    const host = new URL(url).hostname;
    const first = host.split(".")[0] ?? "";
    return first || "unknown-project";
  } catch {
    return "unknown-project";
  }
}

/**
 * What the script must echo back on every writing call: the company name the portal shows and
 * the Supabase project it runs on, so a backup can never be poured into the wrong project by a
 * mistyped address. "JBK Roofing @ abcdefghijkl".
 */
export function projectLabel(company: string | null | undefined, url: string | undefined): string {
  const name = (company ?? "").replace(/\s+/g, " ").trim() || "unnamed";
  return `${name} @ ${projectRef(url)}`;
}

export const sameLabel = (a: unknown, b: string): boolean =>
  typeof a === "string" && a.replace(/\s+/g, " ").trim() === b;

// ------------------------------------------------------------------ the catalog
export function readCatalog(raw: unknown): Catalog {
  const c = (raw ?? {}) as Partial<Catalog>;
  const tables = Array.isArray(c.tables) ? c.tables : [];
  const fks = Array.isArray(c.foreign_keys) ? c.foreign_keys : [];
  return {
    tables: tables.map((t) => ({
      name: String(t.name),
      restorable: t.restorable !== false,
      columns: (Array.isArray(t.columns) ? t.columns : []).map((col) => ({
        name: String(col.name),
        type: String(col.type ?? ""),
        nullable: col.nullable !== false,
        default: col.default == null ? null : String(col.default),
        is_pk: col.is_pk === true,
        generated: col.generated === true,
      })),
      pk: Array.isArray(t.pk) ? t.pk.map(String) : [],
    })),
    foreign_keys: fks.map((f) => ({
      constraint: String(f.constraint ?? ""),
      table: String(f.table),
      columns: Array.isArray(f.columns) ? f.columns.map(String) : [],
      ref_schema: String(f.ref_schema ?? "public"),
      ref_table: String(f.ref_table),
      ref_columns: Array.isArray(f.ref_columns) ? f.ref_columns.map(String) : [],
    })),
  };
}

export const tableOf = (catalog: Catalog, name: string): CatalogTable | undefined =>
  catalog.tables.find((t) => t.name === name);

/**
 * Parents before children (Kahn's algorithm on the public-schema foreign keys; a table's
 * reference to itself and references into other schemas do not order anything). A cycle (A
 * needs B, B needs A) cannot be ordered: the remaining table with the fewest open parents goes
 * first and the warning names it, so the script knows those rows may need its second pass.
 */
export function dependencyOrder(catalog: Catalog): { order: string[]; cycles: string[] } {
  const names = catalog.tables.map((t) => t.name).sort();
  const known = new Set(names);
  const parents = new Map<string, Set<string>>(names.map((n) => [n, new Set<string>()]));
  for (const fk of catalog.foreign_keys) {
    if (fk.ref_schema !== "public" || fk.table === fk.ref_table) continue;
    if (!known.has(fk.table) || !known.has(fk.ref_table)) continue;
    parents.get(fk.table)!.add(fk.ref_table);
  }
  const order: string[] = [];
  const cycles: string[] = [];
  const left = new Set(names);
  while (left.size) {
    const ready = [...left].filter((n) => [...parents.get(n)!].every((p) => !left.has(p)));
    if (ready.length) {
      ready.sort();
      for (const n of ready) {
        order.push(n);
        left.delete(n);
      }
      continue;
    }
    // Every remaining table waits on another remaining table: a cycle.
    const pick = [...left].sort((a, b) => {
      const da = [...parents.get(a)!].filter((p) => left.has(p)).length;
      const db = [...parents.get(b)!].filter((p) => left.has(p)).length;
      return da - db || a.localeCompare(b);
    })[0]!;
    const waits = [...parents.get(pick)!].filter((p) => left.has(p)).sort();
    cycles.push(`${pick} is restored before ${waits.join(", ")} (circular references)`);
    order.push(pick);
    left.delete(pick);
  }
  return { order, cycles };
}

// ------------------------------------------------------------------ schema drift
/** Columns the backup carries that the live table no longer has: ignored, and reported. */
export function droppedColumns(backupKeys: readonly string[], table: CatalogTable): string[] {
  const live = new Set(table.columns.map((c) => c.name));
  return backupKeys.filter((k) => !live.has(k)).sort();
}

/**
 * Columns the live table has, the backup lacks, and the database cannot fill (NOT NULL, no
 * default, not computed): every row of that table would be refused, so the dry run flags it.
 */
export function newRequiredColumns(backupKeys: readonly string[], table: CatalogTable): string[] {
  const have = new Set(backupKeys);
  return table.columns
    .filter((c) => !have.has(c.name) && !c.nullable && c.default === null && !c.generated)
    .map((c) => c.name)
    .sort();
}

/** Columns the live table has and the backup lacks, but which take a default: just a note. */
export function newDefaultedColumns(backupKeys: readonly string[], table: CatalogTable): string[] {
  const have = new Set(backupKeys);
  return table.columns
    .filter((c) => !have.has(c.name) && (c.nullable || c.default !== null || c.generated))
    .map((c) => c.name)
    .sort();
}

/** Foreign keys that leave the public schema (profiles.id → auth.users): user accounts. */
export function authDependentTables(catalog: Catalog): { table: string; columns: string[] }[] {
  const by = new Map<string, Set<string>>();
  for (const fk of catalog.foreign_keys) {
    if (fk.ref_schema === "public") continue;
    const set = by.get(fk.table) ?? new Set<string>();
    for (const c of fk.columns) set.add(c);
    by.set(fk.table, set);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([table, cols]) => ({ table, columns: [...cols].sort() }));
}

// ------------------------------------------------------------------ user ids
/**
 * Column names that hold a user's id. Every uuid / uuid[] column in the migrations whose name
 * matches must either carry a foreign key to profiles(id) / auth.users(id) (then the catalog
 * finds it) or be listed in USER_ID_COLUMNS_WITHOUT_FK below; restore-door.test.ts fails when
 * a new one appears in neither, so a user id can never slip past the id map unmapped.
 */
export const USER_COLUMN_NAME_RE =
  /(^|_)by$|^by_user$|(^|_)user_ids?$|^(assignee|technician|authorizer|driver|account_manager)_id$/;

/**
 * uuid columns that store a user's id with no foreign key to enforce it (the "who did this"
 * stamps, `default auth.uid()`), table → columns. The id map is applied to these too.
 */
export const USER_ID_COLUMNS_WITHOUT_FK: Readonly<Record<string, readonly string[]>> = {
  audit_log: ["by_user"],
  bid_locks: ["user_id"],
  bids: ["created_by"],
  buildings: ["created_by"],
  crm_accounts: ["created_by"],
  crm_contact_log: ["by_user"],
  crm_followups: ["created_by"],
  crm_opportunities: ["created_by"],
  crm_opportunity_events: ["by_user"],
  crm_settings: ["escalate_user_ids"],
  inventory_movements: ["created_by"],
  invoices: ["created_by"],
  price_import_runs: ["created_by", "reverted_by"],
  service_job_events: ["by_user"],
  service_job_photos: ["by_user"],
  service_job_purchase_orders: ["created_by"],
  service_job_repairs: ["created_by"],
  service_jobs: ["created_by"],
  service_time_entries: ["created_by"],
  site_warranties: ["created_by"],
  takeoffs: ["created_by"],
  tasks: ["created_by"],
  vehicle_drivers: ["created_by"],
  vendors: ["created_by"],
};

/**
 * The columns of `table` the id map rewrites: every column with a foreign key to
 * profiles(id) or auth.users(id) in the live catalog (so profiles.id itself, technician_id,
 * assignee_id, held_by, authorizer_id, …), plus the table's USER_ID_COLUMNS_WITHOUT_FK that
 * still exist live.
 */
export function userIdColumns(table: string, catalog: Catalog): string[] {
  const live = tableOf(catalog, table);
  if (!live) return [];
  const cols = new Set<string>();
  for (const fk of catalog.foreign_keys) {
    if (fk.table !== table) continue;
    const toProfiles = fk.ref_schema === "public" && fk.ref_table === "profiles";
    const toAuth = fk.ref_schema === "auth" && fk.ref_table === "users";
    if (!toProfiles && !toAuth) continue;
    fk.columns.forEach((c, i) => {
      if (fk.ref_columns[i] === "id") cols.add(c);
    });
  }
  const liveNames = new Set(live.columns.map((c) => c.name));
  for (const c of USER_ID_COLUMNS_WITHOUT_FK[table] ?? []) if (liveNames.has(c)) cols.add(c);
  return [...cols].sort();
}

export interface BackupProfile {
  id: string;
  email: string;
  full_name?: string | null;
  role?: string | null;
}
export interface LiveUser {
  id: string;
  email: string;
}
export interface IdMapResult {
  /** old profile id → live auth user id, only where the two differ. */
  id_map: Record<string, string>;
  /** Backup profiles with a live account (same email, case-insensitive). */
  matched: number;
  /** Backup profiles with no live account: created by -CreateUsers, or their rows fail. */
  missing: BackupProfile[];
  /** Every matched id is unchanged (a restore into the same project). */
  identity: boolean;
}

const normEmail = (e: unknown) =>
  String(e ?? "")
    .trim()
    .toLowerCase();

/** Pairs the backup's profiles with the live auth users by email. */
export function buildIdMap(
  backup: readonly BackupProfile[],
  live: readonly LiveUser[],
): IdMapResult {
  const byEmail = new Map<string, string>();
  for (const u of live) {
    const e = normEmail(u.email);
    if (e && !byEmail.has(e)) byEmail.set(e, u.id);
  }
  const id_map: Record<string, string> = {};
  const missing: BackupProfile[] = [];
  let matched = 0;
  for (const p of backup) {
    const liveId = byEmail.get(normEmail(p.email));
    if (!liveId) {
      missing.push(p);
      continue;
    }
    matched++;
    if (liveId !== p.id) id_map[p.id] = liveId;
  }
  return { id_map, matched, missing, identity: Object.keys(id_map).length === 0 };
}

/**
 * Rewrites the user-id columns of each row through the map (a uuid[] column element by
 * element); a value the map does not know stays as it is. Returns new rows and how many values
 * changed. With an empty map the rows come back untouched.
 */
export function applyIdMap(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
  idMap: Readonly<Record<string, string>>,
): { rows: Record<string, unknown>[]; remapped: number } {
  const keys = Object.keys(idMap);
  if (!keys.length || !columns.length) return { rows: [...rows], remapped: 0 };
  let remapped = 0;
  const map1 = (v: unknown): unknown => {
    if (typeof v === "string" && idMap[v] !== undefined) {
      remapped++;
      return idMap[v];
    }
    return v;
  };
  const out = rows.map((r) => {
    let copy: Record<string, unknown> | null = null;
    for (const c of columns) {
      if (!(c in r)) continue;
      const v = r[c];
      const next = Array.isArray(v) ? v.map(map1) : map1(v);
      if (next !== v) {
        copy ??= { ...r };
        copy[c] = next;
      }
    }
    return copy ?? r;
  });
  return { rows: out, remapped };
}

// ------------------------------------------------------------------ the dry-run plan
export interface BackupTableInput {
  table: string;
  /** The keys of the first row of page 1 (empty for a table with no rows). */
  columns: string[];
  rows: number;
}
export interface TablePlan {
  table: string;
  backup_rows: number;
  live_rows: number | null;
  /** ok | denied | missing (not in the live project) | no_pk (plain inserts, no skip/replace) */
  status: "ok" | "denied" | "missing" | "no_pk";
  pk: string[];
  dropped_columns: string[];
  new_required_columns: string[];
  new_defaulted_columns: string[];
  user_columns: string[];
  /** The table points at a user account (a foreign key into auth). */
  auth_dependent: boolean;
  /** Something would refuse every row of this table. */
  blocked: boolean;
  notes: string[];
}

export function planTables(
  catalog: Catalog,
  inputs: readonly BackupTableInput[],
  liveCounts: Readonly<Record<string, number>>,
): { tables: TablePlan[]; order: string[]; cycles: string[]; not_in_backup: string[] } {
  const auth = new Set(authDependentTables(catalog).map((a) => a.table));
  const { order, cycles } = dependencyOrder(catalog);
  const wanted = new Map(inputs.map((i) => [i.table, i]));
  const plans: TablePlan[] = [];
  for (const i of inputs) {
    const live = tableOf(catalog, i.table);
    const base: TablePlan = {
      table: i.table,
      backup_rows: i.rows,
      live_rows: live ? (liveCounts[i.table] ?? null) : null,
      status: "ok",
      pk: live?.pk ?? [],
      dropped_columns: [],
      new_required_columns: [],
      new_defaulted_columns: [],
      user_columns: [],
      auth_dependent: auth.has(i.table),
      blocked: false,
      notes: [],
    };
    if (!live) {
      base.status = "missing";
      base.blocked = i.rows > 0;
      base.notes.push("the live project has no such table: its rows cannot go anywhere");
    } else if (!live.restorable) {
      base.status = "denied";
      base.notes.push("on the restore deny list: left out on purpose");
    } else {
      if (!live.pk.length) {
        base.status = "no_pk";
        base.notes.push("no primary key: rows are inserted plainly (skip/replace cannot apply)");
      }
      if (i.columns.length) {
        base.dropped_columns = droppedColumns(i.columns, live);
        base.new_required_columns = newRequiredColumns(i.columns, live);
        base.new_defaulted_columns = newDefaultedColumns(i.columns, live);
        if (base.dropped_columns.length)
          base.notes.push(`ignored (no longer live): ${base.dropped_columns.join(", ")}`);
        if (base.new_required_columns.length) {
          base.blocked = i.rows > 0;
          base.notes.push(
            `new NOT NULL columns with no default: ${base.new_required_columns.join(", ")} — every row would be refused`,
          );
        }
        if (base.new_defaulted_columns.length)
          base.notes.push(`take their default: ${base.new_defaulted_columns.join(", ")}`);
      }
      base.user_columns = userIdColumns(i.table, catalog);
      if (base.auth_dependent)
        base.notes.push("rows belong to user accounts: each needs a live account (see users)");
    }
    plans.push(base);
  }
  const not_in_backup = catalog.tables
    .map((t) => t.name)
    .filter((n) => !wanted.has(n))
    .sort();
  const rank = new Map(order.map((n, i) => [n, i]));
  plans.sort(
    (a, b) =>
      (rank.get(a.table) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.table) ?? Number.MAX_SAFE_INTEGER) || a.table.localeCompare(b.table),
  );
  return { tables: plans, order, cycles, not_in_backup };
}

/** The dry-run summary the script prints and files, one line per table. */
export function formatPlan(
  plan: ReturnType<typeof planTables>,
  users: IdMapResult | null,
  label: string,
): string {
  const lines: string[] = [];
  lines.push(`Restore plan for ${label}`);
  lines.push("");
  const w = Math.max(5, ...plan.tables.map((t) => t.table.length));
  lines.push(`${"table".padEnd(w)}  ${"backup".padStart(8)}  ${"live".padStart(8)}  status`);
  for (const t of plan.tables) {
    const live = t.live_rows === null ? "-" : String(t.live_rows);
    const status = t.blocked ? `WOULD FAIL (${t.status})` : t.status;
    lines.push(
      `${t.table.padEnd(w)}  ${String(t.backup_rows).padStart(8)}  ${live.padStart(8)}  ${status}`,
    );
    for (const n of t.notes) lines.push(`${"".padEnd(w)}    - ${n}`);
  }
  lines.push("");
  if (plan.cycles.length) {
    lines.push("Circular references (rows of these may need the second pass):");
    for (const c of plan.cycles) lines.push(`  - ${c}`);
    lines.push("");
  }
  if (plan.not_in_backup.length)
    lines.push(
      `Live tables not in this backup (left as they are): ${plan.not_in_backup.join(", ")}`,
    );
  if (users) {
    lines.push("");
    lines.push(
      `Users: ${users.matched} backup profile(s) have a live account${users.identity ? " with the same ids" : " (ids are mapped by email)"}; ${users.missing.length} missing`,
    );
    for (const m of users.missing)
      lines.push(
        `  - ${m.email}${m.role ? ` (${m.role})` : ""}: no live account — create it (-CreateUsers) or its rows fail`,
      );
  }
  const blocked = plan.tables.filter((t) => t.blocked).length;
  lines.push("");
  lines.push(
    blocked
      ? `${blocked} table(s) would fail: fix the schema or leave them out (-Tables) before -Apply`
      : "No table would fail on the schema",
  );
  return lines.join("\n");
}
