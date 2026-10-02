/**
 * Test-only: a small in-memory stand-in for the caller's Supabase client, enough PostgREST for
 * the server functions under test (select / insert / update / delete with eq, neq, in, is, not
 * is, ilike, or(ilike…), gte, lt, order, limit, count; maybeSingle / single; rpc
 * technician_options). Every write that changed something is recorded, so a test can say
 * "nothing was written". Not imported by the app.
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

const likeToRegExp = (pattern: string) =>
  new RegExp(
    `^${pattern
      .split("%")
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
    "i",
  );

export function fakeSupabase(tables: Record<string, Row[]>) {
  const writes: FakeWrite[] = [];
  let seq = 0;
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | FakeWrite["op"] = "select";
    let payload: Row | Row[] | null = null;
    let wantCount = false;
    let max = Infinity;
    const preds: Array<(r: Row) => boolean> = [];
    const filters: string[] = [];
    const run = (): Result => {
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload ?? {}];
        const made = list.map((p) => ({ id: `new-${++seq}`, ...p }));
        rows().push(...made);
        writes.push({ table, op, payload: list[0] ?? null, filters, rows: made.length });
        return { data: made.map((r) => ({ ...r })), error: null, count: made.length };
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
      const data = (op === "select" ? hit.slice(0, max) : hit).map((r) => ({ ...r }));
      return { data, error: null, count: wantCount ? hit.length : null };
    };
    const filter = (label: string, p: (r: Row) => boolean) => {
      filters.push(label);
      preds.push(p);
      return b;
    };
    const b = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) wantCount = true;
        return b;
      },
      order: () => b,
      limit: (n: number) => {
        max = n;
        return b;
      },
      eq: (c: string, v: unknown) => filter(`eq ${c}=${String(v)}`, (r) => r[c] === v),
      neq: (c: string, v: unknown) => filter(`neq ${c}=${String(v)}`, (r) => r[c] !== v),
      in: (c: string, vs: unknown[]) =>
        filter(`in ${c}=${vs.map(String).join(",")}`, (r) => vs.includes(r[c])),
      is: (c: string, v: unknown) => filter(`is ${c}=${String(v)}`, (r) => (r[c] ?? null) === v),
      not: (c: string, o: string, v: unknown) => {
        if (o !== "is" || v !== null) throw new Error(`fake: not ${o} ${String(v)}`);
        return filter(`not ${c} is null`, (r) => (r[c] ?? null) !== null);
      },
      ilike: (c: string, pattern: string) =>
        filter(`ilike ${c}=${pattern}`, (r) => likeToRegExp(pattern).test(String(r[c] ?? ""))),
      or: (expr: string) => {
        const parts = expr.split(",").map((part) => {
          const m = /^(\w+)\.ilike\.(.*)$/.exec(part);
          if (!m) throw new Error(`fake: or(${part})`);
          return { c: m[1]!, re: likeToRegExp(m[2]!) };
        });
        return filter(`or ${expr}`, (r) => parts.some((p) => p.re.test(String(r[p.c] ?? ""))));
      },
      gte: (c: string, v: string) => filter(`gte ${c}`, (r) => String(r[c] ?? "") >= v),
      lt: (c: string, v: string) => filter(`lt ${c}`, (r) => String(r[c] ?? "") < v),
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
  const rpc = async (fn: string) => {
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
  return { db: { from, rpc } as never, writes, tables };
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
