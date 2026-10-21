/**
 * lib/read-all.ts, Oct 21 (the eighth audit's findings 7 and A, approved as fixes):
 *
 *  7. The pages were OFFSET pages (`.order("id").range(from, to)`). On a table that changes
 *     between requests, a row inserted with a smaller id shifts every later offset and the last
 *     row of a page comes back twice (count +1); a row deleted — or filtered out — between pages
 *     skips one (count −1). The Owner view's counts and the Margin report never de-duplicated.
 *     Now the pages are KEYSET pages: the builder gets the last id seen and adds `.gt("id", last)`
 *     (afterId), so a row is on exactly one page whatever happens between requests.
 *  A. The read stopped at a page shorter than PAGE. Were the project's PostgREST Max Rows ever
 *     set below 1,000, every page would be short and the read would silently stop at that
 *     ceiling — the one the function exists to remove. It stops at an EMPTY page now: one extra
 *     small request per read.
 *
 * `offsetReadAll` below is the Oct 21 body, kept as the "before" oracle: the same table stub
 * answers a number as an offset (what it passed) and a string as a keyset cursor, so each case
 * shows the old answer wrong and the new one right.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { PAGE, afterId, readAll, type RowId } from "@/lib/read-all";
import { fakeSupabase } from "@/test/fake-supabase";

/** The fake as a client, with the server's Max Rows (`maxRows`), for the real builder chain. */
const client = (tables: Record<string, Record<string, unknown>[]>, maxRows: number) =>
  fakeSupabase(tables, { maxRows }).db as unknown as SupabaseClient;

type Row = { id: string; n: number };
const idOf = (n: number) => `r-${String(n).padStart(5, "0")}`;
const rowsTo = (count: number, from = 1): Row[] =>
  Array.from({ length: count - from + 1 }, (_, i) => ({ id: idOf(from + i), n: from + i }));
const byId = (a: Row, b: Row) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ids = (r: { data: Row[] | null }) => (r.data ?? []).map((x) => x.id);
const distinct = (xs: string[]) => new Set(xs).size;

/** lib/read-all.ts as it stood on Oct 21 before the eighth audit: offset pages, stop at a short one. */
async function offsetReadAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: null, error };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data: out, error: null };
}

/**
 * A table the way the server answers it: sorted by id, at most `max` rows a request (Max Rows).
 * `answer` takes a number as an OFFSET (the old readAll's `from`), null as the first keyset page
 * and a string as the keyset cursor. `between(n)` runs once page n is answered, before the next
 * request — the writer that gets in between.
 */
function table(rows: Row[], opts: { max?: number; between?: (page: number) => void } = {}) {
  const requests: (RowId | null)[] = [];
  const answer = (arg: RowId | null) => {
    const sorted = [...rows].sort(byId);
    const hit =
      typeof arg === "number"
        ? sorted.slice(arg)
        : arg === null
          ? sorted
          : sorted.filter((r) => r.id > arg);
    const data = hit.slice(0, Math.min(PAGE, opts.max ?? PAGE));
    requests.push(arg);
    opts.between?.(requests.length);
    return Promise.resolve({ data, error: null });
  };
  return { rows, answer, requests };
}

describe("7. keyset pages: a table that changes between requests", () => {
  it("a row inserted with a smaller id after page 1: offset repeats the page's last row; keyset does not", async () => {
    const before = table(rowsTo(1500), {
      between: (n) => n === 1 && before.rows.push({ id: idOf(0), n: 0 }),
    });
    const old = await offsetReadAll(before.answer);
    expect(old.data).toHaveLength(1501); // the "+1": r-01000 twice
    expect(distinct(ids(old))).toBe(1500);
    expect(ids(old).filter((x) => x === idOf(1000))).toHaveLength(2);

    const now = table(rowsTo(1500), {
      between: (n) => n === 1 && now.rows.push({ id: idOf(0), n: 0 }),
    });
    const r = await readAll(now.answer);
    expect(r.error).toBeNull();
    // Every row exactly once; the new row sorts before the cursor, so it is (rightly) not seen,
    // like one written after the read ended.
    expect(ids(r)).toEqual(rowsTo(1500).map((x) => x.id));
    expect(now.requests).toEqual([null, idOf(1000), idOf(1500)]);
  });
  it("a row inserted with a larger id after page 1 is read once, on the page its id falls in", async () => {
    const t = table(rowsTo(1500), {
      between: (n) => n === 1 && t.rows.push({ id: idOf(1501), n: 1501 }),
    });
    const r = await readAll(t.answer);
    expect(ids(r)).toEqual(rowsTo(1501).map((x) => x.id));
    expect(distinct(ids(r))).toBe(1501);
  });
  it("a row of page 1 deleted after it was read: offset skips a live row; keyset reads every live row", async () => {
    const drop = (rows: Row[]) =>
      rows.splice(
        rows.findIndex((x) => x.n === 1),
        1,
      );
    const before = table(rowsTo(1500), { between: (n) => n === 1 && drop(before.rows) });
    const old = await offsetReadAll(before.answer);
    expect(old.data).toHaveLength(1499);
    expect(ids(old)).not.toContain(idOf(1001)); // the "−1": a live row never read
    expect(ids(old)).toContain(idOf(1)); // while the deleted one is counted

    const now = table(rowsTo(1500), { between: (n) => n === 1 && drop(now.rows) });
    const r = await readAll(now.answer);
    // r-00001 was live when its page was read; every row live at the end is there, once.
    expect(ids(r)).toEqual(rowsTo(1500).map((x) => x.id));
    expect(ids(r)).toContain(idOf(1001));
    expect(distinct(ids(r))).toBe(1500);
  });
  it("through the fake client with afterId, uuid-like ids: 1,500 rows, each once, in 3 requests", async () => {
    const db = client({ t: rowsTo(1500) }, PAGE);
    let requests = 0;
    const r = await readAll<Row>((after) => {
      requests++;
      return afterId(db.from("t").select("id, n").order("id").limit(PAGE), after);
    });
    expect(r.error).toBeNull();
    expect(ids(r)).toEqual(rowsTo(1500).map((x) => x.id));
    expect(requests).toBe(3);
  });
  it("a bigserial id (invoice_lines) goes back as a number, so the comparison is numeric", async () => {
    // Lexically "999" > "1000": a text cursor would re-read rows 2..999 and never end well.
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1 }));
    const db = client({ t: rows }, PAGE);
    const seen: (RowId | null)[] = [];
    const r = await readAll<{ id: number }>((after) => {
      seen.push(after);
      return afterId(db.from("t").select("id").order("id").limit(PAGE), after);
    });
    expect((r.data ?? []).map((x) => x.id)).toEqual(rows.map((x) => x.id));
    expect(seen).toEqual([null, 1000, 1500]);
  });
  it("afterId: the first page gets no filter; a later one gets .gt('id', after)", () => {
    const calls: unknown[][] = [];
    const q = {
      gt(column: "id", value: RowId) {
        calls.push([column, value]);
        return q;
      },
    };
    expect(afterId(q, null)).toBe(q);
    expect(calls).toEqual([]);
    expect(afterId(q, "x-1")).toBe(q);
    expect(calls).toEqual([["id", "x-1"]]);
  });
});

describe("A. the read ends at an empty page, not a short one", () => {
  it("a server Max Rows of 500: the old read stopped at 500 rows; every row still comes back now", async () => {
    const old = await offsetReadAll(table(rowsTo(1500), { max: 500 }).answer);
    expect(old.data).toHaveLength(500); // the ceiling, silently

    const t = table(rowsTo(1500), { max: 500 });
    const r = await readAll(t.answer);
    expect(ids(r)).toEqual(rowsTo(1500).map((x) => x.id));
    expect(t.requests).toEqual([null, idOf(500), idOf(1000), idOf(1500)]);
  });
  it("the same through the fake client capped at 500", async () => {
    const db = client({ t: rowsTo(1500) }, 500);
    const r = await readAll<Row>((after) =>
      afterId(db.from("t").select("id, n").order("id").limit(PAGE), after),
    );
    expect(ids(r)).toHaveLength(1500);
    expect(distinct(ids(r))).toBe(1500);
  });
  it("requests: 1,500 rows take 3; exactly 1,000 take 2; an empty table takes 1", async () => {
    const big = table(rowsTo(1500));
    await readAll(big.answer);
    expect(big.requests).toHaveLength(3);
    const full = table(rowsTo(PAGE));
    await readAll(full.answer);
    expect(full.requests).toEqual([null, idOf(PAGE)]);
    const none = table([]);
    expect(await readAll(none.answer)).toEqual({ data: [], error: null });
    expect(none.requests).toEqual([null]);
  });
  it("an error on any page is the answer, as one query's would be", async () => {
    let n = 0;
    const r = await readAll<Row>(() =>
      Promise.resolve(
        ++n === 2
          ? { data: null, error: { message: "boom" } }
          : { data: rowsTo(PAGE), error: null },
      ),
    );
    expect(r).toEqual({ data: null, error: { message: "boom" } });
  });
});
