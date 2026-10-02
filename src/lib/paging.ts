/**
 * Reading every row past PostgREST's cap (audit, Oct 2): Supabase returns at most 1,000 rows per
 * request whatever `.limit()` asks for, so the Customers list's `.limit(2000)` stopped at 1,000
 * customers and its site / open-ticket counts at 1,000 rows (CenterPoint has 1,139 properties).
 * `fetchAllPages` asks for 1,000 rows at a time (`.range(from, to)`) until a short page.
 *
 * Pure (the query is passed in), so the paging is unit-tested without a database. The query
 * must have a stable order (an `.order()` ending in a unique column) or rows can repeat or be
 * skipped between pages.
 */

/** PostgREST's default max rows per request on Supabase. */
export const PAGE_SIZE = 1000;

/** Upper bound on pages, so a misbehaving source cannot loop forever (1,000,000 rows). */
const MAX_PAGES = 1000;

export async function fetchAllPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * pageSize;
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  throw new Error(`More than ${MAX_PAGES * pageSize} rows; narrow the query`);
}

/** How many rows per key ("account_id" → count), skipping rows without one. */
export function countBy<T>(rows: readonly T[], key: (r: T) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
