/**
 * Every row of a query, read a page at a time (owner, Oct 21: "I'd rather not worry about it" —
 * the Owner view's counts used to stop at 1,000 rows of each kind and could run low).
 *
 * PostgREST answers at most 1,000 rows per request whatever .limit() asks, so a read that must
 * see everything asks for pages until one comes back empty. The pages are KEYSET pages (Oct 21,
 * eighth audit): the caller's builder gets the last id seen (`after`, null for the first page)
 * and adds `.order("id").limit(PAGE)` plus `.gt("id", after)` when there is one (`afterId`).
 * Offset pages (`.range(from, to)`) were wrong on a table that changes between requests: a row
 * inserted with a smaller id shifted the offset and the last row of a page came back twice
 * (count +1); a row deleted or filtered out between pages skipped one (count −1). A keyset page
 * cannot repeat or skip: a row is on exactly one page, the one its id falls in. The price is the
 * order — the pages come by id, so a caller that wants another order sorts the whole answer
 * (they aggregate or sort anyway).
 *
 * The read stops at an EMPTY page, not a short one (Oct 21, eighth audit): if the project's
 * PostgREST Max Rows were ever set below PAGE, every page would be short and a read that stopped
 * at the first short page would silently stop at that ceiling — the one this function exists to
 * remove. One extra small request per read (`.gt("id", last)` answers [] when done): 1,500 rows
 * take three requests, not two.
 *
 * The answer has the shape of one query's, so `must()` and friends read it unchanged. The cursor
 * is the last row's id as it came — a uuid's text, or a bigserial's number (invoice_lines) — so
 * the comparison stays the column's own. inventory-reconcile.functions.ts readAllMovements still
 * pages the stock ledger by offset in (created_at, id) order, the order growth-indexes.test.ts
 * pins to its index.
 */
export const PAGE = 1000;

/** A row id: uuid text, or a bigserial number. */
export type RowId = string | number;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** The cursor filter of a keyset page: `.gt("id", after)` after the first page, which has none. */
export function afterId<Q extends { gt(column: "id", value: RowId): Q }>(
  q: Q,
  after: RowId | null,
): Q {
  return after === null ? q : q.gt("id", after);
}

export async function readAll<T extends { id: RowId }>(
  page: (after: RowId | null) => PromiseLike<PageResult<T>>,
): Promise<{ data: T[]; error: null } | { data: null; error: { message: string } }> {
  const out: T[] = [];
  let after: RowId | null = null;
  for (;;) {
    const { data, error } = await page(after);
    if (error) return { data: null, error };
    const rows = data ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    after = rows[rows.length - 1]!.id;
  }
  return { data: out, error: null };
}
