/**
 * Every row of a query, read a page at a time (owner, Oct 21: "I'd rather not worry about it" —
 * the Owner view's counts used to stop at 1,000 rows of each kind and could run low).
 *
 * PostgREST answers at most 1,000 rows per request whatever .limit() asks, so a read that must
 * see everything asks for ranges until a page comes back short. The caller builds each page's
 * query with the same filters and a STABLE order (an `.order("id")` last), or pages could skip or
 * repeat rows while someone writes. The answer has the shape of one query's, so `must()` and
 * friends read it unchanged. inventory-reconcile.functions.ts readAllMovements does the same for
 * the stock ledger.
 */
export const PAGE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ data: T[]; error: null } | { data: null; error: { message: string } }> {
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
