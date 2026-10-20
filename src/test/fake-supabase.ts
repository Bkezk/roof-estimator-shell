/**
 * Test-only: a small in-memory stand-in for the caller's Supabase client, enough PostgREST for
 * the server functions under test (select / insert / update / delete with eq, neq, in, is, not
 * is / not in / not like, ilike, or(ilike… / like / not.like / is.null / not.is.null / in /
 * not.in / eq), gte, gt, lt, lte, order, limit, range, count; maybeSingle /
 * single; rpc technician_options, crm_user_options, the follow-up functions as missing, any
 * rpc a test passes in `opts.rpcs` (by name) or answers in `opts.rpc`). Every write that
 * changed something is recorded, so a test can say "nothing was written"; every rpc call is in
 * `rpcCalls`. `opts.maxRows` caps every select the way Supabase's PostgREST does (1,000 rows
 * per request whatever .limit() asks). `opts.objects` is a storage bucket (path → bytes) for
 * `db.storage.from(…).download / upload`; what is uploaded lands in it (`uploads` lists the
 * calls). Not imported by the app.
 *
 * Column projection (Oct 20): `.select("a, b")` answers only those columns, as PostgREST does —
 * until then every select returned whole rows, so a server function that forgot a column its
 * rule needs (opportunities.functions.ts me() without `technician`, read by canClaim) passed its
 * test and failed live. A plain comma-separated list and `*` are understood (`parseSelect`); a
 * select the fake cannot parse — an embedded or joined resource (`site:properties(name)`), an
 * alias (`name:full_name`), a hint (`!inner`) — still returns whole rows, so tests of those
 * functions keep working but do not prove their column lists. Only the keys a row actually has
 * are copied (a column the test did not seed stays absent, as undefined, where PostgREST would
 * answer null).
 */
type Row = Record<string, unknown>;
export interface FakeWrite {
  table: string;
  op: "insert" | "update" | "delete";
  payload: Row | null;
  filters: string[];
  /** Rows the write touched. */
  rows: number;
}
type Result = { data: Row[]; error: null; count: number | null };

/** LIKE → RegExp: % is any run, _ is any one character, everything else literal. */
const likeToRegExp = (pattern: string) =>
  new RegExp(
    `^${pattern
      .split("%")
      .map((p) =>
        p
          .split("_")
          .map((q) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("."),
      )
      .join(".*")}$`,
    "is",
  );

/**
 * The columns a `.select()` string names, or null when it means whole rows: nothing, `*`, or a
 * shape the fake does not parse (an embedded resource, an alias, a hint — anything beyond plain
 * comma-separated names).
 */
export const parseSelect = (cols: string | undefined): string[] | null => {
  const s = (cols ?? "").trim();
  if (!s || s === "*" || /[():!]/.test(s)) return null;
  const names = s
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (names.length === 0 || names.includes("*")) return null;
  if (!names.every((c) => /^\w+$/.test(c))) return null;
  return names;
};

/** `row` reduced to `cols` (the keys it has), or as is when `cols` is null. */
const project = (row: Row, cols: string[] | null): Row => {
  if (!cols) return { ...row };
  const out: Row = {};
  for (const c of cols) if (c in row) out[c] = row[c];
  return out;
};

/** PostgREST's `in` list: `(a,b,"c d")` → the values. */
const inListValues = (list: string): string[] => {
  const inner = list.trim().replace(/^\(/, "").replace(/\)$/, "");
  return [...inner.matchAll(/"((?:[^"\\]|\\.)*)"|([^,]+)/g)].map((m) =>
    m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2]!.trim(),
  );
};

/** Split an or() expression at its top-level commas (an `in.(a,b)` list keeps its own). */
const splitOr = (expr: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map((p) => p.trim());
};

/** One `column.op.value` of an or() expression as a predicate (the operators the app uses). */
const orPart = (part: string): ((r: Row) => boolean) => {
  const m = /^(\w+)\.(not\.)?(\w+)\.(.*)$/s.exec(part);
  if (!m) throw new Error(`fake: or(${part})`);
  const col = m[1]!;
  const neg = m[2] !== undefined;
  const op = m[3]!;
  const value = m[4]!;
  let p: (r: Row) => boolean;
  if (op === "is" && value === "null") p = (r) => (r[col] ?? null) === null;
  else if (op === "ilike" || op === "like") {
    const re = likeToRegExp(value);
    p = (r) => re.test(String(r[col] ?? ""));
  } else if (op === "in") {
    const vs = inListValues(value);
    p = (r) => vs.includes(String(r[col]));
  } else if (op === "eq") p = (r) => String(r[col]) === value;
  else throw new Error(`fake: or(${part})`);
  return neg ? (r) => !p(r) : p;
};

/** An rpc a test provides by name: its return value is the data (a throw becomes the error). */
export type FakeRpc = (args: Record<string, unknown>, tables: Record<string, Row[]>) => unknown;
/** Answer any rpc (undefined: fall through to `opts.rpcs` and the defaults below). */
export type FakeRpcAnswer = (
  fn: string,
  args: Row | undefined,
) => { data: unknown; error: { code?: string; message: string } | null } | undefined;

export function fakeSupabase(
  tables: Record<string, Row[]>,
  opts: {
    maxRows?: number;
    rpcs?: Record<string, FakeRpc>;
    rpc?: FakeRpcAnswer;
    objects?: Record<string, Uint8Array>;
  } = {},
) {
  const writes: FakeWrite[] = [];
  const objects = opts.objects ?? {};
  const uploads: Array<{ bucket: string; path: string; upsert: boolean }> = [];
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, o?: { upsert?: boolean }) => {
        uploads.push({ bucket, path, upsert: !!o?.upsert });
        if (objects[path] && !o?.upsert)
          return { data: null, error: { message: "The resource already exists" } };
        objects[path] = bytes;
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const o = objects[path];
        if (!o) return { data: null, error: { message: "Object not found" } };
        return { data: { arrayBuffer: async () => o.slice().buffer }, error: null };
      },
    }),
  };
  let seq = 0;
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | FakeWrite["op"] = "select";
    let payload: Row | Row[] | null = null;
    let wantCount = false;
    let max = Infinity;
    let offset = 0;
    let cols: string[] | null = null;
    const preds: Array<(r: Row) => boolean> = [];
    const filters: string[] = [];
    const run = (): Result => {
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload ?? {}];
        const made = list.map((p) => ({ id: `new-${++seq}`, ...p }));
        rows().push(...made);
        writes.push({ table, op, payload: list[0] ?? null, filters, rows: made.length });
        return { data: made.map((r) => project(r, cols)), error: null, count: made.length };
      }
      const hit = rows().filter((r) => preds.every((p) => p(r)));
      if (op === "update" && hit.length) {
        for (const r of hit) Object.assign(r, payload);
        writes.push({ table, op, payload: payload as Row, filters, rows: hit.length });
      }
      if (op === "delete" && hit.length) {
        tables[table] = rows().filter((r) => !hit.includes(r));
        writes.push({ table, op, payload: null, filters, rows: hit.length });
      }
      const cap = Math.min(max, opts.maxRows ?? Infinity);
      const data = (op === "select" ? hit.slice(offset, offset + cap) : hit).map((r) =>
        project(r, cols),
      );
      return { data, error: null, count: wantCount ? hit.length : null };
    };
    const filter = (label: string, p: (r: Row) => boolean) => {
      filters.push(label);
      preds.push(p);
      return b;
    };
    const b = {
      select: (c?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) wantCount = true;
        cols = parseSelect(c);
        return b;
      },
      order: () => b,
      limit: (n: number) => {
        max = n;
        return b;
      },
      range: (from: number, to: number) => {
        offset = from;
        max = to - from + 1;
        return b;
      },
      eq: (c: string, v: unknown) => filter(`eq ${c}=${String(v)}`, (r) => r[c] === v),
      neq: (c: string, v: unknown) => filter(`neq ${c}=${String(v)}`, (r) => r[c] !== v),
      in: (c: string, vs: unknown[]) =>
        filter(`in ${c}=${vs.map(String).join(",")}`, (r) => vs.includes(r[c])),
      is: (c: string, v: unknown) => filter(`is ${c}=${String(v)}`, (r) => (r[c] ?? null) === v),
      not: (c: string, o: string, v: unknown) => {
        if (o === "is" && v === null)
          return filter(`not ${c} is null`, (r) => (r[c] ?? null) !== null);
        if (o === "in" && typeof v === "string") {
          const vs = inListValues(v);
          return filter(`not ${c} in ${vs.join(",")}`, (r) => !vs.includes(String(r[c])));
        }
        if (o === "like" && typeof v === "string") {
          const re = likeToRegExp(v);
          return filter(`not ${c} like ${v}`, (r) => !re.test(String(r[c] ?? "")));
        }
        throw new Error(`fake: not ${o} ${String(v)}`);
      },
      ilike: (c: string, pattern: string) =>
        filter(`ilike ${c}=${pattern}`, (r) => likeToRegExp(pattern).test(String(r[c] ?? ""))),
      or: (expr: string) => {
        const parts = splitOr(expr).map(orPart);
        return filter(`or ${expr}`, (r) => parts.some((p) => p(r)));
      },
      gte: (c: string, v: string) => filter(`gte ${c}`, (r) => String(r[c] ?? "") >= v),
      gt: (c: string, v: string) => filter(`gt ${c}`, (r) => String(r[c] ?? "") > v),
      lt: (c: string, v: string) => filter(`lt ${c}`, (r) => String(r[c] ?? "") < v),
      lte: (c: string, v: string) => filter(`lte ${c}`, (r) => String(r[c] ?? "") <= v),
      update: (p: Row, opts?: { count?: string }) => {
        op = "update";
        payload = p;
        if (opts?.count) wantCount = true;
        return b;
      },
      insert: (p: Row | Row[]) => {
        op = "insert";
        payload = p;
        return b;
      },
      delete: () => {
        op = "delete";
        return b;
      },
      maybeSingle: async () => {
        const r = run();
        if (r.data.length > 1)
          return { data: null, error: { message: "JSON object requested, multiple rows" } };
        return { data: r.data[0] ?? null, error: null };
      },
      single: async () => {
        const r = run();
        return r.data.length === 1
          ? { data: r.data[0], error: null }
          : { data: null, error: { message: "JSON object requested, 0 or several rows" } };
      },
      then: (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    rpcCalls.push({ fn, args });
    const custom = opts.rpc?.(fn, args);
    if (custom) return custom;
    const own = opts.rpcs?.[fn];
    if (own) {
      try {
        return { data: own(args, tables), error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    }
    // Every user (crm_user_options: id, name, email).
    if (fn === "crm_user_options")
      return {
        data: (tables["profiles"] ?? []).map((p) => ({
          id: p["id"],
          full_name: p["full_name"] ?? null,
          email: p["email"] ?? "",
        })),
        error: null,
      };
    // The follow-up functions of 20261002140000_followup_guard.sql are database code: here they
    // answer "not in the schema cache", so syncFollowup runs its direct writes (the same rules).
    if (fn === "followup_sync_upsert" || fn === "followup_sync_close")
      return {
        data: null,
        error: { code: "PGRST202", message: `Could not find the function public.${fn}` },
      };
    if (fn === "technician_options")
      return {
        data: (tables["profiles"] ?? []).map((p) => ({
          id: p["id"],
          full_name: p["full_name"] ?? null,
          email: p["email"] ?? "",
          technician: !!p["technician"],
        })),
        error: null,
      };
    return { data: null, error: { message: `fake: unexpected rpc ${fn}` } };
  };
  return { db: { from, rpc, storage } as never, writes, tables, rpcCalls, objects, uploads };
}

/** createServerFn reduced to "validate, then call the handler" (use inside vi.mock). */
export function fakeCreateServerFn() {
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
}
